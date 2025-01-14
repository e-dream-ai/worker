import { Job, Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

// Queue to add jobs
const runpodQueue = new Queue('image', { connection: redisClient });
async function run(prompt: string) {
  return await runpodQueue.addBulk([
    {
      name: 'message',
      data: {
        prompt,
      },
    },
  ]);
}

// listen for job events and results. Note that it's best to deal with results directly in the worker
const queueEvents = new QueueEvents('image');
queueEvents.on('completed', async (data) => {
  const job = await Job.fromId(runpodQueue, data.jobId);
  console.log(`Job finished: ${JSON.stringify(job?.returnvalue)}`);
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
