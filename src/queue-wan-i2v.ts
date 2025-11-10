import { Queue } from 'bullmq';
import redisClient from './shared/redis.js';
import { existsSync, readFileSync } from 'fs';
import { R2UploadService } from './services/r2-upload.service.js';

async function processImageForEndpoint(imageInput: string, jobId: string): Promise<string> {
  const r2UploadService = new R2UploadService();
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

interface WanI2VJobData {
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
  flow_shift?: number;
  enable_prompt_optimization?: boolean;
  enable_safety_checker?: boolean;
}

async function queueWanI2VJob() {
  try {
    let inputData = '';

    // Read from stdin
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    if (!inputData.trim()) {
      console.error('Error: No input data provided');
      process.exit(1);
    }

    const jsonData: WanI2VJobData = JSON.parse(inputData);

    if (!jsonData.prompt || typeof jsonData.prompt !== 'string') {
      console.error('Error: prompt is required and must be a string');
      process.exit(1);
    }

    if (!jsonData.image || typeof jsonData.image !== 'string') {
      console.error('Error: image is required and must be a string');
      process.exit(1);
    }

    const processedImage = await processImageForEndpoint(jsonData.image, 'queue-script');

    const jobData: any = {
      infinidream_algorithm: 'wan-i2v',
      prompt: jsonData.prompt,
      image: processedImage,
      duration: jsonData.duration ?? 5,
      num_inference_steps: jsonData.num_inference_steps ?? 30,
      guidance: jsonData.guidance ?? 5,
      seed: jsonData.seed ?? -1,
      negative_prompt: jsonData.negative_prompt ?? '',
      flow_shift: jsonData.flow_shift ?? 5,
      enable_prompt_optimization: jsonData.enable_prompt_optimization ?? false,
      enable_safety_checker: jsonData.enable_safety_checker ?? true,
    };

    if (jsonData.size) {
      jobData.size = jsonData.size;
    } else if (jsonData.width || jsonData.height) {
      if (jsonData.width) jobData.width = jsonData.width;
      if (jsonData.height) jobData.height = jsonData.height;
    }

    // Queue the job
    const queue = new Queue('wani2v', {
      connection: redisClient,
    });

    const job = await queue.add('message', jobData);

    console.log(
      JSON.stringify({
        success: true,
        jobId: job.id,
        message: 'Job queued successfully',
      })
    );

    await queue.close();
    process.exit(0);
  } catch (error: any) {
    console.error('Error:', error.message || error);
    process.exit(1);
  }
}

queueWanI2VJob();
