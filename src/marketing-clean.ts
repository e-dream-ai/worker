import 'dotenv/config';
import { Command } from 'commander';
import { Queue } from 'bullmq';
import env from './shared/env.js';
import redisClient from './shared/redis.js';

const program = new Command();

program
  .name('marketing-clean')
  .description('Remove all jobs and metadata from the marketing email queue')
  .option('--yes', 'Confirm queue cleanup', false)
  .option('--dry-run', 'Print queue counts without deleting anything', false);

const argv = process.argv[2] === '--' ? [process.argv[0], process.argv[1], ...process.argv.slice(3)] : process.argv;
program.parse(argv);

const opts = program.opts<{ yes: boolean; dryRun: boolean }>();

const run = async () => {
  const queue = new Queue(env.MARKETING_QUEUE_NAME, { connection: redisClient });

  try {
    const counts = await queue.getJobCounts(
      'active',
      'completed',
      'delayed',
      'failed',
      'paused',
      'prioritized',
      'repeat',
      'waiting',
      'waiting-children'
    );

    console.log(`Queue: ${env.MARKETING_QUEUE_NAME}`);
    console.log(JSON.stringify(counts, null, 2));

    if (opts.dryRun) {
      return;
    }

    if (!opts.yes) {
      throw new Error('Refusing to clean queue without --yes');
    }

    await queue.pause();
    await queue.obliterate({ force: true });

    console.log(`Cleaned queue: ${env.MARKETING_QUEUE_NAME}`);
  } finally {
    await queue.close();
    await redisClient.quit();
  }
};

run().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await redisClient.quit();
  process.exit(1);
});
