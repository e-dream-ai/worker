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
      const errorMessage = this.serializeError(error);
      const cleanErrorMessage = this.extractErrorMessage(error);
      console.error(`Job failed: ${name} error: ${errorMessage}, job data: ${JSON.stringify(job?.toJSON())}`);

      const jobData = job?.data;
      if (jobData?.dream_uuid) {
        try {
          await videoServiceClient.setDreamFailed(
            jobData.dream_uuid,
            cleanErrorMessage.length > 10000 ? cleanErrorMessage.substring(0, 10000) : cleanErrorMessage
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

  private static extractErrorMessage(error: Error): string {
    try {
      let parsedMessage: any;
      try {
        parsedMessage = JSON.parse(error.message);
      } catch {
        parsedMessage = error.message;
      }

      if (typeof parsedMessage === 'object' && parsedMessage !== null) {
        if (parsedMessage.error) {
          return parsedMessage.error;
        }
        if (parsedMessage.status && parsedMessage.error) {
          return parsedMessage.error;
        }
        if (parsedMessage.status === 'FAILED' && parsedMessage.error) {
          return parsedMessage.error;
        }
        return parsedMessage.error || parsedMessage.message || JSON.stringify(parsedMessage);
      }

      return typeof parsedMessage === 'string' ? parsedMessage : error.message;
    } catch {
      return error.message || 'An unknown error occurred';
    }
  }
}
