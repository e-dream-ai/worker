import { Queue } from 'bullmq';
import redisClient from './shared/redis.js';

interface UprezJobData {
  infinidream_algorithm: 'uprez';
  video_uuid?: string;
  video_url?: string;
  video_path?: string;
  upscale_factor?: number;
  interpolation_factor?: number;
  output_format?: string;
  output_fps?: number;
  tile_size?: number;
  tile_padding?: number;
  quality?: string;
}

async function queueUprezJob() {
  try {
    let inputData = '';

    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    if (!inputData.trim()) {
      console.error('Error: No input data provided');
      process.exit(1);
    }

    const jsonData: UprezJobData = JSON.parse(inputData);

    if (!jsonData.infinidream_algorithm || jsonData.infinidream_algorithm !== 'uprez') {
      console.error('Error: infinidream_algorithm must be "uprez"');
      process.exit(1);
    }

    const provided = [jsonData.video_url, jsonData.video_uuid, jsonData.video_path].filter(Boolean);
    if (provided.length === 0) {
      console.error('Error: Provide one of video_url, video_uuid, or video_path');
      process.exit(1);
    }
    if (provided.length > 1) {
      console.error('Error: Provide only one of video_url, video_uuid, or video_path');
      process.exit(1);
    }

    const jobData: any = {
      infinidream_algorithm: 'uprez',
      upscale_factor: jsonData.upscale_factor ?? 2,
      interpolation_factor: jsonData.interpolation_factor ?? 2,
      output_format: jsonData.output_format ?? 'mp4',
      tile_size: jsonData.tile_size ?? 1024,
      tile_padding: jsonData.tile_padding ?? 10,
      quality: jsonData.quality ?? 'high',
    };

    if (jsonData.video_url) {
      jobData.video_url = jsonData.video_url;
    } else if (jsonData.video_uuid) {
      jobData.video_uuid = jsonData.video_uuid;
    } else if (jsonData.video_path) {
      jobData.video_path = jsonData.video_path;
    }

    if (typeof jsonData.output_fps === 'number') {
      jobData.output_fps = jsonData.output_fps;
    }

    const queue = new Queue('uprezvideo', {
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

queueUprezJob();
