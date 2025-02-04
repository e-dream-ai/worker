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

async function videoJob(job: Job) {
  if (endpoint) {
    if (DEBUG) console.log(`Starting runpod worker: ${JSON.stringify(job.data)}`);
    const { id } = await endpoint.run({
      input: {
        workflow: {
          last_node_id: 107,
          last_link_id: 241,
          nodes: [
            {
              id: 93,
              type: 'ADE_AnimateDiffLoaderWithContext',
              pos: [719.2264930049622, -552.7688248517424],
              size: {
                '0': 315,
                '1': 230,
              },
              flags: {},
              order: 7,
              mode: 0,
              inputs: [
                {
                  name: 'model',
                  type: 'MODEL',
                  link: 236,
                  slot_index: 0,
                },
                {
                  name: 'context_options',
                  type: 'CONTEXT_OPTIONS',
                  link: 206,
                  slot_index: 1,
                },
                {
                  name: 'motion_lora',
                  type: 'MOTION_LORA',
                  link: null,
                },
                {
                  name: 'ad_settings',
                  type: 'AD_SETTINGS',
                  link: null,
                },
                {
                  name: 'sample_settings',
                  type: 'SAMPLE_SETTINGS',
                  link: null,
                },
                {
                  name: 'ad_keyframes',
                  type: 'AD_KEYFRAMES',
                  link: null,
                },
              ],
              outputs: [
                {
                  name: 'MODEL',
                  type: 'MODEL',
                  links: [205, 237],
                  shape: 3,
                },
              ],
              properties: {
                'Node name for S&R': 'ADE_AnimateDiffLoaderWithContext',
              },
              widgets_values: ['sd1/mm_sd_v15_v2.ckpt', 'sqrt_linear (AnimateDiff)', 1, true],
            },
            {
              id: 94,
              type: 'ADE_AnimateDiffUniformContextOptions',
              pos: [340.22649300496244, -559.7688248517424],
              size: {
                '0': 315,
                '1': 270,
              },
              flags: {},
              order: 0,
              mode: 0,
              inputs: [
                {
                  name: 'prev_context',
                  type: 'CONTEXT_OPTIONS',
                  link: null,
                },
                {
                  name: 'view_opts',
                  type: 'VIEW_OPTS',
                  link: null,
                },
              ],
              outputs: [
                {
                  name: 'CONTEXT_OPTIONS',
                  type: 'CONTEXT_OPTIONS',
                  links: [206],
                  shape: 3,
                },
              ],
              properties: {
                'Node name for S&R': 'ADE_AnimateDiffUniformContextOptions',
              },
              widgets_values: [16, 1, 4, 'uniform', false, 'flat', false, 0, 1],
            },
            {
              id: 101,
              type: 'ADE_EmptyLatentImageLarge',
              pos: [745.4403662632927, -22.267850512420175],
              size: {
                '0': 315,
                '1': 106,
              },
              flags: {},
              order: 10,
              mode: 0,
              inputs: [
                {
                  name: 'width',
                  type: 'INT',
                  link: 218,
                  widget: {
                    name: 'width',
                  },
                  slot_index: 0,
                },
                {
                  name: 'height',
                  type: 'INT',
                  link: 219,
                  widget: {
                    name: 'height',
                  },
                  slot_index: 1,
                },
                {
                  name: 'batch_size',
                  type: 'INT',
                  link: 220,
                  widget: {
                    name: 'batch_size',
                  },
                  slot_index: 2,
                },
              ],
              outputs: [
                {
                  name: 'LATENT',
                  type: 'LATENT',
                  links: [221],
                  shape: 3,
                  slot_index: 0,
                },
              ],
              properties: {
                'Node name for S&R': 'ADE_EmptyLatentImageLarge',
              },
              widgets_values: [960, 544, 300],
            },
            {
              id: 5,
              type: 'PrimitiveNode',
              pos: [767, 391],
              size: {
                '0': 210,
                '1': 82,
              },
              flags: {},
              order: 1,
              mode: 0,
              outputs: [
                {
                  name: 'INT',
                  type: 'INT',
                  links: [6, 223],
                  slot_index: 0,
                  widget: {
                    name: 'seed',
                  },
                },
              ],
              title: 'Seed',
              properties: {
                'Run widget replace on values': false,
              },
              widgets_values: [832386334143550, 'randomize'],
              color: '#2a363b',
              bgcolor: '#3f5159',
            },
            {
              id: 7,
              type: 'KSampler',
              pos: [1238, -446],
              size: {
                '0': 356.7564392089844,
                '1': 264.7169189453125,
              },
              flags: {
                pinned: false,
              },
              order: 11,
              mode: 0,
              inputs: [
                {
                  name: 'model',
                  type: 'MODEL',
                  link: 205,
                },
                {
                  name: 'positive',
                  type: 'CONDITIONING',
                  link: 217,
                },
                {
                  name: 'negative',
                  type: 'CONDITIONING',
                  link: 215,
                },
                {
                  name: 'latent_image',
                  type: 'LATENT',
                  link: 221,
                },
                {
                  name: 'seed',
                  type: 'INT',
                  link: 6,
                  widget: {
                    name: 'seed',
                  },
                },
              ],
              outputs: [
                {
                  name: 'LATENT',
                  type: 'LATENT',
                  links: [9, 239],
                  shape: 3,
                  slot_index: 0,
                },
              ],
              properties: {
                'Node name for S&R': 'KSampler',
              },
              widgets_values: [832386334143550, 'fixed', 30, 5, 'dpmpp_2m_sde', 'karras', 1],
              color: '#223',
              bgcolor: '#335',
            },
            {
              id: 2,
              type: 'VAELoader',
              pos: [1240, -88],
              size: {
                '0': 345.6938171386719,
                '1': 66.55177307128906,
              },
              flags: {},
              order: 2,
              mode: 0,
              outputs: [
                {
                  name: 'VAE',
                  type: 'VAE',
                  links: [10, 228],
                  shape: 3,
                  slot_index: 0,
                },
              ],
              properties: {
                'Node name for S&R': 'VAELoader',
              },
              widgets_values: ['sd1/vae-ft-mse-840000-ema-pruned.safetensors'],
              color: '#332922',
              bgcolor: '#593930',
            },
            {
              id: 103,
              type: 'KSampler',
              pos: [1770, 130],
              size: {
                '0': 315,
                '1': 262,
              },
              flags: {},
              order: 16,
              mode: 0,
              inputs: [
                {
                  name: 'model',
                  type: 'MODEL',
                  link: 237,
                  slot_index: 0,
                },
                {
                  name: 'positive',
                  type: 'CONDITIONING',
                  link: 225,
                  slot_index: 1,
                },
                {
                  name: 'negative',
                  type: 'CONDITIONING',
                  link: 224,
                  slot_index: 2,
                },
                {
                  name: 'latent_image',
                  type: 'LATENT',
                  link: 238,
                  slot_index: 3,
                },
                {
                  name: 'seed',
                  type: 'INT',
                  link: 223,
                  widget: {
                    name: 'seed',
                  },
                  slot_index: 4,
                },
              ],
              outputs: [
                {
                  name: 'LATENT',
                  type: 'LATENT',
                  links: [227],
                  shape: 3,
                },
              ],
              title: 'KSampler (upscale)',
              properties: {
                'Node name for S&R': 'KSampler',
              },
              widgets_values: [832386334143550, 'randomize', 30, 5, 'dpmpp_2m_sde', 'karras', 0.65],
              color: '#223',
              bgcolor: '#335',
            },
            {
              id: 102,
              type: 'LatentUpscaleBy',
              pos: [1762, -25],
              size: {
                '0': 315,
                '1': 82,
              },
              flags: {},
              order: 13,
              mode: 0,
              inputs: [
                {
                  name: 'samples',
                  type: 'LATENT',
                  link: 239,
                },
              ],
              outputs: [
                {
                  name: 'LATENT',
                  type: 'LATENT',
                  links: [238],
                  shape: 3,
                },
              ],
              properties: {
                'Node name for S&R': 'LatentUpscaleBy',
              },
              widgets_values: ['nearest-exact', 2],
            },
            {
              id: 6,
              type: 'CLIPTextEncode',
              pos: [-135, 772],
              size: {
                '0': 442.5990905761719,
                '1': 175.22203063964844,
              },
              flags: {},
              order: 8,
              mode: 0,
              inputs: [
                {
                  name: 'clip',
                  type: 'CLIP',
                  link: 202,
                },
              ],
              outputs: [
                {
                  name: 'CONDITIONING',
                  type: 'CONDITIONING',
                  links: [215, 224],
                  shape: 3,
                  slot_index: 0,
                },
              ],
              properties: {
                'Node name for S&R': 'CLIPTextEncode',
              },
              widgets_values: ['(bad quality, worst quality:1.2), NSFW, nude'],
              color: '#322',
              bgcolor: '#533',
            },
            {
              id: 10,
              type: 'VAEDecode',
              pos: [1740, -400],
              size: {
                '0': 210,
                '1': 46,
              },
              flags: {},
              order: 12,
              mode: 0,
              inputs: [
                {
                  name: 'samples',
                  type: 'LATENT',
                  link: 9,
                },
                {
                  name: 'vae',
                  type: 'VAE',
                  link: 10,
                },
              ],
              outputs: [
                {
                  name: 'IMAGE',
                  type: 'IMAGE',
                  links: [130, 240],
                  shape: 3,
                  slot_index: 0,
                },
              ],
              properties: {
                'Node name for S&R': 'VAEDecode',
              },
            },
            {
              id: 104,
              type: 'VAEDecode',
              pos: [2195, 137],
              size: {
                '0': 210,
                '1': 46,
              },
              flags: {},
              order: 17,
              mode: 0,
              inputs: [
                {
                  name: 'samples',
                  type: 'LATENT',
                  link: 227,
                  slot_index: 0,
                },
                {
                  name: 'vae',
                  type: 'VAE',
                  link: 228,
                  slot_index: 1,
                },
              ],
              outputs: [
                {
                  name: 'IMAGE',
                  type: 'IMAGE',
                  links: [241],
                  shape: 3,
                  slot_index: 0,
                },
              ],
              properties: {
                'Node name for S&R': 'VAEDecode',
              },
            },
            {
              id: 106,
              type: 'VHS_VideoCombine',
              pos: [2575, -483],
              size: [562.9959716796875, 290],
              flags: {},
              order: 15,
              mode: 0,
              inputs: [
                {
                  name: 'images',
                  type: 'IMAGE',
                  link: 240,
                },
                {
                  name: 'audio',
                  type: 'VHS_AUDIO',
                  link: null,
                },
                {
                  name: 'batch_manager',
                  type: 'VHS_BatchManager',
                  link: null,
                },
              ],
              outputs: [
                {
                  name: 'Filenames',
                  type: 'VHS_FILENAMES',
                  links: null,
                  shape: 3,
                },
              ],
              properties: {
                'Node name for S&R': 'VHS_VideoCombine',
              },
              widgets_values: {
                frame_rate: 8,
                loop_count: 0,
                filename_prefix: '1047',
                format: 'video/h264-mp4',
                pix_fmt: 'yuv420p',
                crf: 19,
                save_metadata: true,
                pingpong: false,
                save_output: true,
                videopreview: {
                  hidden: false,
                  paused: false,
                  params: {
                    filename: '1047_01151.mp4',
                    subfolder: '',
                    type: 'output',
                    format: 'video/h264-mp4',
                  },
                },
              },
            },
            {
              id: 12,
              type: 'SaveImage',
              pos: [2138, -484],
              size: {
                '0': 315,
                '1': 270,
              },
              flags: {},
              order: 14,
              mode: 0,
              inputs: [
                {
                  name: 'images',
                  type: 'IMAGE',
                  link: 130,
                },
              ],
              properties: {},
              widgets_values: ['1047'],
            },
            {
              id: 98,
              type: 'PrimitiveNode',
              pos: [441, -110],
              size: {
                '0': 210,
                '1': 82,
              },
              flags: {},
              order: 3,
              mode: 0,
              outputs: [
                {
                  name: 'INT',
                  type: 'INT',
                  links: [218],
                  slot_index: 0,
                  widget: {
                    name: 'width',
                  },
                },
              ],
              title: 'Width',
              properties: {
                'Run widget replace on values': false,
              },
              widgets_values: [960, 'fixed'],
              color: '#332922',
              bgcolor: '#593930',
            },
            {
              id: 99,
              type: 'PrimitiveNode',
              pos: [441.44036626329256, 20.732149487579804],
              size: {
                '0': 210,
                '1': 82,
              },
              flags: {},
              order: 4,
              mode: 0,
              outputs: [
                {
                  name: 'INT',
                  type: 'INT',
                  links: [219],
                  slot_index: 0,
                  widget: {
                    name: 'height',
                  },
                },
              ],
              title: 'Height',
              properties: {
                'Run widget replace on values': false,
              },
              widgets_values: [544, 'fixed'],
              color: '#332922',
              bgcolor: '#593930',
            },
            {
              id: 107,
              type: 'VHS_VideoCombine',
              pos: [3188, -487],
              size: {
                '0': 514.6181030273438,
                '1': 290,
              },
              flags: {},
              order: 18,
              mode: 4,
              inputs: [
                {
                  name: 'images',
                  type: 'IMAGE',
                  link: 241,
                },
                {
                  name: 'audio',
                  type: 'VHS_AUDIO',
                  link: null,
                },
                {
                  name: 'batch_manager',
                  type: 'VHS_BatchManager',
                  link: null,
                },
              ],
              outputs: [
                {
                  name: 'Filenames',
                  type: 'VHS_FILENAMES',
                  links: null,
                  shape: 3,
                },
              ],
              properties: {
                'Node name for S&R': 'VHS_VideoCombine',
              },
              widgets_values: {
                frame_rate: 8,
                loop_count: 0,
                filename_prefix: '1047',
                format: 'video/h264-mp4',
                pix_fmt: 'yuv420p',
                crf: 19,
                save_metadata: true,
                pingpong: false,
                save_output: true,
                videopreview: {
                  hidden: false,
                  paused: false,
                  params: {},
                },
              },
            },
            {
              id: 1,
              type: 'CheckpointLoaderSimpleWithNoiseSelect',
              pos: [-182, -467],
              size: {
                '0': 319.20001220703125,
                '1': 170,
              },
              flags: {},
              order: 5,
              mode: 0,
              outputs: [
                {
                  name: 'MODEL',
                  type: 'MODEL',
                  links: [236],
                  shape: 3,
                  slot_index: 0,
                },
                {
                  name: 'CLIP',
                  type: 'CLIP',
                  links: [202, 222],
                  shape: 3,
                  slot_index: 1,
                },
                {
                  name: 'VAE',
                  type: 'VAE',
                  links: null,
                  shape: 3,
                  slot_index: 2,
                },
              ],
              properties: {
                'Node name for S&R': 'CheckpointLoaderSimpleWithNoiseSelect',
              },
              widgets_values: ['sd1/dreamshaper_8.safetensors', 'sqrt_linear (AnimateDiff)', false, 0.18215],
              color: '#432',
              bgcolor: '#653',
            },
            {
              id: 100,
              type: 'BatchPromptSchedule',
              pos: [-138, -115],
              size: {
                '0': 444.2601013183594,
                '1': 829.188720703125,
              },
              flags: {},
              order: 9,
              mode: 0,
              inputs: [
                {
                  name: 'clip',
                  type: 'CLIP',
                  link: 222,
                },
              ],
              outputs: [
                {
                  name: 'CONDITIONING',
                  type: 'CONDITIONING',
                  links: [217, 225],
                  shape: 3,
                  slot_index: 0,
                },
                {
                  name: 'NEG',
                  type: 'CONDITIONING',
                  links: null,
                  shape: 3,
                },
              ],
              properties: {
                'Node name for S&R': 'BatchPromptSchedule',
              },
              widgets_values: [
                '"0" :"cubist painting of the ayahuasca experience",\n\n"50" :"layered pointillist mitochondria from dreamtime",\n\n"100" :"rave detailed Abstract  spiritual  Paintings",\n\n"150" :"abstract art based on Kabbalah astrological chart",\n\n"200" :"intricate futuristic iridescent multicolored japanese radiolaria",\n\n"250" :"DMT painting android bio nano techno",\n\n"300" :"cubist painting of the ayahuasca experience"\n',
                300,
                '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot',
                'highly detailed, 4k, masterpiece',
                '0',
                0,
                0,
                0,
                0,
                0,
              ],
              color: '#232',
              bgcolor: '#353',
            },
            {
              id: 97,
              type: 'PrimitiveNode',
              pos: [435.44036626329256, 172.73214948757973],
              size: {
                '0': 210,
                '1': 82,
              },
              flags: {},
              order: 6,
              mode: 0,
              outputs: [
                {
                  name: 'INT',
                  type: 'INT',
                  links: [220],
                  slot_index: 0,
                  widget: {
                    name: 'batch_size',
                  },
                },
              ],
              title: 'Number of Frames',
              properties: {
                'Run widget replace on values': false,
              },
              widgets_values: [300, 'fixed'],
              color: '#332922',
              bgcolor: '#593930',
            },
          ],
          links: [
            [6, 5, 0, 7, 4, 'INT'],
            [9, 7, 0, 10, 0, 'LATENT'],
            [10, 2, 0, 10, 1, 'VAE'],
            [130, 10, 0, 12, 0, 'IMAGE'],
            [202, 1, 1, 6, 0, 'CLIP'],
            [205, 93, 0, 7, 0, 'MODEL'],
            [206, 94, 0, 93, 1, 'CONTEXT_OPTIONS'],
            [215, 6, 0, 7, 2, 'CONDITIONING'],
            [217, 100, 0, 7, 1, 'CONDITIONING'],
            [218, 98, 0, 101, 0, 'INT'],
            [219, 99, 0, 101, 1, 'INT'],
            [220, 97, 0, 101, 2, 'INT'],
            [221, 101, 0, 7, 3, 'LATENT'],
            [222, 1, 1, 100, 0, 'CLIP'],
            [223, 5, 0, 103, 4, 'INT'],
            [224, 6, 0, 103, 2, 'CONDITIONING'],
            [225, 100, 0, 103, 1, 'CONDITIONING'],
            [227, 103, 0, 104, 0, 'LATENT'],
            [228, 2, 0, 104, 1, 'VAE'],
            [236, 1, 0, 93, 0, 'MODEL'],
            [237, 93, 0, 103, 0, 'MODEL'],
            [238, 102, 0, 103, 3, 'LATENT'],
            [239, 7, 0, 102, 0, 'LATENT'],
            [240, 10, 0, 106, 0, 'IMAGE'],
            [241, 104, 0, 107, 0, 'IMAGE'],
          ],
          groups: [
            {
              title: 'Prompt Schedule',
              bounding: [-177, -219, 522, 1214],
              color: '#a1309b',
              font_size: 24,
            },
            {
              title: 'AnimateDiff',
              bounding: [308, -672, 772, 412],
              color: '#3f789e',
              font_size: 24,
            },
            {
              title: 'Latent Image',
              bounding: [412, -211, 667, 485],
              color: '#3f789e',
              font_size: 24,
            },
          ],
          config: {},
          extra: {},
          version: 0.4,
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
createWorker('video', videoJob);
