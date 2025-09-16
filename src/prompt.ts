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
  const job = {
    name: 'message',
    data: {
      prompt: {
        '0': frames[0]?.trim() || 'cubist painting of the ayahuasca experience',
        '100': frames[1]?.trim() || 'layered pointillist mitochondria from dreamtime',
        '200': frames[2]?.trim() || 'rave detailed Abstract  spiritual  Paintings',
        '300': frames[3]?.trim() || 'abstract art based on Kabbalah astrological chart',
        '400': frames[4]?.trim() || 'intricate futuristic iridescent multicolored japanese radiolaria',
        '500': frames[5]?.trim() || 'DMT painting android bio nano techno',
        '608': frames[6]?.trim() || frames[0]?.trim() || 'cubist painting of the ayahuasca experience',
      },
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
  .argument('<string...>', 'prompt for deforum as JSON')
  .option('-w, --width <number>', 'width', myParseInt, 1024)
  .option('-h, --height <number>', 'height', myParseInt, 768)
  .option(
    '-c, --frame_count <number>',
    'number of frames to compute, must be a multiple of four (after subtracting one',
    myParseInt,
    129
  )
  .option('-f, --frame_rate <number>', 'frame rate for video', myParseInt, 16)
  .action((str, options) => {
    runDeforum(JSON.parse(str.join(' ')), options);
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
  .argument('<string...>', 'prompt for animatediff')
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
  .action((str, options) => {
    runVideo(str.join(' ').split(), options);
  });

program.parse();
