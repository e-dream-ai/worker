import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import 'dotenv/config';
import express from 'express';
import basicAuth from 'express-basic-auth';
import multer from 'multer';
import env from './shared/env.js';
import redisClient from './shared/redis.js';
import { R2UploadService } from './services/r2-upload.service.js';
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

const upload = multer({ storage: multer.memoryStorage() });
const r2UploadService = new R2UploadService();

app.use(express.json());

app.use(
  '/admin',
  basicAuth({
    users: { admin: env.ADMIN_PASS },
    challenge: true,
  })
);

app.use('/admin/queues', serverAdapter.getRouter());

app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const tempJobId = `upload-${Date.now()}`;
    const filename = req.file.originalname || `image-${Date.now()}.png`;

    const imageBuffer = req.file.buffer;
    const presignedUrl = await r2UploadService.uploadImageBufferToR2(imageBuffer, tempJobId, filename);

    res.json({ url: presignedUrl });
  } catch (error: any) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: error.message || 'Failed to upload image' });
  }
});

app.listen(env.PORT, () => {
  console.log(`Running on port ${env.PORT} in ${env.NODE_ENV} mode...`);
  console.log(`Admin UI: http://localhost:${env.PORT}/admin/queues`);
});
