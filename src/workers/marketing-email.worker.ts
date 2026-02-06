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

type StartMarketingWorkerOptions = {
  emailSecret?: string;
  backendUrl?: string;
};

export const startMarketingEmailWorker = (opts?: StartMarketingWorkerOptions): Worker => {
  const emailSecret = opts?.emailSecret ?? env.MARKETING_EMAIL_SECRET;
  const backendUrl = opts?.backendUrl ?? env.BACKEND_URL;

  if (!emailSecret) {
    throw new Error('email secret is required to send marketing emails');
  }

  const worker = new Worker<MarketingJobData>(
    env.MARKETING_QUEUE_NAME,
    async (job) => {
      const { email, templateId, unsubscribeToken } = job.data;
      await job.log(`Starting send: email=${email} templateId=${templateId}`);

      const { statusCode, body } = await request(`${backendUrl}/marketing/send-one`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Email-Secret': emailSecret,
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
        throw new Error(`Backend send-one failed: ${statusCode} ${errorText}`);
      }

      await job.log(`Send succeeded: status=${statusCode}`);
      return { statusCode, email, templateId };
    },
    {
      connection: redisClient,
      concurrency: env.MARKETING_CONCURRENCY,
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

  console.log(`Marketing email worker listening on ${env.MARKETING_QUEUE_NAME}`);
  return worker;
};
