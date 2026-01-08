import { Job } from 'bullmq';
import { PublicEndpointService, PublicEndpointResponse } from './public-endpoint.service.js';
import { R2UploadService } from './r2-upload.service.js';

interface RunpodStatus {
  status: string;
  completed: boolean;
  progress?: number;
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

  constructor(private readonly defaultPollIntervalMs: number = 5000) {
    this.r2UploadService = new R2UploadService();
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

    do {
      try {
        const rawStatus = await endpoint.status(runpodId);

        if (isPublicEndpoint) {
          const publicStatus = rawStatus as PublicEndpointResponse;
          const videoUrl = publicStatus.output?.video_url || publicStatus.output?.result;
          const imageUrl = publicStatus.output?.image_url || publicStatus.output?.image || publicStatus.output?.result;
          status = {
            status: publicStatus.status,
            completed: publicStatus.status === 'COMPLETED',
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
            executionTime: rawStatus.executionTime,
            delayTime: rawStatus.delayTime,
            output: typeof rawStatus.output === 'number' ? undefined : rawStatus.output,
            error: rawStatus.error,
          };
        }

        const progressData = {
          ...status,
          dream_uuid: job.data.dream_uuid,
          user_id: job.data.user_id,
        };

        await job.updateProgress(progressData);

        const logMessage = `Got status ${JSON.stringify(status)}`;
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
    if (status.executionTime) {
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
