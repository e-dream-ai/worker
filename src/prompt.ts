import { Job, Queue, QueueEvents } from 'bullmq';
import redisClient from './shared/redis.js';
import { InvalidArgumentError, program } from 'commander';
import fs from 'fs';
import path from 'path';

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

async function runVideo(jsonData: any, options) {
  const job = {
    name: 'message',
    data: {
      ...jsonData,
      output_name: options.output_name,
      input_file_path: options.input_file_path,
      custom_output_path: options.custom_output_path,
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

async function runHunyuan(jsonData: any, options) {
  const job = {
    name: 'message',
    data: {
      ...jsonData,
      output_name: options.output_name,
      input_file_path: options.input_file_path,
      custom_output_path: options.custom_output_path,
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
async function runDeforum(jsonData: any, options) {
  const job = {
    name: 'message',
    data: {
      ...jsonData,
      output_name: options.output_name,
      input_file_path: options.input_file_path,
      custom_output_path: options.custom_output_path,
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

const queuedJobIds: Set<string> = new Set();

program
  .command('deforum')
  .description('queue a runpod job')
  .argument('<file>', 'path to JSON file containing deforum settings')
  .option('-o, --output <path>', 'output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file, options) => {
    if (!file.endsWith('.json')) {
      throw new InvalidArgumentError('Input file must be a .json file');
    }
    if (!fs.existsSync(file)) {
      throw new InvalidArgumentError(`File not found: ${file}`);
    }

    const raw = fs.readFileSync(file, 'utf8');
    const jsonData = JSON.parse(raw);
    const base = path.basename(file, path.extname(file));
    const outputNameFromFile = `${base}.mp4`;

    const jobOptions = {
      output_name: outputNameFromFile,
      input_file_path: path.resolve(file),
      custom_output_path: options.output,
    };

    const jobs = await runDeforum(jsonData, jobOptions);
    for (const job of jobs) {
      if (job?.id) queuedJobIds.add(String(job.id));
    }
  });

program
  .command('hunyuan')
  .description('queue a runpod job')
  .argument('<file>', 'path to JSON file containing hunyuan settings')
  .option('-o, --output <path>', 'output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file, options) => {
    if (!file.endsWith('.json')) {
      throw new InvalidArgumentError('Input file must be a .json file');
    }
    if (!fs.existsSync(file)) {
      throw new InvalidArgumentError(`File not found: ${file}`);
    }

    const raw = fs.readFileSync(file, 'utf8');
    const jsonData = JSON.parse(raw);
    const base = path.basename(file, path.extname(file));
    const outputNameFromFile = `${base}.mp4`;

    const jobOptions = {
      output_name: outputNameFromFile,
      input_file_path: path.resolve(file),
      custom_output_path: options.output,
    };

    const jobs = await runHunyuan(jsonData, jobOptions);
    for (const job of jobs) {
      if (job?.id) queuedJobIds.add(String(job.id));
    }
  });

program
  .command('animatediff')
  .description('queue a runpod job')
  .argument('<file>', 'path to JSON file containing animatediff settings')
  .option('-o, --output <path>', 'output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file, options) => {
    if (!file.endsWith('.json')) {
      throw new InvalidArgumentError('Input file must be a .json file');
    }
    if (!fs.existsSync(file)) {
      throw new InvalidArgumentError(`File not found: ${file}`);
    }

    const raw = fs.readFileSync(file, 'utf8');
    const jsonData = JSON.parse(raw);
    const base = path.basename(file, path.extname(file));
    const outputNameFromFile = `${base}.mp4`;

    const jobOptions = {
      output_name: outputNameFromFile,
      input_file_path: path.resolve(file),
      custom_output_path: options.output,
    };

    const jobs = await runVideo(jsonData, jobOptions);
    for (const job of jobs) {
      if (job?.id) queuedJobIds.add(String(job.id));
    }
  });

program.parse();
