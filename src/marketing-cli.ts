import 'dotenv/config';
import { Command } from 'commander';
import { request } from 'undici';
import env from './shared/env.js';
import { startMarketingEmailWorker } from './workers/marketing-email.worker.js';
import { Queue } from 'bullmq';
import redisClient from './shared/redis.js';

const program = new Command();

program
  .name('marketing-send')
  .description('Trigger marketing send via backend /marketing/send')
  .requiredOption('--template-id <id>', 'Resend template ID')
  .option('--dry-run', 'Dry run only (no enqueue)', false)
  .option('--limit <n>', 'Limit number of users', (value) => Number(value))
  .option('--offset <n>', 'Offset for users', (value) => Number(value));

const argv = process.argv[2] === '--' ? [process.argv[0], process.argv[1], ...process.argv.slice(3)] : process.argv;
program.parse(argv);

const opts = program.opts();

const parseOptionalNumber = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return parsed;
};

const run = async () => {
  if (!env.MARKETING_EMAIL_SECRET) {
    throw new Error('MARKETING_EMAIL_SECRET is required');
  }

  const worker = startMarketingEmailWorker();
  const queue = new Queue(env.MARKETING_QUEUE_NAME, { connection: redisClient });

  const body: Record<string, unknown> = {
    templateId: opts.templateId,
    dryRun: Boolean(opts.dryRun),
  };

  const limit = parseOptionalNumber(opts.limit, 'limit');
  const offset = parseOptionalNumber(opts.offset, 'offset');
  if (limit !== undefined) body.limit = limit;
  if (offset !== undefined) body.offset = offset;

  const { statusCode, body: responseBody } = await request(`${env.BACKEND_URL}/marketing/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Email-Secret': env.MARKETING_EMAIL_SECRET,
    },
    body: JSON.stringify(body),
  });

  const output = (await responseBody.json().catch(async () => {
    const text = await responseBody.text();
    return text ? { raw: text } : {};
  })) as { data?: { queued?: number } } & Record<string, unknown>;

  if (statusCode < 200 || statusCode >= 300) {
    console.error(`Request failed (${statusCode})`);
    console.error(JSON.stringify(output, null, 2));
    await queue.close();
    await worker.close();
    process.exit(1);
  }

  console.log(JSON.stringify(output, null, 2));

  const queued = typeof output.data?.queued === 'number' ? output.data.queued : 0;

  if (queued === 0) {
    await queue.close();
    await worker.close();
    process.exit(0);
  }

  const interval = setInterval(async () => {
    try {
      const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'paused');
      const remaining = (counts.wait || 0) + (counts.active || 0) + (counts.delayed || 0) + (counts.paused || 0);

      if (remaining === 0) {
        clearInterval(interval);
        await queue.close();
        await worker.close();
        process.exit(0);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
  }, 5000);

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await queue.close();
    await worker.close();
    process.exit(0);
  });
};

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
