import { Job, Queue, QueueEvents } from 'bullmq';
import redisClient from './shared/redis.js';
import { InvalidArgumentError, program } from 'commander';
import fs from 'fs';
import path from 'path';

function imageFileToBase64(path: string) {
  const img = fs.readFileSync(path);
  return Buffer.from(img).toString('base64');
}

const videoQueue = new Queue('video', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

async function runVideo(framesOrSchedule: string[] | Record<string, string>, options) {
  const promptSchedule: Record<string, string> = {};

  if (Array.isArray(framesOrSchedule)) {
    const frames = framesOrSchedule;
    const scheduleKeys = ['0', '100', '200', '300', '400', '500', '608'] as const;
    for (let i = 0; i < 6; i++) {
      const value = frames[i]?.trim();
      if (value) {
        promptSchedule[scheduleKeys[i]] = value;
      }
    }
    const lastValue = frames[6]?.trim() || frames[0]?.trim();
    if (lastValue) {
      promptSchedule['608'] = lastValue;
    }
  } else {
    for (const [key, value] of Object.entries(framesOrSchedule)) {
      const v = String(value).trim();
      if (v) {
        promptSchedule[key] = v;
      }
    }
  }

  const job = {
    name: 'message',
    data: {
      prompt: promptSchedule,
      pre_text: options.pre_text,
      app_text: options.app_text,
      frame_count: options.frame_count, // should be a multiple of the context window of 16
      frame_rate: options.frame_rate,
      seed: options.seed,
      steps: options.steps,
      width: options.width,
      height: options.height,
      motion_scale: 1,
      output_name: options.output_name,
    },
  };

  console.log(`running: ${JSON.stringify(job)}`);
  return videoQueue.addBulk([job]);
}

const hunyuanQueue = new Queue('hunyuanvideo', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

async function runHunyuan(frames: string[], options) {
  let images;
  if (options.image) {
    images = [
      {
        name: options.image,
        file: imageFileToBase64(options.image),
      },
    ];
  }
  // console.log(`frames: ${JSON.stringify(frames)}`)
  const job = {
    name: 'message',
    data: {
      prompt: frames.join(),
      images: images,
      frame_count: options.frame_count, // should be a multiple of the context window of 16
      frame_rate: options.frame_rate,
      seed: options.seed,
      steps: options.steps,
      width: options.width,
      height: options.height,
    },
  };

  console.log(`running: ${JSON.stringify(job)}`);
  return hunyuanQueue.addBulk([job]);
}

const deforumQueue = new Queue('deforumvideo', {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});
async function runDeforum(prompt, options) {
  let images;
  if (options.image) {
    images = [
      {
        name: options.image,
        file: imageFileToBase64(options.image),
      },
    ];
  }
  // console.log(`frames: ${JSON.stringify(frames)}`)
  const job = {
    name: 'message',
    data: {
      prompt,
      images: images,
      frame_count: options.frame_count, // should be a multiple of the context window of 16
      frame_rate: options.frame_rate,
      steps: options.steps,
      width: options.width,
      height: options.height,
      output_name: options.output_name,
    },
  };
  console.log(`running: ${JSON.stringify(job)}`);
  return deforumQueue.addBulk([job]);
}

// listen for job events and results. Note that it's best to deal with results directly in the worker
const videoQueueEvents = new QueueEvents('video');
const hunyuanQueueEvents = new QueueEvents('hunyuanvideo');
const deforumQueueEvents = new QueueEvents('deforumvideo');

// Map queue names to their corresponding Queue instances
const queueMap = {
  video: videoQueue,
  hunyuanvideo: hunyuanQueue,
  deforumvideo: deforumQueue,
} as const;

async function handleJobCompleted(data: { jobId: string }, queueName: keyof typeof queueMap): Promise<void> {
  try {
    const queue = queueMap[queueName];
    const job = await Job.fromId(queue, data.jobId);
    console.log(
      `\n${new Date().toISOString()}: Job finished: ${JSON.stringify(job?.returnvalue)} for job ${JSON.stringify(job?.id)}`
    );
    if (queuedJobIds.has(data.jobId)) {
      const rv: any = job?.returnvalue;
      if (rv?.local_path) {
        console.log(`Downloaded file saved at: ${rv.local_path}`);
        process.exit(0);
      }
    }
  } catch (error) {
    console.error(
      `\n${new Date().toISOString()}: Error retrieving completed job ${data.jobId} from ${queueName}:`,
      error
    );
  }
}

async function handleJobFailed(data: { jobId: string }, queueName: keyof typeof queueMap): Promise<void> {
  try {
    const queue = queueMap[queueName];
    const job = await Job.fromId(queue, data.jobId);
    console.log(`\n${new Date().toISOString()}: Job failed: ${job?.failedReason} for job ${JSON.stringify(job?.id)}`);
  } catch (error) {
    console.error(`\n${new Date().toISOString()}: Error retrieving failed job ${data.jobId} from ${queueName}:`, error);
  }
}

function handleJobProgress(data: any): void {
  const progress = JSON.stringify(data);
  if (lastprogress !== progress) {
    console.log(`\n${new Date().toISOString()}: Job progress: ${progress}`);
    lastprogress = progress;
  } else {
    process.stdout.write('.');
  }
}

let lastprogress = '';

// Set up event listeners for all queues
videoQueueEvents.on('completed', (data) => handleJobCompleted(data, 'video'));
videoQueueEvents.on('progress', handleJobProgress);
videoQueueEvents.on('failed', (data) => handleJobFailed(data, 'video'));

hunyuanQueueEvents.on('completed', (data) => handleJobCompleted(data, 'hunyuanvideo'));
hunyuanQueueEvents.on('progress', handleJobProgress);
hunyuanQueueEvents.on('failed', (data) => handleJobFailed(data, 'hunyuanvideo'));

deforumQueueEvents.on('completed', (data) => handleJobCompleted(data, 'deforumvideo'));
deforumQueueEvents.on('progress', handleJobProgress);
deforumQueueEvents.on('failed', (data) => handleJobFailed(data, 'deforumvideo'));

program.name('prompt').description('CLI to queue runpod jobs');

function myParseInt(value) {
  // parseInt takes a string and a radix
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError('Not a number.');
  }
  return parsedValue;
}

const queuedJobIds: Set<string> = new Set();

program
  .command('deforum')
  .description('queue a runpod job')
  .argument('<string...>', 'prompt for deforum; JSON string, file.json path, or comma list')
  .option('-w, --width <number>', 'width', myParseInt, 1024)
  .option('-h, --height <number>', 'height', myParseInt, 768)
  .option(
    '-c, --frame_count <number>',
    'number of frames to compute, must be a multiple of four (after subtracting one',
    myParseInt,
    609
  )
  .option('-f, --frame_rate <number>', 'frame rate for video', myParseInt, 16)
  .action(async (str, options) => {
    let raw = str.join(' ');
    const trimmed = raw.trim();
    let outputNameFromFile: string | undefined;
    if (trimmed.endsWith('.json') && fs.existsSync(trimmed)) {
      const file = trimmed;
      if (!fs.existsSync(file)) {
        throw new InvalidArgumentError(`File not found: ${file}`);
      }
      raw = fs.readFileSync(file, 'utf8');
      const base = path.basename(file, path.extname(file));
      outputNameFromFile = `${base}.mp4`;
    }
    const jobs = await runDeforum(JSON.parse(raw), {
      ...options,
      output_name: outputNameFromFile ?? options.output_name,
    });
    for (const job of jobs) {
      if (job?.id) queuedJobIds.add(String(job.id));
    }
  });

program
  .command('hunyuan')
  .description('queue a runpod job')
  .argument('<string...>', 'prompt for hunyuan')
  .option('-w, --width <number>', 'width', myParseInt, 1280)
  .option('-h, --height <number>', 'height', myParseInt, 720)
  .option(
    '-c, --frame_count <number>',
    'number of frames to compute, must be a multiple of four (after subtracting one',
    myParseInt,
    129
  )
  .option('-f, --frame_rate <number>', 'frame rate for video', myParseInt, 16)
  .option('-s, --seed <number>', 'seed', myParseInt, 6)
  .option(
    '-t, --steps <number>',
    'number of steps to generate a frame: more is slower but higher quality',
    myParseInt,
    30
  )
  .option('-i, --image <string>', 'path to an image file')
  .action(async (str, options) => {
    const jobs = await runHunyuan(str.join(' ').split(), options);
    for (const job of jobs) {
      if (job?.id) queuedJobIds.add(String(job.id));
    }
  });

program
  .command('animatediff')
  .description('queue a runpod job')
  .argument('<string...>', 'prompt for animatediff; comma list, JSON string, or file.json path')
  .option(
    '-p, --pre_text <string>',
    'Text that is prepended at the beginning of each prompt in the schedule, allowing for a consistent base across all scheduled prompts',
    'highly detailed, 4k, masterpiece'
  )
  .option(
    '-a, --app_text <string>',
    'Text that is appended at the end of each prompt in the schedule, enabling a uniform conclusion to each prompt or adding consistent elements across prompts',
    '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot'
  )
  .option('-w, --width <number>', 'width', myParseInt, 1024)
  .option('-h, --height <number>', 'height', myParseInt, 768)
  .option(
    '-c, --frame_count <number>',
    'number of frames to compute, must be a multiple of four (after subtracting one',
    myParseInt,
    609
  )
  .option('-f, --frame_rate <number>', 'frame rate for video', myParseInt, 16)
  .option('-s, --seed <number>', 'seed', myParseInt, 6)
  .option(
    '-t, --steps <number>',
    'number of steps to generate a frame: more is slower but higher quality',
    myParseInt,
    30
  )
  .action(async (str, options) => {
    let raw = str.join(' ');
    const trimmed = raw.trim();
    let outputNameFromFile: string | undefined;
    if (trimmed.endsWith('.json') && fs.existsSync(trimmed)) {
      const file = trimmed;
      if (!fs.existsSync(file)) {
        throw new InvalidArgumentError(`File not found: ${file}`);
      }
      raw = fs.readFileSync(file, 'utf8');
      const base = path.basename(file, path.extname(file));
      outputNameFromFile = `${base}.mp4`;
    }
    const defaultAnimatediffOptions = {
      pre_text: 'highly detailed, 4k, masterpiece',
      app_text: '(Masterpiece, best quality:1.2)  walking towards camera, full body closeup shot',
      width: 1024,
      height: 768,
      frame_count: 609,
      frame_rate: 16,
      seed: 6,
      steps: 30,
    } as const;

    const recognizedOptionKeys = [
      'pre_text',
      'app_text',
      'width',
      'height',
      'frame_count',
      'frame_rate',
      'seed',
      'steps',
      'image',
    ] as const;

    let frames: string[] = [];
    let schedule: Record<string, string> | null = null;
    const jsonOptions: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        frames = parsed.map((x) => String(x));
      } else if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        // Extract frames/schedule
        if (Array.isArray(obj.frames)) {
          frames = (obj.frames as unknown[]).map((x) => String(x));
        } else if (Array.isArray(obj.prompts)) {
          frames = (obj.prompts as unknown[]).map((x) => String(x));
        } else if (typeof obj.prompts === 'object' && obj.prompts !== null) {
          const pm = obj.prompts as Record<string, unknown>;
          schedule = {};
          for (const [k, v] of Object.entries(pm)) {
            if (/^\d+$/.test(k)) {
              schedule[k] = String(v);
            }
          }
        } else {
          // Fallback: treat numeric keys as schedule on the root
          const numericKeys = Object.keys(obj).filter((k) => /^\d+$/.test(k));
          if (numericKeys.length > 0) {
            schedule = {};
            for (const k of numericKeys) {
              schedule[k] = String(obj[k] as unknown);
            }
          }
        }
        // Extract options
        for (const key of recognizedOptionKeys) {
          if (obj[key] !== undefined) {
            jsonOptions[key] = obj[key] as unknown;
          }
        }
      }
    } catch {
      // Non-JSON input: comma-separated or space separated prompts
    }
    if (!schedule && frames.length === 0) {
      frames = raw.split(',');
    }

    const effectiveOptions: any = { ...options };
    for (const key of Object.keys(defaultAnimatediffOptions) as Array<keyof typeof defaultAnimatediffOptions>) {
      const cliValue = options[key as keyof typeof options];
      const defaultValue = defaultAnimatediffOptions[key];
      const jsonValue = jsonOptions[key as string];
      if (jsonValue !== undefined) {
        if (cliValue === defaultValue) {
          effectiveOptions[key] = jsonValue;
        }
      }
    }
    if (jsonOptions.image !== undefined && (options as any).image === undefined) {
      effectiveOptions.image = jsonOptions.image;
    }

    if (outputNameFromFile && (effectiveOptions as any)) {
      (effectiveOptions as any).output_name = outputNameFromFile;
    }
    const jobs = await runVideo(schedule ?? frames, effectiveOptions);
    for (const job of jobs) {
      if (job?.id) queuedJobIds.add(String(job.id));
    }
  });

program.parse();
