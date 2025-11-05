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
  handleUprezVideoJob,
  handleWanT2VJob,
  handleWanI2VJob,
  handleWanI2VLoraJob,
} from './workers/job-handlers.js';

WorkerFactory.createWorker('image', handleImageJob);
WorkerFactory.createWorker('video', handleVideoJob);
WorkerFactory.createWorker('hunyuanvideo', handleHunyuanVideoJob);
WorkerFactory.createWorker('deforumvideo', handleDeforumVideoJob);
WorkerFactory.createWorker('uprezvideo', handleUprezVideoJob);
WorkerFactory.createWorker('want2v', handleWanT2VJob);
WorkerFactory.createWorker('wani2v', handleWanI2VJob);
WorkerFactory.createWorker('wani2vlora', handleWanI2VLoraJob);

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
const uprezVideoQueue = new Queue('uprezvideo', {
  connection: redisClient,
});
const wanT2VQueue = new Queue('want2v', {
  connection: redisClient,
});
const wanI2VQueue = new Queue('wani2v', {
  connection: redisClient,
});
const wanI2VLoraQueue = new Queue('wani2vlora', {
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
    new BullMQAdapter(uprezVideoQueue),
    new BullMQAdapter(wanT2VQueue),
    new BullMQAdapter(wanI2VQueue),
    new BullMQAdapter(wanI2VLoraQueue),
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
