import { Job, Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

const videoQueue = new Queue('video', {
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
      prompt: {
        '0': frames[0] || 'cubist painting of the ayahuasca experience',
        '50': frames[1] || 'layered pointillist mitochondria from dreamtime',
        '100': frames[2] || 'rave detailed Abstract  spiritual  Paintings',
        '150': frames[3] || 'abstract art based on Kabbalah astrological chart',
        '200': frames[4] || 'intricate futuristic iridescent multicolored japanese radiolaria',
        '250': frames[5] || 'DMT painting android bio nano techno',
        '304': frames[0] || 'cubist painting of the ayahuasca experience',
      },
      pre_text: 'highly detailed, 4k, masterpiece',
      print_output: '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot',
      frame_count: 304, // should be a multiple of the context window of 16
      frame_rate: 8,
    },
  };

  console.log(`running: ${JSON.stringify(job)}`);
  return videoQueue.addBulk([job]);
}

// listen for job events and results. Note that it's best to deal with results directly in the worker
const queueEvents = new QueueEvents('video');
queueEvents.on('completed', async (data) => {
  const job = await Job.fromId(videoQueue, data.jobId);
  console.log(`Job finished: ${JSON.stringify(job?.returnvalue)} for job ${JSON.stringify(job)}`);
  process.exit();
});
let lastprogress = '';
queueEvents.on('progress', (data) => {
  const progress = JSON.stringify(data);
  if (lastprogress != progress) {
    console.log(`Job progress: ${progress}`);
    lastprogress = progress;
  } else {
    process.stdout.write('.');
  }
});
queueEvents.on('failed', async (data) => {
  const job = await Job.fromId(videoQueue, data.jobId);
  console.log(`Job failed:   ${job.failedReason} for job ${JSON.stringify(job)}`);
});

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

const prompt = process.argv.slice(2).join(' ');
await runVideo(prompt.split(','));
