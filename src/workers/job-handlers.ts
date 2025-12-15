import { Job } from 'bullmq';
import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { endpoints } from '../config/runpod.config.js';
import { StatusHandlerService } from '../services/status-handler.service.js';
import { R2UploadService } from '../services/r2-upload.service.js';
import { VideoServiceClient } from '../services/video-service.client.js';

const statusHandler = new StatusHandlerService();
const r2UploadService = new R2UploadService();
const videoServiceClient = new VideoServiceClient();

interface Wan22T2V720Params {
  prompt: string;
  size?: string;
  width?: number;
  height?: number;
  duration?: number;
  num_inference_steps?: number;
  guidance?: number;
  seed?: number;
  negative_prompt?: string;
  temperature?: number;
  flow_shift?: number;
  max_tokens?: number;
  enable_prompt_optimization?: boolean;
  enable_safety_checker?: boolean;
}

interface Wan22I2V720Params {
  prompt: string;
  image: string;
  size?: string;
  width?: number;
  height?: number;
  duration?: number;
  num_inference_steps?: number;
  guidance?: number;
  seed?: number;
  negative_prompt?: string;
  temperature?: number;
  flow_shift?: number;
  max_tokens?: number;
  enable_prompt_optimization?: boolean;
  enable_safety_checker?: boolean;
}

interface LoRAConfig {
  path: string;
  scale: number;
}

interface Wan22I2VLoraParams {
  prompt: string;
  image?: string;
  last_image?: string;
  duration?: number;
  seed?: number;
  loras?: LoRAConfig[];
  high_noise_loras?: LoRAConfig[];
  low_noise_loras?: LoRAConfig[];
  enable_base64_output?: boolean;
  enable_sync_mode?: boolean;
  enable_safety_checker?: boolean;
}

interface QwenImageParams {
  prompt: string;
  size?: string;
  seed?: number;
  negative_prompt?: string;
  enable_safety_checker?: boolean;
}

export async function handleImageJob(job: Job): Promise<any> {
  const { prompt = 'A walk in the park', seed = 1337, steps = 20, width = 512, height = 512 } = job.data;
  const filenamePrefix = String(job.id);

  const { id: runpodId } = await endpoints.animatediff.run({
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
          inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
          class_type: 'CheckpointLoaderSimple',
        },
        '5': {
          inputs: { width, height, batch_size: 1 },
          class_type: 'EmptyLatentImage',
        },
        '6': {
          inputs: { text: prompt, clip: ['4', 1] },
          class_type: 'CLIPTextEncode',
        },
        '7': {
          inputs: { text: 'text, watermark', clip: ['4', 1] },
          class_type: 'CLIPTextEncode',
        },
        '8': {
          inputs: { samples: ['3', 0], vae: ['4', 2] },
          class_type: 'VAEDecode',
        },
        '9': {
          inputs: { filename_prefix: filenamePrefix, images: ['8', 0] },
          class_type: 'SaveImage',
        },
      },
    },
  });

  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.animatediff, runpodId, job);
}

