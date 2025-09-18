import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import 'dotenv/config';
import express from 'express';
import basicAuth from 'express-basic-auth';
import env from './shared/env.js';
import redisClient from './shared/redis.js';
import { WorkerFactory } from './workers/worker.factory.js';
import {
  handleImageJob,
  handleVideoJob,
  handleHunyuanVideoJob,
  handleDeforumVideoJob,
} from './workers/job-handlers.js';

WorkerFactory.createWorker('image', handleImageJob);
WorkerFactory.createWorker('video', handleVideoJob);
WorkerFactory.createWorker('hunyuanvideo', handleHunyuanVideoJob);
WorkerFactory.createWorker('deforumvideo', handleDeforumVideoJob);

const deforumQueue = new Queue('deforumvideo', {
  connection: redisClient,
});
const hunyuanVideoQueue = new Queue('hunyuanvideo', {
  connection: redisClient,
});
const animatediffVideoQueue = new Queue('video', {
  connection: redisClient,
});
const imageQueue = new Queue('image', {
  connection: redisClient,
});

const activeJobs = await hunyuanVideoQueue.getJobs(['active']);
console.log(`Active jobs: ${JSON.stringify(activeJobs)}`);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(hunyuanVideoQueue),
    new BullMQAdapter(animatediffVideoQueue),
    new BullMQAdapter(imageQueue),
    new BullMQAdapter(deforumQueue),
  ],
  serverAdapter: serverAdapter,
});

const app = express();

app.use(
  '/admin',
  basicAuth({
    users: { admin: env.ADMIN_PASS },
    challenge: true,
  })
);

app.use('/admin/queues', serverAdapter.getRouter());

app.listen(env.PORT, () => {
  console.log(`Running on port ${env.PORT} in ${env.NODE_ENV} mode...`);
  console.log(`Admin UI: http://localhost:${env.PORT}/admin/queues`);
});
