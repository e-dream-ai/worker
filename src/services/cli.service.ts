import { Job, Queue, QueueEvents } from 'bullmq';
import fs from 'fs';
import path from 'path';
import { InvalidArgumentError } from 'commander';
import FormData from 'form-data';
import { existsSync, readFileSync } from 'fs';
import { request } from 'undici';
import { DownloadService } from './download.service.js';
import { PathResolver } from '../utils/path-resolver.js';
import env from '../shared/env.js';
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
    uprezvideo: this.createQueueConfig('uprezvideo'),
    want2v: this.createQueueConfig('want2v'),
    wani2v: this.createQueueConfig('wani2v'),
    wani2vlora: this.createQueueConfig('wani2vlora'),
  };

  constructor() {
    this.setupEventListeners();
  }

  async processJobFileAuto(filePath: string, options: JobOptions): Promise<void> {
    this.validateInputFile(filePath);

    let jsonData = this.readJsonFile(filePath);
    const queueName = this.inferQueueName(jsonData);

    if (queueName === 'wani2v' || queueName === 'wani2vlora') {
      jsonData = await this.processImagesForWanI2V(jsonData, filePath);
    }

    const jobOptions = this.createJobOptions(filePath, options);
    const jobs = await this.queueJob(queueName, jsonData, jobOptions);
    this.trackJobs(jobs);
  }

  private inferQueueName(jsonData: any): string {
    const algoRaw: unknown = jsonData?.infinidream_algorithm;
    const algorithm = String(algoRaw || '')
      .toLowerCase()
      .trim();

    if (!algorithm) {
      throw new InvalidArgumentError(
        "Missing 'infinidream_algorithm'. Allowed values: animatediff, hunyuan, deforum, uprez, wan-t2v, wan-i2v, wan-i2v-lora"
      );
    }

    switch (algorithm) {
      case 'animatediff':
        return 'video';
      case 'hunyuan':
        return 'hunyuanvideo';
      case 'deforum':
        return 'deforumvideo';
      case 'uprez':
        return 'uprezvideo';
      case 'wan-t2v':
        return 'want2v';
      case 'wan-i2v':
        return 'wani2v';
      case 'wan-i2v-lora':
        return 'wani2vlora';
      default:
        throw new InvalidArgumentError(
          `Unknown 'infinidream_algorithm': ${algorithm}. Allowed values: animatediff, hunyuan, deforum, uprez, wan-t2v, wan-i2v, wan-i2v-lora`
        );
    }
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
      process.exit(0);
    } catch (error) {
      console.error(
        `\n${new Date().toISOString()}: Error retrieving completed job ${data.jobId} from ${queueName}:`,
        error
      );
    }
  }

  private async handleJobResult(returnValue: any, job: Job): Promise<void> {
    if (returnValue?.r2_url) {
      await this.handleRemoteDownload(returnValue, job);
      return;
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
      if (this.queuedJobIds.has(data.jobId)) {
        process.exit(1);
      }
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

  private async uploadImageToWorker(imagePath: string, workerUrl: string): Promise<string> {
    const formData = new FormData();
    const imageBuffer = readFileSync(imagePath);
    const filename = path.basename(imagePath);
    formData.append('image', imageBuffer, filename);

    const { statusCode, body } = await request(`${workerUrl}/api/upload-image`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });

    if (statusCode !== 200) {
      const errorText = await body.text();
      throw new Error(`Worker upload failed: ${statusCode} ${errorText}`);
    }

    const data = (await body.json()) as { url: string };
    return data.url;
  }

  private async processImagesForWanI2V(jsonData: any, filePath: string): Promise<any> {
    const result = { ...jsonData };
    const imageFields = ['image', 'last_image'];
    const baseDir = path.dirname(path.resolve(filePath));
    const workerUrl = env.WORKER_URL;

    for (const field of imageFields) {
      const imagePath = result[field] as string | undefined;

      if (!imagePath || typeof imagePath !== 'string') {
        continue;
      }

      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        continue;
      }

      if (!imagePath.includes('/') && !imagePath.includes('\\')) {
        try {
          Buffer.from(imagePath, 'base64');
          continue;
        } catch {
          // Not base64, continue to check if it's a file path
        }
      }

      let resolvedPath: string;
      if (path.isAbsolute(imagePath)) {
        resolvedPath = imagePath;
      } else {
        resolvedPath = path.resolve(baseDir, imagePath);
      }

      if (!existsSync(resolvedPath)) {
        throw new Error(
          `Image file not found: "${imagePath}" (resolved: ${resolvedPath}). ` +
            `Please ensure the image file exists locally before submitting the job.`
        );
      }

      try {
        console.log(`Uploading ${field} to worker: ${resolvedPath}...`);
        const presignedUrl = await this.uploadImageToWorker(resolvedPath, workerUrl);
        result[field] = presignedUrl;
        console.log(`${field} uploaded: ${presignedUrl.substring(0, 80)}...`);
      } catch (error: any) {
        console.error(`Failed to upload ${field} (${resolvedPath}): ${error.message}`);
        throw new Error(`Failed to upload image for ${field}: ${error.message}`);
      }
    }

    return result;
  }
}
