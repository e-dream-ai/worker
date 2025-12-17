import { Job } from 'bullmq';
import { PublicEndpointService, PublicEndpointResponse } from './public-endpoint.service.js';
import { R2UploadService } from './r2-upload.service.js';

interface RunpodStatus {
  status: string;
  completed: boolean;
  output?: {
    message?: string;
    video?: string;
    download_url?: string;
    video_url?: string;
    requires_auth?: boolean;
  };
  error?: string;
}

export class StatusHandlerService {
  private readonly r2UploadService: R2UploadService;

  constructor(private readonly defaultPollIntervalMs: number = 1000) {
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

    if (!this.hasVideoOutput(result)) {
      await job.log(
        `${new Date().toISOString()}: No video URL in result, status ${JSON.stringify(finalStatus)}, extracted result: ${JSON.stringify(result)}`
      );
      throw new Error(`No video URL in result, status ${JSON.stringify(finalStatus)}`);
    }

    const processedResult = await this.processVideoResult(result, job);
    await job.log(
      `${new Date().toISOString()}: Video result processed, r2_url: ${processedResult?.r2_url || 'missing'}`
    );
    return processedResult;
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
          status = {
            status: publicStatus.status,
            completed: publicStatus.status === 'COMPLETED',
            output: publicStatus.output
              ? {
                  video_url: videoUrl,
                  result: publicStatus.output.result,
                  ...publicStatus.output,
                }
              : undefined,
            error: publicStatus.error,
          };
        } else {
          status = rawStatus;
        }

        await job.updateProgress(status);

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
    return JSON.parse(JSON.stringify(status))?.output;
  }

  private hasVideoOutput(result: any): boolean {
    return !!(result?.message || result?.video || result?.download_url || result?.video_url || result?.result);
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
}
