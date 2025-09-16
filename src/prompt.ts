import { Job, Queue, QueueEvents } from 'bullmq';
import redisClient from './shared/redis.js';
import { InvalidArgumentError, program } from 'commander';
import fs from 'fs';

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

async function runVideo(frames: string[], options) {
  // console.log(`frames: ${JSON.stringify(frames)}`)
  const scheduleKeys = ['0', '100', '200', '300', '400', '500', '608'] as const;
  const promptSchedule: Record<string, string> = {};
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
    },
  };
  console.log(`running: ${JSON.stringify(job)}`);
  return deforumQueue.addBulk([job]);
}

// listen for job events and results. Note that it's best to deal with results directly in the worker
const queueEvents = new QueueEvents('video');
queueEvents.on('completed', async (data) => {
  const job = await Job.fromId(hunyuanQueue, data.jobId);
  console.log(
    `\n${new Date().toISOString()}: Job finished: ${JSON.stringify(job?.returnvalue)} for job ${JSON.stringify(job)}`
  );
});
let lastprogress = '';
queueEvents.on('progress', (data) => {
  const progress = JSON.stringify(data);
  if (lastprogress != progress) {
    console.log(`\n${new Date().toISOString()}: Job progress: ${progress}`);
    lastprogress = progress;
  } else {
    process.stdout.write('.');
  }
});
queueEvents.on('failed', async (data) => {
  const job = await Job.fromId(hunyuanQueue, data.jobId);
  console.log(`\n${new Date().toISOString()}: Job failed:   ${job.failedReason} for job ${JSON.stringify(job)}`);
});

program.name('prompt').description('CLI to queue runpod jobs');

function myParseInt(value) {
  // parseInt takes a string and a radix
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new InvalidArgumentError('Not a number.');
  }
  return parsedValue;
}

program
  .command('deforum')
  .description('queue a runpod job')
  .argument('<string...>', 'prompt for deforum as JSON or @file.json')
  .option('-w, --width <number>', 'width', myParseInt, 1024)
  .option('-h, --height <number>', 'height', myParseInt, 768)
  .option(
    '-c, --frame_count <number>',
    'number of frames to compute, must be a multiple of four (after subtracting one',
    myParseInt,
    609
  )
  .option('-f, --frame_rate <number>', 'frame rate for video', myParseInt, 16)
  .action((str, options) => {
    let raw = str.join(' ');
    const trimmed = raw.trim();
    if (trimmed.startsWith('@')) {
      const file = trimmed.slice(1);
      if (!fs.existsSync(file)) {
        throw new InvalidArgumentError(`File not found: ${file}`);
      }
      raw = fs.readFileSync(file, 'utf8');
    }
    runDeforum(JSON.parse(raw), options);
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
  .action((str, options) => {
    runHunyuan(str.join(' ').split(), options);
  });

program
  .command('animatediff')
  .description('queue a runpod job')
  .argument('<string...>', 'prompt for animatediff; comma list, JSON, or @file.json')
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
  .action((str, options) => {
    let raw = str.join(' ');
    const trimmed = raw.trim();
    if (trimmed.startsWith('@')) {
      const file = trimmed.slice(1);
      if (!fs.existsSync(file)) {
        throw new InvalidArgumentError(`File not found: ${file}`);
      }
      raw = fs.readFileSync(file, 'utf8');
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
          const orderedKeys = Object.keys(pm).sort((a, b) => Number(a) - Number(b));
          frames = orderedKeys.map((k) => String(pm[k]));
        } else {
          // Fallback: treat numeric keys as schedule on the root
          const numericKeys = Object.keys(obj).filter((k) => /^\d+$/.test(k));
          if (numericKeys.length > 0) {
            const orderedKeys = numericKeys.sort((a, b) => Number(a) - Number(b));
            frames = orderedKeys.map((k) => String(obj[k] as unknown));
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
    if (frames.length === 0) {
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

    runVideo(frames, effectiveOptions);
  });

program.parse();
