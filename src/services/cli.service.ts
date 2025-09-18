import { Job, Queue, QueueEvents } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { InvalidArgumentError } from 'commander';
import { DownloadService } from './download.service.js';
import { PathResolver } from '../utils/path-resolver.js';
import redisClient from '../shared/redis.js';

interface JobOptions {
  output?: string;
}

interface QueueConfig {
  name: string;
  queue: Queue;
  events: QueueEvents;
}

export class CLIService {
  private readonly downloadService = new DownloadService();
  private readonly queuedJobIds = new Set<string>();
  private lastProgress = '';

  private readonly queues: Record<string, QueueConfig> = {
    video: this.createQueueConfig('video'),
    hunyuanvideo: this.createQueueConfig('hunyuanvideo'),
    deforumvideo: this.createQueueConfig('deforumvideo'),
  };

  constructor() {
    this.setupEventListeners();
  }

  async processJobFile(queueName: string, filePath: string, options: JobOptions): Promise<void> {
    this.validateInputFile(filePath);

    const jsonData = this.readJsonFile(filePath);
    const jobOptions = this.createJobOptions(filePath, options);

    const jobs = await this.queueJob(queueName, jsonData, jobOptions);
    this.trackJobs(jobs);
  }

  private createQueueConfig(name: string): QueueConfig {
    const queue = new Queue(name, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 1,
        backoff: { type: 'exponential', delay: 1000 },
      },
    });

    const events = new QueueEvents(name, {
      connection: redisClient,
    });
    return { name, queue, events };
  }

  private setupEventListeners(): void {
    Object.values(this.queues).forEach(({ events, name }) => {
      events.on('completed', (data) => this.handleJobCompleted(data, name));
      events.on('progress', this.handleJobProgress.bind(this));
      events.on('failed', (data) => this.handleJobFailed(data, name));
    });
  }

  private validateInputFile(filePath: string): void {
    if (!filePath.endsWith('.json')) {
      throw new InvalidArgumentError('Input file must be a .json file');
    }
    if (!fs.existsSync(filePath)) {
      throw new InvalidArgumentError(`File not found: ${filePath}`);
    }
  }

  private readJsonFile(filePath: string): any {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  private createJobOptions(filePath: string, options: JobOptions) {
    const baseName = path.basename(filePath, path.extname(filePath));
    const outputName = `${baseName}.mp4`;

    return {
      output_name: outputName,
      input_file_path: path.resolve(filePath),
      custom_output_path: options.output,
    };
  }

  private async queueJob(queueName: string, jsonData: any, jobOptions: any): Promise<Job[]> {
    const queue = this.queues[queueName]?.queue;
    if (!queue) {
      throw new Error(`Unknown queue: ${queueName}`);
    }

    const job = {
      name: 'message',
      data: { ...jsonData, ...jobOptions },
    };

    console.log(`Running: ${JSON.stringify(job)}`);
    return queue.addBulk([job]);
  }

  private trackJobs(jobs: Job[]): void {
    jobs.forEach((job) => {
      if (job?.id) {
        this.queuedJobIds.add(String(job.id));
      }
    });
  }

  private async handleJobCompleted(data: { jobId: string }, queueName: string): Promise<void> {
    try {
      const queue = this.queues[queueName]?.queue;
      if (!queue) return;

      const job = await Job.fromId(queue, data.jobId);
      console.log(
        `\n${new Date().toISOString()}: Job finished: ${JSON.stringify(job?.returnvalue)} for job ${JSON.stringify(job?.id)}`
      );

      if (!this.queuedJobIds.has(data.jobId)) return;

      const returnValue = job?.returnvalue as any;
      await this.handleJobResult(returnValue, job);
    } catch (error) {
      console.error(
        `\n${new Date().toISOString()}: Error retrieving completed job ${data.jobId} from ${queueName}:`,
        error
      );
    }
  }

  private async handleJobResult(returnValue: any, job: Job): Promise<void> {
    if (returnValue?.remote_mode && returnValue?.r2_url) {
      await this.handleRemoteDownload(returnValue, job);
    } else if (returnValue?.local_path) {
      console.log(`Downloaded file saved at: ${returnValue.local_path}`);
      process.exit(0);
    }
  }

  private async handleRemoteDownload(returnValue: any, job: Job): Promise<void> {
    try {
      const localPath = this.resolveDownloadPath(job);

      console.log(`\n${new Date().toISOString()}: Downloading from R2 URL to: ${localPath}`);
      await this.downloadService.downloadFile(returnValue.r2_url, localPath);
      console.log(`Downloaded file saved at: ${localPath}`);
      process.exit(0);
    } catch (downloadError) {
      console.error(`\n${new Date().toISOString()}: Failed to download from R2:`, downloadError);
      process.exit(1);
    }
  }

  private resolveDownloadPath(job: Job): string {
    const jobData = job.data as any;
    return PathResolver.resolveOutputPath({
      customOutputPath: jobData?.custom_output_path,
      inputFilePath: jobData?.input_file_path,
      outputName: jobData?.output_name,
      jobId: job.id,
    });
  }

  private async handleJobFailed(data: { jobId: string }, queueName: string): Promise<void> {
    try {
      const queue = this.queues[queueName]?.queue;
      if (!queue) return;

      const job = await Job.fromId(queue, data.jobId);
      console.log(`\n${new Date().toISOString()}: Job failed: ${job?.failedReason} for job ${JSON.stringify(job?.id)}`);
    } catch (error) {
      console.error(
        `\n${new Date().toISOString()}: Error retrieving failed job ${data.jobId} from ${queueName}:`,
        error
      );
    }
  }

  private handleJobProgress(data: any): void {
    const progress = JSON.stringify(data);
    if (this.lastProgress !== progress) {
      console.log(`\n${new Date().toISOString()}: Job progress: ${progress}`);
      this.lastProgress = progress;
    } else {
      process.stdout.write('.');
    }
  }
}
