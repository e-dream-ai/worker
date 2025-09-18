import { Job } from 'bullmq';
import { DownloadService } from './download.service.js';
import { PathResolver } from '../utils/path-resolver.js';
import env from '../shared/env.js';

interface RunpodStatus {
  status: string;
  completed: boolean;
  output?: {
    message?: string;
    video?: string;
    requires_auth?: boolean;
  };
}

export class StatusHandlerService {
  constructor(private readonly downloadService: DownloadService) {}

  async handleStatus(endpoint: any, runpodId: string, job: Job): Promise<any> {
    const finalStatus = await this.pollForCompletion(endpoint, runpodId, job);
    const result = this.extractResult(finalStatus);

    if (!this.hasVideoOutput(result)) {
      throw new Error(`No video URL in result, status ${JSON.stringify(finalStatus)}`);
    }

    return await this.processVideoResult(result, job);
  }

  private async pollForCompletion(endpoint: any, runpodId: string, job: Job): Promise<RunpodStatus> {
    let status: RunpodStatus;
    let lastLogMessage = '';

    do {
      try {
        status = await endpoint.status(runpodId);
        await job.updateProgress(status);

        const logMessage = `Got status ${JSON.stringify(status)}`;
        if (lastLogMessage !== logMessage) {
          lastLogMessage = logMessage;
          await job.log(`${new Date().toISOString()}: ${logMessage}`);
        }

        if (status.status === 'FAILED') {
          throw new Error(JSON.stringify(status));
        }
      } catch (error) {
        console.error('Error getting endpoint status:', error.message);
      }
    } while (status?.completed === false);

    return status;
  }

  private extractResult(status: RunpodStatus): any {
    return JSON.parse(JSON.stringify(status))?.output;
  }

  private hasVideoOutput(result: any): boolean {
    return !!(result?.message || result?.video);
  }

  private async processVideoResult(result: any, job: Job): Promise<any> {
    if (!result.video || result.requires_auth) {
      return result;
    }

    if (env.REMOTE_MODE) {
      return this.handleRemoteMode(result, job);
    }

    return await this.handleLocalMode(result, job);
  }

  private async handleRemoteMode(result: any, job: Job): Promise<any> {
    await job.log(`${new Date().toISOString()}: Remote mode - returning R2 URL for client download`);
    result.r2_url = result.video;
    result.remote_mode = true;
    return result;
  }

  private async handleLocalMode(result: any, job: Job): Promise<any> {
    try {
      const localPath = this.resolveLocalPath(job);

      await job.log(`${new Date().toISOString()}: Starting download of video file...`);
      await this.downloadService.downloadFile(result.video, localPath);

      result.local_path = localPath;
      result.downloaded_at = new Date().toISOString();

      await job.log(`${new Date().toISOString()}: Video downloaded successfully to ${localPath}`);
      return result;
    } catch (downloadError) {
      console.error(`Failed to download video for job ${job.id}:`, downloadError.message);
      await job.log(`${new Date().toISOString()}: Download failed: ${downloadError.message}`);
      result.download_error = downloadError.message;
      return result;
    }
  }

  private resolveLocalPath(job: Job): string {
    const jobData = job.data as any;
    return PathResolver.resolveOutputPath({
      customOutputPath: jobData?.custom_output_path,
      inputFilePath: jobData?.input_file_path,
      outputName: jobData?.output_name,
      jobId: job.id,
    });
  }
}
