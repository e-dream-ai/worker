import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { Job, Queue, Worker } from 'bullmq';
import 'dotenv/config';
import express from 'express';
import basicAuth from 'express-basic-auth';
import runpodSdk from 'runpod-sdk';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import env from './shared/env.js';
import redisClient from './shared/redis.js';

const DEBUG = env.DEBUG;

const runpod = runpodSdk(env.RUNPOD_API_KEY);
const animatediff = runpod.endpoint(env.RUNPOD_ANIMATEDIFF_ENDPOINT_ID);
const hunyuan = runpod.endpoint(env.RUNPOD_HUNYUAN_ENDPOINT_ID);
const deforum = runpod.endpoint(env.RUNPOD_DEFORUM_ENDPOINT_ID);

const serializeError = (error: Error) => {
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
};

function downloadFileAttempt(url: string, destinationPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const request = client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFileAttempt(response.headers.location, destinationPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const fileStream = fs.createWriteStream(destinationPath);

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (error) => {
        fs.unlink(destinationPath, () => {});
        reject(error);
      });

      response.on('error', (error) => {
        fs.unlink(destinationPath, () => {});
        reject(error);
      });
    });

    request.on('error', reject);
    request.setTimeout(300000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

async function downloadFile(url: string, destinationPath: string, maxRetries: number = 3): Promise<void> {
  const downloadDir = path.dirname(destinationPath);

  // Ensure download directory exists
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await downloadFileAttempt(url, destinationPath);
      if (DEBUG) console.log(`✓ Successfully downloaded: ${url} -> ${destinationPath}`);
      return;
    } catch (error) {
      console.error(`Download attempt ${attempt}/${maxRetries} failed for ${url}:`, error.message);

      if (attempt === maxRetries) {
        throw new Error(`Failed to download ${url} after ${maxRetries} attempts: ${error.message}`);
      }

      // Exponential backoff: wait 2^attempt seconds
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

function createWorker(name: string, handler) {
  const worker = new Worker(
    name,
    async (job) => {
      return await handler(job);
    },
    {
      connection: redisClient,
      // stalledInterval: 1200 * 1000,
    }
  );

  worker.on('failed', (job, error: Error) => {
    console.error(`Job failed: ${name} error: ${serializeError(error)}, job data: ${JSON.stringify(job?.toJSON())}`);
  });

  worker.on('completed', (job, returnvalue) => {
    if (DEBUG)
      console.debug(
        `Job completed: {name}, returning: ${JSON.stringify(returnvalue)}, job data: ${JSON.stringify(job.toJSON())}`
      );
  });

  worker.on('error', (error: Error) => {
    console.error(`Job error:     ${name} error:${serializeError(error)}`);
  });
}

async function handleStatus(endpoint, runpod_id, job: Job) {
  let status;
  let lastStatus = '';
  do {
    try {
      status = await endpoint.status(runpod_id);
      await job.updateProgress(status);
      const json = `Got status ${JSON.stringify(status)}`;
      if (lastStatus !== json) {
        lastStatus = json;
        if (DEBUG) console.log(`${json}`);
        await job.log(`${new Date().toISOString()}: ${json}`);
      }
      if (status.status === 'FAILED') {
        throw new Error(JSON.stringify(status));
      }
    } catch (e) {
      console.error('error getting endpoint status', e.message);
    }
  } while (status?.completed === false);

  const result = JSON.parse(JSON.stringify(status))?.output;
  if (result?.message || result?.video) {
    if (result.video && !result.requires_auth) {
      try {
        const jobData = job?.data as any;
        const customOutputPath: string | undefined = jobData?.custom_output_path;
        const inputFilePath: string | undefined = jobData?.input_file_path;
        const requestedNameRaw: unknown = jobData?.output_name;

        let localPath: string;

        if (customOutputPath) {
          localPath = path.isAbsolute(customOutputPath)
            ? customOutputPath
            : path.resolve(process.cwd(), customOutputPath);
        } else if (inputFilePath && requestedNameRaw) {
          const inputDir = path.dirname(inputFilePath);
          const sanitizedName = path.basename(String(requestedNameRaw)).replace(/[^a-zA-Z0-9._-]/g, '');
          const filename = sanitizedName.endsWith('.mp4') ? sanitizedName : `${sanitizedName}.mp4`;
          localPath = path.join(inputDir, filename);
        } else {
          const baseName = `${job.id}_${Date.now()}.mp4`;
          localPath = path.resolve(process.cwd(), baseName);
        }

        await job.log(`${new Date().toISOString()}: Starting download of video file...`);
        await downloadFile(result.video, localPath);

        result.local_path = localPath;
        result.downloaded_at = new Date().toISOString();

        await job.log(`${new Date().toISOString()}: Video downloaded successfully to ${localPath}`);
        if (DEBUG) console.log(`✓ Video downloaded for job ${job.id}: ${localPath}`);
      } catch (downloadError) {
        console.error(`Failed to download video for job ${job.id}:`, downloadError.message);
        await job.log(`${new Date().toISOString()}: Download failed: ${downloadError.message}`);
        result.download_error = downloadError.message;
      }
    }

    return result;
  } else {
    throw new Error(`no video URL in result, status ${JSON.stringify(status)}`);
  }
}

async function imageJob(job: Job) {
  if (animatediff) {
    if (DEBUG) console.log(`Starting runpod image worker: ${JSON.stringify(job.data)}`);
    const prompt = job.data.prompt || 'A walk in the park';
    const seed: number = job.data.seed || 1337;
    const steps: number = job.data.steps || 20;
    const filename_prefix: string = job.id + '';
    const size = { width: job.data.width || 512, height: job.data.height || 512 };

    const { id: runpod_id } = await animatediff.run({
      input: {
        workflow: {
          '3': {
            inputs: {
              seed,
              steps,
              cfg: 8,
              sampler_name: 'euler',
              scheduler: 'normal',
              denoise: 1,
              model: ['4', 0],
              positive: ['6', 0],
              negative: ['7', 0],
              latent_image: ['5', 0],
            },
            class_type: 'KSampler',
          },
          '4': {
            inputs: {
              ckpt_name: 'sd_xl_base_1.0.safetensors',
            },
            class_type: 'CheckpointLoaderSimple',
          },
          '5': {
            inputs: {
              width: size.width,
              height: size.height,
              batch_size: 1,
            },
            class_type: 'EmptyLatentImage',
          },
          '6': {
            inputs: {
              text: prompt,
              clip: ['4', 1],
            },
            class_type: 'CLIPTextEncode',
          },
          '7': {
            inputs: {
              text: 'text, watermark',
              clip: ['4', 1],
            },
            class_type: 'CLIPTextEncode',
          },
          '8': {
            inputs: {
              samples: ['3', 0],
              vae: ['4', 2],
            },
            class_type: 'VAEDecode',
          },
          '9': {
            inputs: {
              filename_prefix,
              images: ['8', 0],
            },
            class_type: 'SaveImage',
          },
        },
      },
    });

    await job.updateData({ ...job.data, runpod_id });
    return handleStatus(animatediff, runpod_id, job);
  }
}

// run the above function when 'image' job is created (prompt.ts)
createWorker('image', imageJob);

async function videoJob(job: Job) {
  if (animatediff) {
    const prompts = job.data.prompts || {};
    const promptsJson = JSON.stringify(prompts);

    if (!promptsJson) {
      throw new Error(`prompts data is missing or invalid: ${JSON.stringify(job.data)}`);
    }

    const prompt = promptsJson.substring(1, promptsJson.length - 1);

    const seed: number = job.data.seed || 832386334143550;
    const steps: number = job.data.steps || 30;
    const filename_prefix: string = job.id + '';
    const size = { width: job.data.width || 960, height: job.data.height || 544 };

    const pre_text: string = job.data.pre_text || 'highly detailed, 4k, masterpiece';
    const app_text: string =
      job.data.app_text || '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot';
    const frame_count: number = job.data.frame_count || 64;
    const frame_rate: number = job.data.frame_rate || 8;
    const motion_scale: number = job.data.motion_scale || 1;

    const { id: runpod_id } = await animatediff.run({
      input: {
        workflow: {
          '1': {
            inputs: {
              ckpt_name: 'sd1/dreamshaper_8.safetensors',
              beta_schedule: 'sqrt_linear (AnimateDiff)',
              use_custom_scale_factor: false,
              scale_factor: 0.18215,
            },
            class_type: 'CheckpointLoaderSimpleWithNoiseSelect',
            _meta: {
              title: 'Load Checkpoint w/ Noise Select 🎭🅐🅓',
            },
          },
          '2': {
            inputs: {
              vae_name: 'sd1/vae-ft-mse-840000-ema-pruned.safetensors',
            },
            class_type: 'VAELoader',
            _meta: {
              title: 'Load VAE',
            },
          },
          '6': {
            inputs: {
              text: '(bad quality, worst quality:1.2), NSFW, nude',
              clip: ['1', 1],
            },
            class_type: 'CLIPTextEncode',
            _meta: {
              title: 'CLIP Text Encode (Prompt)',
            },
          },
          '7': {
            inputs: {
              seed,
              steps,
              cfg: 5,
              sampler_name: 'dpmpp_2m_sde',
              scheduler: 'karras',
              denoise: 1,
              model: ['93', 0],
              positive: ['100', 0],
              negative: ['6', 0],
              latent_image: ['101', 0],
            },
            class_type: 'KSampler',
            _meta: {
              title: 'KSampler',
            },
          },
          '10': {
            inputs: {
              samples: ['7', 0],
              vae: ['2', 0],
            },
            class_type: 'VAEDecode',
            _meta: {
              title: 'VAE Decode',
            },
          },
          '12': {
            inputs: {
              filename_prefix,
              images: ['10', 0],
            },
            class_type: 'SaveImage',
            _meta: {
              title: 'Save Image',
            },
          },
          '93': {
            inputs: {
              model_name: 'sd1/mm_sd_v15_v2.ckpt',
              beta_schedule: 'sqrt_linear (AnimateDiff)',
              motion_scale,
              apply_v2_models_properly: true,
              model: ['1', 0],
              context_options: ['94', 0],
            },
            class_type: 'ADE_AnimateDiffLoaderWithContext',
            _meta: {
              title: 'AnimateDiff Loader [Legacy] 🎭🅐🅓①',
            },
          },
          '94': {
            inputs: {
              context_length: 16,
              context_stride: 1,
              context_overlap: 4,
              context_schedule: 'uniform',
              closed_loop: false,
              fuse_method: 'flat',
              use_on_equal_length: false,
              start_percent: 0,
              guarantee_steps: 1,
            },
            class_type: 'ADE_AnimateDiffUniformContextOptions',
            _meta: {
              title: 'Context Options◆Looped Uniform 🎭🅐🅓',
            },
          },
          '100': {
            inputs: {
              text: prompt,
              max_frames: frame_count,
              print_output: '0',
              pre_text,
              app_text,
              end_frame: frame_count,
              start_frame: 0,
              pw_a: 0,
              pw_b: 0,
              pw_c: 0,
              pw_d: 0,
              clip: ['1', 1],
            },
            class_type: 'BatchPromptSchedule',
            _meta: {
              title: 'Batch Prompt Schedule 📅🅕🅝',
            },
          },
          '101': {
            inputs: {
              width: size.width,
              height: size.height,
              batch_size: frame_count,
            },
            class_type: 'ADE_EmptyLatentImageLarge',
            _meta: {
              title: 'Empty Latent Image (Big Batch) 🎭🅐🅓',
            },
          },
          '102': {
            inputs: {
              upscale_method: 'nearest-exact',
              scale_by: 2,
              samples: ['7', 0],
            },
            class_type: 'LatentUpscaleBy',
            _meta: {
              title: 'Upscale Latent By',
            },
          },
          '103': {
            inputs: {
              seed: 832386334143550,
              steps,
              cfg: 5,
              sampler_name: 'dpmpp_2m_sde',
              scheduler: 'karras',
              denoise: 0.65,
              model: ['93', 0],
              positive: ['100', 0],
              negative: ['6', 0],
              latent_image: ['102', 0],
            },
            class_type: 'KSampler',
            _meta: {
              title: 'KSampler (upscale)',
            },
          },
          '104': {
            inputs: {
              samples: ['103', 0],
              vae: ['2', 0],
            },
            class_type: 'VAEDecode',
            _meta: {
              title: 'VAE Decode',
            },
          },
          '106': {
            inputs: {
              frame_rate,
              loop_count: 0,
              filename_prefix,
              format: 'video/h264-mp4',
              pix_fmt: 'yuv420p',
              crf: 19,
              save_metadata: true,
              pingpong: false,
              save_output: true,
              images: ['10', 0],
            },
            class_type: 'VHS_VideoCombine',
            _meta: {
              title: 'Video Combine 🎥🅥🅗🅢',
            },
          },
        },
      },
    });

    await job.updateData({ ...job.data, runpod_id });
    return handleStatus(animatediff, runpod_id, job);
  }
}

// run the above function when 'image' job is created (prompt.ts)
createWorker('video', videoJob);

async function videoJobHunyuan(job: Job) {
  if (hunyuan) {
    if (DEBUG) console.log(`Starting runpod video worker: ${JSON.stringify(job.data)}`);
    // serialize prompt json into format expected
    const json = JSON.stringify(job.data.prompt);
    const prompt =
      json.substring(1, json.length - 1) ||
      "foreground: a three dimensional sensual liquid spins, pulses, and morphs like a nudibranch. it's made of sparks and prismatic beams of light and covered kind of advanced biomimicry technology. \n\nbackground: dark sky with nebula and stars\n\nstyle is realistic and detailed with bokeh, but with exagerated colors and lines.";
    const seed: number = job.data.seed || 6;
    const steps: number = job.data.steps || 30;
    const filename_prefix: string = job.id + '';
    const size = { width: job.data.width || 640, height: job.data.height || 368 };

    const frame_count: number = job.data.frame_count || 85;
    const frame_rate: number = job.data.frame_rate || 16;

    const { id: runpod_id } = await hunyuan.run({
      input: {
        workflow: {
          '1': {
            inputs: {
              model: 'hunyuan_video_720_cfgdistill_bf16.safetensors',
              base_precision: 'bf16',
              quantization: 'fp8_e4m3fn',
              load_device: 'offload_device',
              attention_mode: 'sageattn_varlen',
            },
            class_type: 'HyVideoModelLoader',
          },
          '3': {
            inputs: {
              width: size.width,
              height: size.height,
              num_frames: frame_count,
              steps,
              embedded_guidance_scale: 6,
              flow_shift: 9,
              seed,
              force_offload: 1,
              denoise_strength: 1,
              scheduler: 'FlowMatchDiscreteScheduler',
              model: ['1', 0],
              hyvid_embeds: ['30', 0],
            },
            class_type: 'HyVideoSampler',
          },
          '5': {
            inputs: {
              enable_vae_tiling: true,
              temporal_tiling_sample_size: 8,
              spatial_tile_sample_min_size: 256,
              auto_tile_size: true,
              vae: ['7', 0],
              samples: ['3', 0],
            },
            class_type: 'HyVideoDecode',
          },
          '7': {
            inputs: {
              model_name: 'hunyuan_video_vae_bf16.safetensors',
              precision: 'fp16',
            },
            class_type: 'HyVideoVAELoader',
          },
          '16': {
            inputs: {
              llm_model: 'Kijai/llava-llama-3-8b-text-encoder-tokenizer',
              clip_model: 'openai/clip-vit-large-patch14',
              precision: 'fp16',
              apply_final_norm: false,
              hidden_state_skip_layer: 2,
            },
            class_type: 'DownloadAndLoadHyVideoTextEncoder',
          },
          '30': {
            inputs: {
              prompt,
              force_offload: true,
              text_encoders: ['16', 0],
            },
            class_type: 'HyVideoTextEncode',
          },
          '34': {
            inputs: {
              frame_rate,
              loop_count: 0,
              filename_prefix,
              format: 'video/h264-mp4',
              pix_fmt: 'yuv420p',
              crf: 19,
              save_metadata: true,
              pingpong: false,
              save_output: true,
              images: ['5', 0],
            },
            class_type: 'VHS_VideoCombine',
          },
        },
      },
    });

    await job.updateData({ ...job.data, runpod_id });
    return handleStatus(hunyuan, runpod_id, job);
  }
}
// run the above function when 'image' job is created (prompt.ts)
createWorker('hunyuanvideo', videoJobHunyuan);

async function videoJobDeforum(job) {
  if (deforum) {
    if (DEBUG) console.log(`Starting runpod video worker: ${JSON.stringify(job.data)}`);
    const { ...promptData } = job.data;

    const prompts = {};
    const otherParams = {};

    for (const [key, value] of Object.entries(promptData)) {
      if (/^\d+$/.test(key)) {
        prompts[key] = value;
      } else {
        otherParams[key] = value;
      }
    }

    const { id: runpod_id } = await deforum.run({
      input: {
        settings: {
          batch_name: job.id + '',
          prompts: prompts,
          ...otherParams,
          output_name: undefined,
          input_file_path: undefined,
          custom_output_path: undefined,
        },
      },
    });
    await job.updateData({ ...job.data, runpod_id });
    return handleStatus(deforum, runpod_id, job);
  }
}
// run the above function when 'image' job is created (prompt.ts)
createWorker('deforumvideo', videoJobDeforum);

const deforumQueue = new Queue('deforumvideo', {
  connection: redisClient,
});
const hunyuanVideoQueue = new Queue('hunyuanvideo', {
  connection: redisClient,
});
const animatediffVideoQueue = new Queue('video', {
  connection: redisClient,
});
const imageQueue = new Queue('image', {
  connection: redisClient,
});

const jobs = await hunyuanVideoQueue.getJobs(['active']);
console.log(`Active jobs, ${JSON.stringify(jobs)}`);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(hunyuanVideoQueue),
    new BullMQAdapter(animatediffVideoQueue),
    new BullMQAdapter(imageQueue),
    new BullMQAdapter(deforumQueue),
  ],
  serverAdapter: serverAdapter,
});

const app = express();
app.use(
  '/admin',
  basicAuth({
    users: { admin: env.ADMIN_PASS },
    challenge: true,
  })
);
app.use('/admin/queues', serverAdapter.getRouter());

// other configurations of your server

app.listen(env.PORT, () => {
  console.log(`Running on port ${env.PORT} in ${env.NODE_ENV} mode...`);
  console.log(`For the UI, open http://localhost:${env.PORT}/admin/queues`);
});
