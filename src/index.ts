import { Job, Worker } from 'bullmq';
import 'dotenv/config';
import { Redis } from 'ioredis';
import runpodSdk from 'runpod-sdk';

const DEBUG = false;

const { RUNPOD_API_KEY, ENDPOINT_ID } = process.env;
const runpod = runpodSdk(RUNPOD_API_KEY || '');
const endpoint = runpod.endpoint(ENDPOINT_ID || '');

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

const serializeError = (error: Error) => {
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
};

function createWorker(name: string, handler) {
  const worker = new Worker(
    name,
    async (job) => {
      return await handler(job);
    },
    {
      connection: redisClient,
      stalledInterval: 1200 * 1000,
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

async function runpodJob(job: Job) {
  if (endpoint) {
    if (DEBUG) console.log(`Starting runpod worker: ${JSON.stringify(job.data)}`);
    const { id } = await endpoint.run({
      input: {
        workflow: {
          '3': {
            inputs: {
              seed: 1337,
              steps: 20,
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
              width: 512,
              height: 512,
              batch_size: 1,
            },
            class_type: 'EmptyLatentImage',
          },
          '6': {
            inputs: {
              text: job.data.prompt,
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
              filename_prefix: 'ComfyUI',
              images: ['8', 0],
            },
            class_type: 'SaveImage',
          },
        },
      },
    });

    let status;
    do {
      status = await endpoint.status(id);
      if (DEBUG) console.log(`Got status: ${JSON.stringify(status)}`);
      await job.updateProgress(status);
    } while (status.status !== 'COMPLETED');

    // return S3 url to result
    return JSON.parse(JSON.stringify(status)).output.message;
  }
}

// run the above function when 'image' job is created (prompt.ts)
createWorker('image', runpodJob);

async function videoJob(job: Job) {
  if (endpoint) {
    if (DEBUG) console.log(`Starting runpod worker: ${JSON.stringify(job.data)}`);
    // serialize prompt json into format expected
    const json = JSON.stringify(job.data.prompt);
    const prompt = json.substring(1, json.length - 1);

    const pre_text: string = job.data.pre_text || 'highly detailed, 4k, masterpiece';
    const print_output: string =
      job.data.print_output || '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot';
    const frame_count: number = job.data.frame_count || 64;
    const frame_rate: number = job.data.frame_rate || 8;
    const filename_prefix: string = job.id + '';

    const { id } = await endpoint.run({
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
              seed: 832386334143550,
              steps: 30,
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
              motion_scale: 1,
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
              print_output,
              pre_text,
              app_text: '0',
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
              width: 960,
              height: 544,
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
              steps: 30,
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

    let status;
    do {
      try {
        status = await endpoint.status(id);
      } catch (e) {
        console.log('error getting endpoint status', e);
        continue;
      }
      if (DEBUG) console.log(`Got status: ${JSON.stringify(status)}`);
      await job.updateProgress(status);
      if (status.status === 'FAILED') {
        throw new Error(JSON.stringify(status));
      }
    } while (status.completed === false);

    const s3url = JSON.parse(JSON.stringify(status))?.output?.message;
    if (!s3url) {
      throw new Error(`no S3 url for result, status ${JSON.stringify(status)}`);
    } else {
      // return S3 url to result
      return s3url;
    }
  }
}

// run the above function when 'image' job is created (prompt.ts)
createWorker('video', videoJob);
