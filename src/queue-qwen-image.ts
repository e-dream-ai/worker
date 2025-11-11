import { Queue } from 'bullmq';
import redisClient from './shared/redis.js';

interface QwenImageJobData {
  prompt: string;
  size?: string;
  seed?: number;
  negative_prompt?: string;
  enable_safety_checker?: boolean;
}

async function queueQwenImageJob() {
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

    const jsonData: QwenImageJobData = JSON.parse(inputData);

    if (!jsonData.prompt || typeof jsonData.prompt !== 'string') {
      console.error('Error: prompt is required and must be a string');
      process.exit(1);
    }

    const jobData: any = {
      infinidream_algorithm: 'qwen-image',
      prompt: jsonData.prompt,
      seed: jsonData.seed ?? -1,
      negative_prompt: jsonData.negative_prompt ?? '',
      enable_safety_checker: jsonData.enable_safety_checker ?? true,
    };

    if (jsonData.size) {
      jobData.size = jsonData.size;
    }

    const queue = new Queue('qwenimage', {
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

queueQwenImageJob();
