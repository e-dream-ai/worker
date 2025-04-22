import { Job, Queue, QueueEvents } from 'bullmq';
import redisClient from './shared/redis.js';

const videoQueue = new Queue('hunyuanvideo', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

async function runVideo(frames: string[]) {
  // console.log(`frames: ${JSON.stringify(frames)}`)
  const job = {
    name: 'message',
    data: {
      prompt: frames.join(),
      pre_text: 'highly detailed, 4k, masterpiece',
      print_output: '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot',
      frame_count: 608, // should be a multiple of the context window of 16
      frame_rate: 16,
      seed: 832386334143550,
      steps: 30,
      motion_scale: 1,
      width: 1024,
      height: 768,
    },
  };

  console.log(`running: ${JSON.stringify(job)}`);
  return videoQueue.addBulk([job]);
}

// listen for job events and results. Note that it's best to deal with results directly in the worker
const queueEvents = new QueueEvents('video');
queueEvents.on('completed', async (data) => {
  const job = await Job.fromId(videoQueue, data.jobId);
  console.log(
    `\n${new Date().toISOString()}: Job finished: ${JSON.stringify(job?.returnvalue)} for job ${JSON.stringify(job)}`
  );
});
let lastprogress = '';
queueEvents.on('progress', (data) => {
  const progress = JSON.stringify(data);
  if (lastprogress != progress) {
    console.log(`\n${new Date().toISOString()}: Job progress: ${progress}`);
    lastprogress = progress;
  } else {
    process.stdout.write('.');
  }
});
queueEvents.on('failed', async (data) => {
  const job = await Job.fromId(videoQueue, data.jobId);
  console.log(`\n${new Date().toISOString()}: Job failed:   ${job.failedReason} for job ${JSON.stringify(job)}`);
});

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

const prompt = process.argv.slice(2).join(' ');
await runVideo(prompt.split(','));
