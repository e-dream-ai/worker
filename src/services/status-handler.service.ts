import { Job, Queue } from 'bullmq';
import { PublicEndpointService, PublicEndpointResponse } from './public-endpoint.service.js';
import { R2UploadService } from './r2-upload.service.js';
import { RunpodCancelService } from './runpod-cancel.service.js';
import redisClient from '../shared/redis.js';

interface RunpodStatus {
  status: string;
  completed: boolean;
  progress?: number;
  render_time_ms?: number;
  executionTime?: number;
  delayTime?: number;
  output?: {
    message?: string;
    video?: string;
    image?: string;
    image_url?: string;
    download_url?: string;
    video_url?: string;
    requires_auth?: boolean;
  };
  error?: string;
}

export class StatusHandlerService {
  private readonly r2UploadService: R2UploadService;
  private readonly runpodCancelService: RunpodCancelService;

  constructor(private readonly defaultPollIntervalMs: number = 5000) {
    this.r2UploadService = new R2UploadService();
    this.runpodCancelService = new RunpodCancelService();
  }

  private parseGenerationTimeMs(publicStatus: PublicEndpointResponse): number | undefined {
    const output: any = publicStatus?.output;
    const candidates = [output?.generation_time, output?.generationTime];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.round(candidate * 1000);
      }
      if (typeof candidate === 'string') {
        const parsed = Number.parseFloat(candidate);
        if (Number.isFinite(parsed)) {
          return Math.round(parsed * 1000);
        }
      }
    }
    return undefined;
  }

  async handleStatus(endpoint: any, runpodId: string, job: Job, pollIntervalMs?: number): Promise<any> {
    const finalStatus = await this.pollForCompletion(
      endpoint,
      runpodId,
      job,
      typeof pollIntervalMs === 'number' ? pollIntervalMs : this.defaultPollIntervalMs
    );
    const result = this.extractResult(finalStatus);

    if (this.hasImageOutput(result)) {
      return await this.processImageResult(result, job);
    }

    if (!this.hasVideoOutput(result)) {
      throw new Error(`No video or image URL in result, status ${JSON.stringify(finalStatus)}`);
    }

    return await this.processVideoResult(result, job);
  }

  private async pollForCompletion(
    endpoint: any,
    runpodId: string,
    job: Job,
    pollIntervalMs: number
  ): Promise<RunpodStatus> {
    const isPublicEndpoint = endpoint instanceof PublicEndpointService;
    let status: RunpodStatus | undefined;
    let lastLogMessage = '';
    const startedAtMs = Date.now();

    do {
      try {
        const jobState = await job.getState();
        if (jobState === 'failed') {
          await job.log(`${new Date().toISOString()}: Job state is failed, checking if cancelled by user`);

          const queue = new Queue(job.queueName, { connection: redisClient });
          const freshJob = await queue.getJob(String(job.id));
          await queue.close();

          if (freshJob?.data?.cancelled_by_user === true) {
            await job.log(`${new Date().toISOString()}: Job cancelled by user, stopping polling`);

            if (freshJob.data?.cancel_runpod !== false) {
              await job.log(`${new Date().toISOString()}: Cancelling RunPod job ${runpodId}`);
              await this.runpodCancelService.cancelJob(endpoint, runpodId);
            }

            throw new Error('Job was cancelled by user');
          }
        }
      } catch (stateError: any) {
        if (stateError.message !== 'Job was cancelled by user') {
          console.error('Error checking job state:', stateError);
        } else {
          throw stateError;
        }
      }

      try {
        const rawStatus = await endpoint.status(runpodId);

        if (isPublicEndpoint) {
          const publicStatus = rawStatus as PublicEndpointResponse;
          const videoUrl = publicStatus.output?.video_url || publicStatus.output?.result;
          const imageUrl = publicStatus.output?.image_url || publicStatus.output?.image || publicStatus.output?.result;

          let executionTime: number | undefined = this.parseGenerationTimeMs(publicStatus);
          if (executionTime === undefined && publicStatus.status === 'COMPLETED') {
            executionTime = Date.now() - startedAtMs;
          }

          status = {
            status: publicStatus.status,
            completed: publicStatus.status === 'COMPLETED',
            executionTime: executionTime,
            output: publicStatus.output
              ? {
                  video_url: videoUrl,
                  image_url: typeof imageUrl === 'string' ? imageUrl : undefined,
                  result: publicStatus.output.result,
                  ...publicStatus.output,
                }
              : undefined,
            error: publicStatus.error,
          };
        } else {
          let detectedProgress = rawStatus.progress;
          let previewFrame: string | undefined = undefined;
          let renderTimeMs: number | undefined = undefined;

          if (rawStatus.output && typeof rawStatus.output === 'object') {
            const output = rawStatus.output as any;
            if (previewFrame === undefined && output.preview_frame) {
              previewFrame = output.preview_frame;
            }
            if ((detectedProgress === undefined || detectedProgress === 0) && typeof output.progress === 'number') {
              detectedProgress = output.progress;
            }
            if (renderTimeMs === undefined && typeof output.render_time_ms === 'number') {
              renderTimeMs = output.render_time_ms;
            }
          }

          if (detectedProgress && typeof detectedProgress === 'object') {
            previewFrame = (detectedProgress as any).preview_frame;
            renderTimeMs = (detectedProgress as any).render_time_ms;
            detectedProgress = (detectedProgress as any).progress;
          }

          if (detectedProgress === undefined && typeof rawStatus.output === 'number') {
            detectedProgress = rawStatus.output;
          }

          if (
            detectedProgress === undefined &&
            (rawStatus.status === 'IN_QUEUE' || rawStatus.status === 'IN_PROGRESS')
          ) {
            detectedProgress = 0;
          }

          status = {
            status: rawStatus.status,
            completed: rawStatus.completed || rawStatus.status === 'COMPLETED',
            progress: detectedProgress,
            render_time_ms: renderTimeMs,
            executionTime: rawStatus.executionTime,
            delayTime: rawStatus.delayTime,
            output: typeof rawStatus.output === 'number' ? undefined : rawStatus.output,
            error: rawStatus.error,
          };

          if (previewFrame) {
            console.log(`[StatusHandler] Found preview frame for job ${job.id} (${previewFrame.length} bytes)`);
            (status as any).preview_frame = previewFrame;
          }
        }

        const progressData = {
          ...status,
          dream_uuid: job.data.dream_uuid,
          user_id: job.data.user_id,
        };

        await job.updateProgress(progressData);

        const statusForLog = { ...(status as any) };
        delete statusForLog.preview_frame;
        if (statusForLog.output && typeof statusForLog.output === 'object') {
          statusForLog.output = { ...statusForLog.output };
          delete statusForLog.output.preview_frame;
        }
        const logMessage = `Got status ${JSON.stringify(statusForLog)}`;
        if (lastLogMessage !== logMessage) {
          lastLogMessage = logMessage;
          await job.log(`${new Date().toISOString()}: ${logMessage}`);
        }
      } catch (error: any) {
        console.error('Error getting endpoint status:', error?.message ?? error);
      }

      if (status?.status === 'FAILED') {
        await job.log(`${new Date().toISOString()}: Remote job FAILED: ${JSON.stringify(status)}`);
        throw new Error(JSON.stringify(status));
      }
      if (status?.completed === false && pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } while (status?.completed === false);

    return status as RunpodStatus;
  }

  private extractResult(status: RunpodStatus): any {
    const result = JSON.parse(JSON.stringify(status))?.output || {};
    if (typeof status.executionTime === 'number') {
      result.render_duration = status.executionTime;
    }
    return result;
  }

  private hasVideoOutput(result: any): boolean {
    return !!(result?.message || result?.video || result?.download_url || result?.video_url || result?.result);
  }

  private hasImageOutput(result: any): boolean {
    return !!(
      result?.image ||
      result?.image_url ||
      (result?.result && !result?.video && !result?.video_url && !result?.download_url)
    );
  }

  private async processVideoResult(result: any, job: Job): Promise<any> {
    const url = result.result || result.download_url || result.video_url || result.video;
    if (!url || result.requires_auth) {
      return result;
    }

    const needsR2Upload = (result.result || result.video_url) && !result.download_url;

    if (needsR2Upload) {
      try {
        await job.log(`${new Date().toISOString()}: Uploading video to R2`);
        const presignedUrl = await this.r2UploadService.downloadAndUploadVideo(url, String(job.id));
        await job.log(`${new Date().toISOString()}: Video uploaded to R2`);
        result.r2_url = presignedUrl;
        return result;
      } catch (error: any) {
        await job.log(`${new Date().toISOString()}: R2 upload failed, using original URL`);
        console.error('R2 upload error:', error);
        result.r2_url = url;
        return result;
      }
    }

    result.r2_url = url;
    return result;
  }

  private async processImageResult(result: any, job: Job): Promise<any> {
    const url = result.result || result.download_url || result.image_url || result.image;
    if (!url || result.requires_auth) {
      return result;
    }

    const needsR2Upload = (result.result || result.image_url || result.image) && !result.download_url;

    if (needsR2Upload) {
      try {
        await job.log(`${new Date().toISOString()}: Uploading image to R2`);
        const presignedUrl = await this.r2UploadService.downloadAndUploadImage(url, String(job.id));
        await job.log(`${new Date().toISOString()}: Image uploaded to R2`);
        result.r2_url = presignedUrl;
        return result;
      } catch (error: any) {
        await job.log(`${new Date().toISOString()}: R2 upload failed, using original URL`);
        console.error('R2 upload error:', error);
        result.r2_url = url;
        return result;
      }
    }

    result.r2_url = url;
    return result;
  }
}
