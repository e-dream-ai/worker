import { Worker } from 'bullmq';
import redisClient from '../shared/redis.js';
import env from '../shared/env.js';
import { VideoServiceClient } from '../services/video-service.client.js';

type JobHandler = (job: any) => Promise<any>;

const videoServiceClient = new VideoServiceClient();

export class WorkerFactory {
  static createWorker(name: string, handler: JobHandler): Worker {
    const worker = new Worker(name, handler, {
      connection: redisClient,
    });

    worker.on('failed', async (job, error: Error) => {
      const serializedError = this.serializeError(error);
      const rawErrorMessage = this.extractRawErrorMessage(error);
      console.error(`Job failed: ${name} error: ${serializedError}, job data: ${JSON.stringify(job?.toJSON())}`);

      const jobData = job?.data;
      if (jobData?.dream_uuid) {
        try {
          await videoServiceClient.setDreamFailed(
            jobData.dream_uuid,
            rawErrorMessage.length > 10000 ? rawErrorMessage.substring(0, 10000) : rawErrorMessage
          );
        } catch (err: any) {
          console.error(`Failed to set dream ${jobData.dream_uuid} as failed:`, err.message || err);
        }
      }
    });

    worker.on('completed', (job, returnValue) => {
      if (env.DEBUG) {
        console.debug(
          `Job completed: ${name}, returning: ${JSON.stringify(returnValue)}, job data: ${JSON.stringify(job.toJSON())}`
        );
      }
    });

    worker.on('error', (error: Error) => {
      console.error(`Job error: ${name} error: ${this.serializeError(error)}`);
    });

    return worker;
  }

  private static serializeError(error: Error): string {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  }

  private static extractRawErrorMessage(error: Error): string {
    if (typeof error.message === 'string' && error.message.length) {
      return error.message;
    }

    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error));
    } catch {
      return 'Unknown error';
    }
  }
}
