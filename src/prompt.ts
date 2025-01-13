import { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

const prompt = process.argv.slice(2).join(' ');

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

// handle queued messages
var runpodQueue = new Queue(
  'runpod',
  { connection: redisClient }
);


async function run(prompt:string) {
  await runpodQueue.addBulk([
    {
      name: 'runpod',
      data: {
        prompt
      },
    }
  ])
}

run(prompt).then(() => process.exit())