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

interface LtxI2VParams {
  prompt: string;
  image: string;
  negative_prompt?: string;
  duration?: number;
  seed?: number;
  lora?: string;
  lora_strength?: number;
  high_noise_loras?: LoRAConfig[];
  low_noise_loras?: LoRAConfig[];
}

interface NvidiaVsrParams {
  video_url?: string;
  video_uuid?: string;
  upscale_factor?: number;
  quality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
}

interface QwenImageParams {
  prompt: string;
  size?: string;
  seed?: number;
  negative_prompt?: string;
  enable_safety_checker?: boolean;
}

type ZImageTurboSize =
  | '512*512'
  | '768*768'
  | '1024*1024'
  | '1280*1280'
  | '1024*768'
  | '768*1024'
  | '1280*720'
  | '720*1280';

type ZImageTurboOutputFormat = 'png' | 'jpeg' | 'webp';

interface ZImageTurboParams {
  prompt: string;
  image?: string;
  size?: ZImageTurboSize;
  strength?: number;
  seed?: number;
  output_format?: ZImageTurboOutputFormat;
  enable_safety_checker?: boolean;
}

export async function handleVideoIngestJob(job: Job): Promise<any> {
  const { dream_uuid, extension, type = 'video' } = job.data;

  if (!dream_uuid) {
    throw new Error('dream_uuid is required');
  }

  const input: Record<string, unknown> = {
    type,
    dream_uuid,
  };

  if (extension) {
    input.extension = extension;
  }

  const { id: runpodId } = await endpoints.videoingest.run({ input });
  await job.updateData({ ...job.data, runpod_id: runpodId });
  return statusHandler.handleStatus(endpoints.videoingest, runpodId, job);
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
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
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
    await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
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
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleUprezVideoJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
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
    dream_uuid,
    auto_upload = true,
  } = job.data as Wan22T2V720Params & { dream_uuid?: string; auto_upload?: boolean };

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
  const result = await statusHandler.handleStatus(endpoints.wanT2V, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleWanT2VJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
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
    dream_uuid,
    auto_upload = true,
  } = job.data as Wan22I2V720Params & { dream_uuid?: string; auto_upload?: boolean };

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  if (!image || typeof image !== 'string') {
    throw new Error('image is required and must be a string URL, local file path, base64 string, or dream UUID');
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
  const result = await statusHandler.handleStatus(endpoints.wanI2V, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleWanI2VJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
}

function isUuid(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

async function resolveImageFromDreamUuid(dreamUuid: string): Promise<string> {
  try {
    const dream = await videoServiceClient.getDreamInfo(dreamUuid);

    if (dream.mediaType !== 'image') {
      throw new Error(`Dream ${dreamUuid} is not an image dream (mediaType: ${dream.mediaType})`);
    }

    const imageUrl = dream.video || dream.original_video;

    if (!imageUrl) {
      throw new Error(`Dream ${dreamUuid} does not have an image URL (video or original_video)`);
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return `https://${imageUrl}`;
    }

    return imageUrl;
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Dream ${dreamUuid} not found`);
    }
    if (error.message?.includes('not an image dream') || error.message?.includes('does not have an image URL')) {
      throw error;
    }
    throw new Error(`Failed to resolve image from dream UUID ${dreamUuid}: ${error.message || error}`);
  }
}

async function processImageForEndpoint(imageInput: string, jobId: string): Promise<string> {
  if (isUuid(imageInput)) {
    return await resolveImageFromDreamUuid(imageInput);
  }

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
    throw new Error(`Image input "${imageInput}" is not a valid URL, existing file path, base64 string, or dream UUID`);
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
    dream_uuid,
    auto_upload = true,
  } = job.data as Wan22I2VLoraParams & { dream_uuid?: string; auto_upload?: boolean };

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
      throw new Error('image must be a string URL, local file path, base64 string, or dream UUID');
    }
    input.image = await processImageForEndpoint(image, String(job.id));
  }

  if (last_image) {
    if (typeof last_image !== 'string') {
      throw new Error('last_image must be a string URL, local file path, base64 string, or dream UUID');
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
  const result = await statusHandler.handleStatus(endpoints.wanI2VLora, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleWanI2VLoraJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
}

export async function handleQwenImageJob(job: Job): Promise<any> {
  const {
    prompt,
    size,
    seed = -1,
    negative_prompt = '',
    enable_safety_checker = true,
    dream_uuid,
    auto_upload = true,
  } = job.data as QwenImageParams & { dream_uuid?: string; auto_upload?: boolean };

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
  const result = await statusHandler.handleStatus(endpoints.qwenImage, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedImage(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated image for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleQwenImageJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
}

export async function handleZImageTurboJob(job: Job): Promise<any> {
  const {
    prompt,
    image,
    size,
    strength = 0.8,
    seed = -1,
    output_format = 'png',
    enable_safety_checker = true,
    dream_uuid,
    auto_upload = true,
  } = job.data as ZImageTurboParams & { dream_uuid?: string; auto_upload?: boolean };

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  const input: Record<string, unknown> = {
    prompt,
    seed,
    output_format,
    enable_safety_checker,
  };

  if (image) {
    input.image = image;
    input.strength = strength;
  }

  const VALID_SIZES: ZImageTurboSize[] = [
    '512*512',
    '768*768',
    '1024*1024',
    '1280*1280',
    '1024*768',
    '768*1024',
    '1280*720',
    '720*1280',
  ];
  const VALID_OUTPUT_FORMATS: ZImageTurboOutputFormat[] = ['png', 'jpeg', 'webp'];

  if (size) {
    if (!VALID_SIZES.includes(size)) {
      throw new Error(`size must be one of: ${VALID_SIZES.join(', ')}`);
    }
    input.size = size;
  }

  if (!VALID_OUTPUT_FORMATS.includes(output_format)) {
    throw new Error(`output_format must be one of: ${VALID_OUTPUT_FORMATS.join(', ')}`);
  }

  const { id: runpodId } = await endpoints.zImageTurbo.run(input);
  await job.updateData({ ...job.data, runpod_id: runpodId });
  const result = await statusHandler.handleStatus(endpoints.zImageTurbo, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedImage(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated image for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleZImageTurboJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
}

export async function handleLtxI2VJob(job: Job): Promise<any> {
  const {
    prompt,
    image,
    negative_prompt = 'worst quality, blurry, distorted, watermark, text, low quality',
    duration = 2,
    seed = -1,
    lora = 'ltx-2-19b-lora-camera-control-static.safetensors',
    lora_strength = 0.4,
    high_noise_loras,
    dream_uuid,
    auto_upload = true,
  } = job.data as LtxI2VParams & { dream_uuid?: string; auto_upload?: boolean };

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }

  if (!image || typeof image !== 'string') {
    throw new Error('image is required and must be a string URL, local file path, base64 string, or dream UUID');
  }

  const resolvedImage = await processImageForEndpoint(image, String(job.id));

  // Build LoRA config for Power Lora Loader — supports single lora param or high_noise_loras array
  let loraConfig: { on: boolean; lora: string; strength: number } | undefined;
  if (high_noise_loras && Array.isArray(high_noise_loras)) {
    const valid = high_noise_loras.filter((l) => l && l.path && l.path.trim() !== '');
    if (valid.length > 0) {
      loraConfig = { on: true, lora: valid[0].path, strength: valid[0].scale };
    }
  }
  if (!loraConfig && lora) {
    loraConfig = { on: true, lora, strength: lora_strength };
  }

  // Compute frame count from duration: 1 + 8 * round(fps * duration / 8)
  const fps = 24;
  const frameCount = 1 + 8 * Math.round((fps * duration) / 8);
  const noiseSeed = seed === -1 ? Math.floor(Math.random() * 1_000_000) : seed;
  const filenamePrefix = String(job.id);

  const workflow = createLtxI2VWorkflow({
    prompt,
    negative_prompt,
    frameCount,
    fps,
    noiseSeed,
    loraConfig,
    filenamePrefix,
  });

  // Image is uploaded separately — rp_handler loads it via ComfyUI's upload API
  const { id: runpodId } = await endpoints.ltxI2V.run({
    input: {
      workflow,
      images: [
        {
          name: 'input.png',
          image: resolvedImage,
        },
      ],
    },
  });

  await job.updateData({ ...job.data, runpod_id: runpodId });
  const result = await statusHandler.handleStatus(endpoints.ltxI2V, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleLtxI2VJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
}

export async function handleNvidiaVsrJob(job: Job): Promise<any> {
  const {
    video_url,
    video_uuid,
    upscale_factor = 2,
    quality = 'HIGH',
    dream_uuid,
    auto_upload = true,
  } = job.data as NvidiaVsrParams & { dream_uuid?: string; auto_upload?: boolean };

  const input: Record<string, unknown> = {
    upscale_factor,
    quality,
  };

  const provided = [video_url, video_uuid].filter(Boolean);
  if (provided.length === 0) {
    throw new Error("Provide one of 'video_url' or 'video_uuid'");
  }
  if (provided.length > 1) {
    throw new Error("Provide only one of 'video_url' or 'video_uuid'");
  }

  if (video_url) {
    input.video_url = video_url;
  } else if (video_uuid) {
    input.video_uuid = video_uuid;
  }

  const { id: runpodId } = await endpoints.nvidiaVsr.run({ input });
  await job.updateData({ ...job.data, runpod_id: runpodId });
  const result = await statusHandler.handleStatus(endpoints.nvidiaVsr, runpodId, job);

  if (dream_uuid && auto_upload !== false && result?.r2_url) {
    try {
      await videoServiceClient.uploadGeneratedVideo(dream_uuid, result.r2_url, result.render_duration);
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dream_uuid}:`, error.message || error);
    }
  } else if (dream_uuid) {
    console.error(`[handleNvidiaVsrJob] Upload skipped for dream ${dream_uuid}:`, {
      has_dream_uuid: !!dream_uuid,
      auto_upload,
      has_r2_url: !!result?.r2_url,
      result_keys: result ? Object.keys(result) : 'no result',
      result: result,
    });
  }

  return result;
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

function createLtxI2VWorkflow(params: {
  prompt: string;
  negative_prompt: string;
  frameCount: number;
  fps: number;
  noiseSeed: number;
  loraConfig?: { on: boolean; lora: string; strength: number };
  filenamePrefix: string;
}) {
  const { prompt, negative_prompt, frameCount, fps, noiseSeed, loraConfig, filenamePrefix } = params;

  // Node 1: Load distilled transformer
  // Node 2: DualCLIPLoader (Gemma 3 + text projection)
  // Node 3: Video VAE
  // Node 4: Audio VAE (KJNodes)
  // Node 5: Spatial upscaler
  // Node 6: Power Lora Loader
  // Node 10-12: Text encoding + conditioning
  // Node 20-21: Image loading + preprocess
  // Node 30-33: Latent setup (video + audio)
  // Node 40-45: Pass 1 (8 steps, LCM, LTXVScheduler)
  // Node 50-52: Spatial upscale + re-inject image + recombine audio
  // Node 60-65: Pass 2 (3 steps, LCM, ManualSigmas)
  // Node 70-71: Decode (video tiled + audio)
  // Node 80: Output (VHS_VideoCombine)

  const loraNode: Record<string, unknown> = {
    inputs: {
      model: ['1', 0],
    },
    class_type: 'Power Lora Loader (rgthree)',
  };
  if (loraConfig) {
    (loraNode.inputs as Record<string, unknown>).lora_01 = loraConfig;
  }

  return {
    // ── Model Loading ──
    '1': {
      inputs: {
        unet_name: 'ltx-2.3-22b-distilled_transformer_only_fp8_scaled.safetensors',
        weight_dtype: 'default',
      },
      class_type: 'UNETLoader',
    },
    '2': {
      inputs: {
        clip_name1: 'gemma_3_12B_it_fpmixed.safetensors',
        clip_name2: 'ltx-2.3_text_projection_bf16.safetensors',
        type: 'ltx',
      },
      class_type: 'DualCLIPLoader',
    },
    '3': {
      inputs: { vae_name: 'LTX23_video_vae_bf16.safetensors' },
      class_type: 'VAELoader',
    },
    '4': {
      inputs: { vae_name: 'LTX23_audio_vae_bf16.safetensors' },
      class_type: 'VAELoaderKJ',
    },
    '5': {
      inputs: { upscale_model_name: 'ltx-2.3-spatial-upscaler-x2-1.0.safetensors' },
      class_type: 'LatentUpscaleModelLoader',
    },
    '6': loraNode,

    // ── Text Encoding ──
    '10': {
      inputs: { text: prompt, clip: ['2', 0] },
      class_type: 'CLIPTextEncode',
    },
    '11': {
      inputs: { text: negative_prompt, clip: ['2', 0] },
      class_type: 'CLIPTextEncode',
    },
    '12': {
      inputs: { positive: ['10', 0], negative: ['11', 0], frame_rate: fps },
      class_type: 'LTXVConditioning',
    },

    // ── Image Input ──
    '20': {
      inputs: { image: 'input.png', upload: 'image' },
      class_type: 'LoadImage',
    },
    '21': {
      inputs: { image: ['20', 0], num_frames: 33 },
      class_type: 'LTXVPreprocess',
    },

    // ── Latent Setup ──
    '30': {
      inputs: { width: 704, height: 512, length: frameCount, batch_size: 1 },
      class_type: 'EmptyLTXVLatentVideo',
    },
    '31': {
      inputs: { num_frames: frameCount, frame_rate: fps, batch_size: 1 },
      class_type: 'LTXVEmptyLatentAudio',
    },
    '32': {
      inputs: { latent: ['30', 0], ref_image: ['21', 0], bypass: false },
      class_type: 'LTXVImgToVideoInplace',
    },
    '33': {
      inputs: { samples_video: ['32', 0], samples_audio: ['31', 0] },
      class_type: 'LTXVConcatAVLatent',
    },

    // ── Pass 1: Low-res (8 steps, LCM, LTXVScheduler) ──
    '40': {
      inputs: { steps: 8, max_shift: 2.05, min_shift: 0.95, reverse: true, base_shift: 0.1 },
      class_type: 'LTXVScheduler',
    },
    '41': {
      inputs: { sampler_name: 'lcm' },
      class_type: 'KSamplerSelect',
    },
    '42': {
      inputs: { noise_seed: noiseSeed },
      class_type: 'RandomNoise',
    },
    '43': {
      inputs: { model: ['6', 0], positive: ['12', 0], negative: ['12', 1], cfg: 1.0 },
      class_type: 'CFGGuider',
    },
    '44': {
      inputs: {
        noise: ['42', 0],
        guider: ['43', 0],
        sampler: ['41', 0],
        sigmas: ['40', 0],
        latent_image: ['33', 0],
      },
      class_type: 'SamplerCustomAdvanced',
    },
    '45': {
      inputs: { samples: ['44', 0] },
      class_type: 'LTXVSeparateAVLatent',
    },

    // ── Spatial Upscale + Pass 2 ──
    '50': {
      inputs: { samples: ['45', 0], upscale_model: ['5', 0], vae: ['3', 0] },
      class_type: 'LTXVLatentUpsampler',
    },
    '51': {
      inputs: { latent: ['50', 0], ref_image: ['21', 0], bypass: false },
      class_type: 'LTXVImgToVideoInplace',
    },
    '52': {
      inputs: { samples_video: ['51', 0], samples_audio: ['45', 1] },
      class_type: 'LTXVConcatAVLatent',
    },
    '60': {
      inputs: { floats: '0.909375, 0.725, 0.421875, 0.0' },
      class_type: 'ManualSigmas',
    },
    '61': {
      inputs: { sampler_name: 'lcm' },
      class_type: 'KSamplerSelect',
    },
    '62': {
      inputs: { noise_seed: noiseSeed + 377 },
      class_type: 'RandomNoise',
    },
    '63': {
      inputs: { model: ['6', 0], positive: ['12', 0], negative: ['12', 1], cfg: 1.0 },
      class_type: 'CFGGuider',
    },
    '64': {
      inputs: {
        noise: ['62', 0],
        guider: ['63', 0],
        sampler: ['61', 0],
        sigmas: ['60', 0],
        latent_image: ['52', 0],
      },
      class_type: 'SamplerCustomAdvanced',
    },
    '65': {
      inputs: { samples: ['64', 0] },
      class_type: 'LTXVSeparateAVLatent',
    },

    // ── Decode + Output ──
    '70': {
      inputs: { tile_size: 512, overlap: 64, samples: ['65', 0], vae: ['3', 0] },
      class_type: 'VAEDecodeTiled',
    },
    '71': {
      inputs: { samples: ['65', 1], vae: ['4', 0] },
      class_type: 'LTXVAudioVAEDecode',
    },
    '80': {
      inputs: {
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: filenamePrefix,
        format: 'video/h264-mp4',
        pix_fmt: 'yuv420p',
        crf: 19,
        save_metadata: true,
        pingpong: false,
        save_output: true,
        images: ['70', 0],
        audio: ['71', 0],
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
