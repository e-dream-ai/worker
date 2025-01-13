import { Job, Worker } from 'bullmq';
import 'dotenv/config';
import { Redis } from 'ioredis';
import runpodSdk, { EndpointOutput } from "runpod-sdk";

const { RUNPOD_API_KEY, ENDPOINT_ID } = process.env;
const runpod = runpodSdk(RUNPOD_API_KEY || '');
const endpoint = runpod.endpoint(ENDPOINT_ID || '');

const redisClient = new Redis({
  maxRetriesPerRequest: null,
});

// handle queued messages
new Worker(
  'runpod',
  async (job: Job) => {
    if (endpoint) {
      console.log(`Starting job: ${JSON.stringify(job.data)}`);
      const {id} = await endpoint.run({
          "input":
          {
              "workflow":
              {
                  "3":
                  {
                      "inputs":
                      {
                          "seed": 1337,
                          "steps": 20,
                          "cfg": 8,
                          "sampler_name": "euler",
                          "scheduler": "normal",
                          "denoise": 1,
                          "model":
                          [
                              "4",
                              0
                          ],
                          "positive":
                          [
                              "6",
                              0
                          ],
                          "negative":
                          [
                              "7",
                              0
                          ],
                          "latent_image":
                          [
                              "5",
                              0
                          ]
                      },
                      "class_type": "KSampler"
                  },
                  "4":
                  {
                      "inputs":
                      {
                          "ckpt_name": "sd_xl_base_1.0.safetensors"
                      },
                      "class_type": "CheckpointLoaderSimple"
                  },
                  "5":
                  {
                      "inputs":
                      {
                          "width": 512,
                          "height": 512,
                          "batch_size": 1
                      },
                      "class_type": "EmptyLatentImage"
                  },
                  "6":
                  {
                      "inputs":
                      {
                          "text": job.data.prompt,
                          "clip":
                          [
                              "4",
                              1
                          ]
                      },
                      "class_type": "CLIPTextEncode"
                  },
                  "7":
                  {
                      "inputs":
                      {
                          "text": "text, watermark",
                          "clip":
                          [
                              "4",
                              1
                          ]
                      },
                      "class_type": "CLIPTextEncode"
                  },
                  "8":
                  {
                      "inputs":
                      {
                          "samples":
                          [
                              "3",
                              0
                          ],
                          "vae":
                          [
                              "4",
                              2
                          ]
                      },
                      "class_type": "VAEDecode"
                  },
                  "9":
                  {
                      "inputs":
                      {
                          "filename_prefix": "ComfyUI",
                          "images":
                          [
                              "8",
                              0
                          ]
                      },
                      "class_type": "SaveImage"
                  }
              }
          }
      });


      let status;
      do {
        status = await endpoint.status(id);
        console.log(`Got status: ${JSON.stringify(status)}`);
      } while(status.status !== 'COMPLETED')

      return status;
    }
  },
  { connection: redisClient }
);
