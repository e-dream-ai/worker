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
  handleQwenImageJob,
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
  ],
  serverAdapter: serverAdapter,
});

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});
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
      console.error('[POST /api/upload-image]', {
        error: 'No image file provided',
        hasFile: !!req.file,
      });
      res.status(400).json({ error: 'No image file provided' });
      return;
    }

    const tempJobId = `upload-${Date.now()}`;
    const filename = req.file.originalname || `image-${Date.now()}.png`;

    const imageBuffer = req.file.buffer;
    const presignedUrl = await r2UploadService.uploadImageBufferToR2(imageBuffer, tempJobId, filename);

    res.json({ url: presignedUrl });
  } catch (error: any) {
    console.error('[POST /api/upload-image]', {
      error: error.message || 'Unknown error',
      stack: error.stack,
      filename: req.file?.originalname,
      fileSize: req.file?.size,
    });
    res.status(500).json({ error: error.message || 'Failed to upload image' });
  }
});

app.listen(env.PORT, () => {
  console.log(`Running on port ${env.PORT} in ${env.NODE_ENV} mode...`);
  console.log(`Admin UI: http://localhost:${env.PORT}/admin/queues`);
});
