import { Worker } from 'bullmq';
import redisClient from '../shared/redis.js';
import env from '../shared/env.js';

type JobHandler = (job: any) => Promise<any>;

export class WorkerFactory {
  static createWorker(name: string, handler: JobHandler): Worker {
    const worker = new Worker(name, handler, {
      connection: redisClient,
      lockDuration: 5 * 60 * 60 * 1000,
      stalledInterval: 5 * 60 * 1000,
      maxStalledCount: 20,
    });

    worker.on('failed', (job, error: Error) => {
      console.error(
        `Job failed: ${name} error: ${this.serializeError(error)}, job data: ${JSON.stringify(job?.toJSON())}`
      );
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
}
