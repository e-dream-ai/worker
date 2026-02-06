import { Worker } from 'bullmq';
import { request } from 'undici';
import redisClient from '../shared/redis.js';
import env from '../shared/env.js';

export type MarketingJobData = {
  userId: number;
  email: string;
  templateId: string;
  unsubscribeToken: string;
};

export const startMarketingEmailWorker = (): Worker => {
  if (!env.MARKETING_EMAIL_SECRET) {
    throw new Error('MARKETING_EMAIL_SECRET is required to send marketing emails');
  }

  const worker = new Worker<MarketingJobData>(
    env.MARKETING_QUEUE_NAME,
    async (job) => {
      const { email, templateId, unsubscribeToken } = job.data;

      const { statusCode, body } = await request(`${env.BACKEND_URL}/marketing/send-one`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Email-Secret': env.MARKETING_EMAIL_SECRET,
        },
        body: JSON.stringify({
          email,
          templateId,
          unsubscribeToken,
        }),
      });

      if (statusCode < 200 || statusCode >= 300) {
        const errorText = await body.text();
        throw new Error(`Backend send-one failed: ${statusCode} ${errorText}`);
      }
    },
    {
      connection: redisClient,
      concurrency: env.MARKETING_CONCURRENCY,
      lockDuration: 60000,
      stalledInterval: 30000,
      maxStalledCount: 2,
    }
  );

  worker.on('failed', (job, error) => {
    console.error(`Marketing email job failed: ${job?.id ?? 'unknown'} error: ${error?.message || error}`);
  });

  worker.on('error', (error) => {
    console.error(`Marketing email worker error: ${error?.message || error}`);
  });

  console.log(`Marketing email worker listening on ${env.MARKETING_QUEUE_NAME}`);
  return worker;
};
