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
  handleQwenImageJob,
  handleZImageTurboJob,
  handleVideoIngestJob,
} from './workers/job-handlers.js';

WorkerFactory.createWorker('image', handleImageJob);
WorkerFactory.createWorker('video', handleVideoJob);
WorkerFactory.createWorker('hunyuanvideo', handleHunyuanVideoJob);
WorkerFactory.createWorker('deforumvideo', handleDeforumVideoJob);
WorkerFactory.createWorker('uprezvideo', handleUprezVideoJob);
WorkerFactory.createWorker('want2v', handleWanT2VJob);
WorkerFactory.createWorker('wani2v', handleWanI2VJob);
WorkerFactory.createWorker('wani2vlora', handleWanI2VLoraJob);
WorkerFactory.createWorker('qwenimage', handleQwenImageJob);
WorkerFactory.createWorker('zimageturbo', handleZImageTurboJob);
WorkerFactory.createWorker('videoingest', handleVideoIngestJob);

const deforumQueue = new Queue('deforumvideo', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100, // Limit event stream to last 100 events to reduce Redis memory usage
    },
  },
});
const hunyuanVideoQueue = new Queue('hunyuanvideo', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const animatediffVideoQueue = new Queue('video', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const imageQueue = new Queue('image', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const uprezVideoQueue = new Queue('uprezvideo', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const wanT2VQueue = new Queue('want2v', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const wanI2VQueue = new Queue('wani2v', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const wanI2VLoraQueue = new Queue('wani2vlora', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const qwenImageQueue = new Queue('qwenimage', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const zImageTurboQueue = new Queue('zimageturbo', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const videoingestQueue = new Queue('videoingest', {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 100,
    },
  },
});
const marketingQueue = new Queue(env.MARKETING_QUEUE_NAME, {
  connection: redisClient,
  streams: {
    events: {
      maxLen: 1000,
    },
  },
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
    new BullMQAdapter(qwenImageQueue),
    new BullMQAdapter(zImageTurboQueue),
    new BullMQAdapter(videoingestQueue),
    new BullMQAdapter(marketingQueue),
  ],
  serverAdapter: serverAdapter,
});

const app = express();

app.use(express.json());

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