export async function handleVideoJob(job: Job): Promise<any> {
  const {
    prompts = {},
    seed = 832386334143550,
    steps = 30,
    width = 960,
    height = 544,
    pre_text = 'highly detailed, 4k, masterpiece',
    app_text = '(Masterpiece, best quality:1.2) walking towards camera, full body closeup shot',
    frame_count = 64,
    frame_rate = 8,
    motion_scale = 1,
    dream_uuid,
    auto_upload = true,
  } = job.data;

  const promptsJson = JSON.stringify(prompts);
  if (!promptsJson) {
    throw new Error(`Prompts data is missing or invalid: ${JSON.stringify(job.data)}`);
  }

  const prompt = promptsJson.substring(1, promptsJson.length - 1);
  const filenamePrefix = String(job.id);

  const { id: runpodId } = await endpoints.animatediff.run({
    input: {
      workflow: createAnimatediffWorkflow({
        seed,
        steps,
        width,
        height,
        prompt,
        pre_text,
        app_text,
        frame_count,
        frame_rate,
        motion_scale,
        filenamePrefix,
      }),
    },
  });

  await job.updateData({ ...job.data, runpod_id: runpodId });
  const result = await statusHandler.handleStatus(endpoints.animatediff, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleVideoJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
}

export async function handleHunyuanVideoJob(job: Job): Promise<any> {
  const {
    prompt: promptData,
    seed = 6,
    steps = 30,
    width = 640,
    height = 368,
    frame_count = 85,
    frame_rate = 16,
  } = job.data;

  const promptJson = JSON.stringify(promptData);
  const prompt =
    promptJson.substring(1, promptJson.length - 1) ||
    "foreground: a three dimensional sensual liquid spins, pulses, and morphs like a nudibranch. it's made of sparks and prismatic beams of light and covered kind of advanced biomimicry technology. \n\nbackground: dark sky with nebula and stars\n\nstyle is realistic and detailed with bokeh, but with exagerated colors and lines.";

  const filenamePrefix = String(job.id);

  const { id: runpodId } = await endpoints.hunyuan.run({
    input: {
      workflow: createHunyuanWorkflow({
        width,
        height,
        frame_count,
        steps,
        seed,
        prompt,
        frame_rate,
        filenamePrefix,
      }),
    },
  });

  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.hunyuan, runpodId, job);
}

export async function handleDeforumVideoJob(job: Job): Promise<any> {
  const { dream_uuid, auto_upload = true, ...promptData } = job.data;
  const prompts = {};
  const otherParams = {};

  for (const [key, value] of Object.entries(promptData)) {
    if (/^\d+$/.test(key)) {
      prompts[key] = value;
    } else {
      otherParams[key] = value;
    }
  }

  const { id: runpodId } = await endpoints.deforum.run({
    input: {
      settings: {
        batch_name: String(job.id),
        prompts,
        ...otherParams,
        output_name: undefined,
        input_file_path: undefined,
        custom_output_path: undefined,
      },
    },
  });

  await job.updateData({ ...job.data, runpod_id: runpodId });
  const result = await statusHandler.handleStatus(endpoints.deforum, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url);
  }

  return result;
}

export async function handleUprezVideoJob(job: Job): Promise<any> {
  const {
    video_url,
    video_uuid,
    video_path,
    upscale_factor = 2,
    interpolation_factor = 2,
    output_fps,
    output_format = 'mp4',
    tile_size = 512,
    tile_padding = 10,
    quality = 'high',
    dream_uuid,
    auto_upload = true,
  } = job.data || {};

  const input: Record<string, unknown> = {
    upscale_factor,
    interpolation_factor,
    output_format,
    tile_size,
    tile_padding,
    quality,
  };

  if (typeof output_fps === 'number') {
    input.output_fps = output_fps;
  }

  const provided = [video_url, video_uuid, video_path].filter(Boolean);
  if (provided.length === 0) {
    throw new Error("Provide one of 'video_url', 'video_uuid', or 'video_path'");
  }
  if (provided.length > 1) {
    throw new Error("Provide only one of 'video_url', 'video_uuid', or 'video_path'");
  }

  if (video_url) {
    input.video_url = video_url;
  } else if (video_uuid) {
    input.video_uuid = video_uuid;
  } else if (video_path) {
    input.video_path = video_path;
  }

  const { id: runpodId } = await endpoints.uprez.run({ input });
  await job.updateData({ ...job.data, runpod_id: runpodId });
  const result = await statusHandler.handleStatus(endpoints.uprez, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url);
  }

  return result;
}

export async function handleWanT2VJob(job: Job): Promise<any> {
  const {
    prompt,
    size,
    width,
    height,
    duration = 8,
    num_inference_steps = 30,
    guidance = 5,
    seed = -1,
    negative_prompt = '',
    temperature,
    flow_shift = 5,
    max_tokens,
    enable_prompt_optimization = false,
    enable_safety_checker = true,
  } = job.data as Wan22T2V720Params;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  // Build input parameters
  const input: Record<string, unknown> = {
    prompt,
    duration,
    num_inference_steps,
    guidance,
    seed,
    negative_prompt,
    flow_shift,
    enable_prompt_optimization,
    enable_safety_checker,
  };

  if (size) {
    if (typeof size !== 'string') {
      throw new Error('size must be a string in format "1280*720"');
    }
    input.size = size;
  } else if (width || height) {
    if (width && typeof width === 'number') {
      input.width = width;
    }
    if (height && typeof height === 'number') {
      input.height = height;
    }
  }

  // Add optional parameters only if they are provided
  if (temperature !== undefined && temperature !== null) {
    input.temperature = temperature;
  }
  if (max_tokens !== undefined && max_tokens !== null) {
    input.max_tokens = max_tokens;
  }

  const { id: runpodId } = await endpoints.wanT2V.run(input);
  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.wanT2V, runpodId, job);
}

