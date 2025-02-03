import { Job, Worker } from 'bullmq';
import 'dotenv/config';
import { Redis } from 'ioredis';
import runpodSdk from 'runpod-sdk';

const DEBUG = false;

const { RUNPOD_API_KEY, ENDPOINT_ID } = process.env;
const runpod = runpodSdk(RUNPOD_API_KEY || '');
const endpoint = runpod.endpoint(ENDPOINT_ID || '');

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

const serializeError = (error: Error) => {
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
};

function createWorker(name: string, handler) {
  const worker = new Worker(
    name,
    async (job) => {
      return await handler(job);
    },
    {
      connection: redisClient,
    }
  );

  worker.on('failed', (job, error: Error) => {
    console.error(`Worker failed: ${name} error: ${serializeError(error)}, job data: ${JSON.stringify(job?.toJSON())}`);
  });

  worker.on('completed', (job, returnvalue) => {
    if (DEBUG)
      console.debug(
        `Job completed: {name}, returning: ${JSON.stringify(returnvalue)}, job data: ${JSON.stringify(job.toJSON())}`
      );
  });

  worker.on('error', (error: Error) => {
    console.error(`Job error:     ${name} error:${serializeError(error)}`);
  });
}

async function runpodJob(job: Job) {
  if (endpoint) {
    if (DEBUG) console.log(`Starting runpod worker: ${JSON.stringify(job.data)}`);
    const { id } = await endpoint.run({
      input: {
        workflow: {
          '3': {
            inputs: {
              seed: 1337,
              steps: 20,
              cfg: 8,
              sampler_name: 'euler',
              scheduler: 'normal',
              denoise: 1,
              model: ['4', 0],
              positive: ['6', 0],
              negative: ['7', 0],
              latent_image: ['5', 0],
            },
            class_type: 'KSampler',
          },
          '4': {
            inputs: {
              ckpt_name: 'sd_xl_base_1.0.safetensors',
            },
            class_type: 'CheckpointLoaderSimple',
          },
          '5': {
            inputs: {
              width: 512,
              height: 512,
              batch_size: 1,
            },
            class_type: 'EmptyLatentImage',
          },
          '6': {
            inputs: {
              text: job.data.prompt,
              clip: ['4', 1],
            },
            class_type: 'CLIPTextEncode',
          },
          '7': {
            inputs: {
              text: 'text, watermark',
              clip: ['4', 1],
            },
            class_type: 'CLIPTextEncode',
          },
          '8': {
            inputs: {
              samples: ['3', 0],
              vae: ['4', 2],
            },
            class_type: 'VAEDecode',
          },
          '9': {
            inputs: {
              filename_prefix: 'ComfyUI',
              images: ['8', 0],
            },
            class_type: 'SaveImage',
          },
        },
      },
    });

    let status;
    do {
      status = await endpoint.status(id);
      if (DEBUG) console.log(`Got status: ${JSON.stringify(status)}`);
      await job.updateProgress(status);
    } while (status.status !== 'COMPLETED');

    // return S3 url to result
    return JSON.parse(JSON.stringify(status)).output.message;
  }
}

// run the above function when 'image' job is created (prompt.ts)
createWorker('image', runpodJob);
