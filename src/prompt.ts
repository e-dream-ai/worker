import { Job, Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

// Queue to add jobs
const runpodQueue = new Queue('video', { connection: redisClient });
async function run(firstFrame: string) {
  return runpodQueue.addBulk([
    {
      name: 'message',
      data: {
        prompt: {
          '0': firstFrame,
          '50': 'layered pointillist mitochondria from dreamtime',
          '100': 'rave detailed Abstract  spiritual  Paintings',
          '150': 'abstract art based on Kabbalah astrological chart',
          '200': 'intricate futuristic iridescent multicolored japanese radiolaria',
          '250': 'DMT painting android bio nano techno',
          '300': 'cubist painting of the ayahuasca experience',
        },
        pre_text: 'highly detailed, 4k, masterpiece',
        print_output: '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot',
        frame_count: 24,
        frame_rate: 8,
      },
    },
  ]);
}

// listen for job events and results. Note that it's best to deal with results directly in the worker
const queueEvents = new QueueEvents('video');
queueEvents.on('completed', async (data) => {
  const job = await Job.fromId(runpodQueue, data.jobId);
  console.log(`Job finished: ${JSON.stringify(job?.returnvalue)}`);
  process.exit();
});
queueEvents.on('progress', (data) => {
  console.log(`Job progress: ${JSON.stringify(data)}`);
});

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

const prompt = process.argv.slice(2).join(' ');
await run(prompt);