export async function handleWanI2VJob(job: Job): Promise<any> {
  const {
    prompt,
    image,
    size,
    width,
    height,
    duration = 5,
    num_inference_steps = 30,
    guidance = 5,
    seed = -1,
    negative_prompt = '',
    temperature,
    flow_shift = 5,
    max_tokens,
    enable_prompt_optimization = false,
    enable_safety_checker = true,
  } = job.data as Wan22I2V720Params;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  if (!image || typeof image !== 'string') {
    throw new Error('image is required and must be a string URL or local file path');
  }

  // Build input parameters
  const input: Record<string, unknown> = {
    prompt,
    image: await processImageForEndpoint(image, String(job.id)),
    duration,
    num_inference_steps,
    guidance,
    seed,
    negative_prompt,
    flow_shift,
    enable_prompt_optimization,
    enable_safety_checker,
  };

  if (size) {
    if (typeof size !== 'string') {
      throw new Error('size must be a string in format "1280*720"');
    }
    input.size = size;
  } else if (width || height) {
    if (width && typeof width === 'number') {
      input.width = width;
    }
    if (height && typeof height === 'number') {
      input.height = height;
    }
  }

  // Add optional parameters only if they are provided
  if (temperature !== undefined && temperature !== null) {
    input.temperature = temperature;
  }
  if (max_tokens !== undefined && max_tokens !== null) {
    input.max_tokens = max_tokens;
  }

  const { id: runpodId } = await endpoints.wanI2V.run(input);
  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.wanI2V, runpodId, job);
}

async function processImageForEndpoint(imageInput: string, jobId: string): Promise<string> {
  const isUrl = imageInput.startsWith('http://') || imageInput.startsWith('https://');

  if (isUrl) {
    return imageInput;
  }

  if (existsSync(imageInput)) {
    try {
      const presignedUrl = await r2UploadService.uploadImageToR2(imageInput, jobId);
      return presignedUrl;
    } catch (error: any) {
      console.warn(`R2 upload failed for ${imageInput}, falling back to base64: ${error.message}`);
      try {
        const imageBuffer = readFileSync(imageInput);
        return imageBuffer.toString('base64');
      } catch (readError: any) {
        throw new Error(`Failed to process image file ${imageInput}: ${readError.message}`);
      }
    }
  }

  try {
    Buffer.from(imageInput, 'base64');
    return imageInput;
  } catch {
    throw new Error(`Image input "${imageInput}" is not a valid URL, existing file path, or base64 string`);
  }
}
export async function handleWanI2VLoraJob(job: Job): Promise<any> {
  const {
    prompt,
    image,
    last_image,
    duration = 5,
    seed = -1,
    loras,
    high_noise_loras,
    low_noise_loras,
    enable_base64_output = false,
    enable_sync_mode = false,
    enable_safety_checker = true,
  } = job.data as Wan22I2VLoraParams;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  const input: Record<string, unknown> = {
    prompt,
    duration,
    seed,
    enable_base64_output,
    enable_sync_mode,
    enable_safety_checker,
  };

  if (image) {
    if (typeof image !== 'string') {
      throw new Error('image must be a string URL or local file path');
    }
    input.image = await processImageForEndpoint(image, String(job.id));
  }

  if (last_image) {
    if (typeof last_image !== 'string') {
      throw new Error('last_image must be a string URL or local file path');
    }
    input.last_image = await processImageForEndpoint(last_image, String(job.id));
  }

  if (loras && Array.isArray(loras)) {
    const validLoras = loras.filter((lora) => lora && lora.path && lora.path.trim() !== '');
    if (validLoras.length > 0) {
      input.loras = validLoras;
    }
  }

  if (high_noise_loras && Array.isArray(high_noise_loras)) {
    const validLoras = high_noise_loras.filter((lora) => lora && lora.path && lora.path.trim() !== '');
    if (validLoras.length > 0) {
      input.high_noise_loras = validLoras;
    }
  }

  if (low_noise_loras && Array.isArray(low_noise_loras)) {
    const validLoras = low_noise_loras.filter((lora) => lora && lora.path && lora.path.trim() !== '');
    if (validLoras.length > 0) {
      input.low_noise_loras = validLoras;
    }
  }

  const { id: runpodId } = await endpoints.wanI2VLora.run(input);
  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.wanI2VLora, runpodId, job);
}

