import { Queue, Worker } from 'bullmq';
import { request } from 'undici';
import redisClient from '../shared/redis.js';
import env from '../shared/env.js';

export type MarketingJobData = {
  userId: number;
  email: string;
  templateId: string;
  unsubscribeToken: string;
};

type StartMarketingWorkerOptions = {
  emailSecret?: string;
  backendUrl?: string;
  apiKey?: string;
};

const getRetryAfterMs = (retryAfterHeader: string | string[] | undefined): number => {
  const retryAfter = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }

  return 5000;
};

export const startMarketingEmailWorker = (opts?: StartMarketingWorkerOptions): Worker => {
  const emailSecret = opts?.emailSecret ?? env.MARKETING_EMAIL_SECRET;
  const backendUrl = opts?.backendUrl ?? env.BACKEND_URL;
  const apiKey = opts?.apiKey ?? env.BACKEND_API_KEY;

  if (!emailSecret) {
    throw new Error('email secret is required to send marketing emails');
  }
  if (!apiKey) {
    throw new Error('backend api key is required to send marketing emails');
  }

  const rateLimitQueue = new Queue(env.MARKETING_QUEUE_NAME, { connection: redisClient });
  const worker = new Worker<MarketingJobData>(
    env.MARKETING_QUEUE_NAME,
    async (job) => {
      const { email, templateId, unsubscribeToken } = job.data;
      await job.log(`Starting send: email=${email} templateId=${templateId}`);

      const { statusCode, headers, body } = await request(`${backendUrl}/marketing/send-one`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Email-Secret': emailSecret,
          Authorization: `Api-Key ${apiKey}`,
        },
        body: JSON.stringify({
          email,
          templateId,
          unsubscribeToken,
        }),
      });

      if (statusCode < 200 || statusCode >= 300) {
        const errorText = await body.text();
        await job.log(`Send failed: status=${statusCode} body=${errorText}`);
        if (statusCode === 403) {
          job.discard();
        }
        if (statusCode === 429) {
          const retryAfterMs = getRetryAfterMs(headers['retry-after']);
          await job.log(`Rate limited. Pausing queue for ${retryAfterMs}ms`);
          await rateLimitQueue.rateLimit(retryAfterMs);
          throw Worker.RateLimitError();
        }
        throw new Error(`Backend send-one failed: ${statusCode} ${errorText}`);
      }

      await job.log(`Send succeeded: status=${statusCode}`);
      return { statusCode, email, templateId };
    },
    {
      connection: redisClient,
      concurrency: env.MARKETING_CONCURRENCY,
      limiter: {
        max: env.MARKETING_RATE_LIMIT_PER_SECOND,
        duration: 1000,
      },
      lockDuration: 60000,
      stalledInterval: 30000,
      maxStalledCount: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`Marketing email job completed: ${job.id} email=${job.data?.email}`);
  });

  worker.on('failed', (job, error) => {
    const attempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const isFinalFailure = attemptsMade >= attempts;

    if (isFinalFailure) {
      console.error(
        `Marketing email job final failure: ${job?.id ?? 'unknown'} attempts=${attemptsMade}/${attempts} error: ${error?.message || error}`
      );
      return;
    }

    console.error(
      `Marketing email job retrying: ${job?.id ?? 'unknown'} attempts=${attemptsMade}/${attempts} error: ${error?.message || error}`
    );
  });

  worker.on('error', (error) => {
    console.error(`Marketing email worker error: ${error?.message || error}`);
  });

  const closeWorker = worker.close.bind(worker);
  worker.close = async (force?: boolean) => {
    try {
      await closeWorker(force);
    } finally {
      await rateLimitQueue.close();
    }
  };

  console.log(
    `Marketing email worker listening on ${env.MARKETING_QUEUE_NAME} at ${env.MARKETING_RATE_LIMIT_PER_SECOND}/sec`
  );
  return worker;
};