export async function handleQwenImageJob(job: Job): Promise<any> {
  const { prompt, size, seed = -1, negative_prompt = '', enable_safety_checker = true } = job.data as QwenImageParams;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  const input: Record<string, unknown> = {
    prompt,
    seed,
    negative_prompt,
    enable_safety_checker,
  };

  if (size) {
    if (typeof size !== 'string') {
      throw new Error('size must be a string in format "W*H", e.g., "1024*1024" or "1328*1328"');
    }
    input.size = size;
  }

  const { id: runpodId } = await endpoints.qwenImage.run(input);
  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.qwenImage, runpodId, job);
}

function createAnimatediffWorkflow(params: {
  seed: number;
  steps: number;
  width: number;
  height: number;
  prompt: string;
  pre_text: string;
  app_text: string;
  frame_count: number;
  frame_rate: number;
  motion_scale: number;
  filenamePrefix: string;
}) {
  const {
    seed,
    steps,
    width,
    height,
    prompt,
    pre_text,
    app_text,
    frame_count,
    frame_rate,
    motion_scale,
    filenamePrefix,
  } = params;

  return {
    '1': {
      inputs: {
        ckpt_name: 'sd1/dreamshaper_8.safetensors',
        beta_schedule: 'sqrt_linear (AnimateDiff)',
        use_custom_scale_factor: false,
        scale_factor: 0.18215,
      },
      class_type: 'CheckpointLoaderSimpleWithNoiseSelect',
    },
    '2': {
      inputs: { vae_name: 'sd1/vae-ft-mse-840000-ema-pruned.safetensors' },
      class_type: 'VAELoader',
    },
    '6': {
      inputs: {
        text: '(bad quality, worst quality:1.2), NSFW, nude',
        clip: ['1', 1],
      },
      class_type: 'CLIPTextEncode',
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
    },
    '10': {
      inputs: { samples: ['7', 0], vae: ['2', 0] },
      class_type: 'VAEDecode',
    },
    '12': {
      inputs: { filename_prefix: filenamePrefix, images: ['10', 0] },
      class_type: 'SaveImage',
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
    },
    '101': {
      inputs: { width, height, batch_size: frame_count },
      class_type: 'ADE_EmptyLatentImageLarge',
    },
    '102': {
      inputs: {
        upscale_method: 'nearest-exact',
        scale_by: 2,
        samples: ['7', 0],
      },
      class_type: 'LatentUpscaleBy',
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
    },
    '104': {
      inputs: { samples: ['103', 0], vae: ['2', 0] },
      class_type: 'VAEDecode',
    },
    '106': {
      inputs: {
        frame_rate,
        loop_count: 0,
        filename_prefix: filenamePrefix,
        format: 'video/h264-mp4',
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true,
        images: ['10', 0],
      },
      class_type: 'VHS_VideoCombine',
    },
  };
}

function createHunyuanWorkflow(params: {
  width: number;
  height: number;
  frame_count: number;
  steps: number;
  seed: number;
  prompt: string;
  frame_rate: number;
  filenamePrefix: string;
}) {
  const { width, height, frame_count, steps, seed, prompt, frame_rate, filenamePrefix } = params;

  return {
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
        width,
        height,
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
        filename_prefix: filenamePrefix,
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
  };
}
