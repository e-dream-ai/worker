import { Job } from 'bullmq';

interface RunpodStatus {
  status: string;
  completed: boolean;
  output?: {
    message?: string;
    video?: string;
    download_url?: string;
    requires_auth?: boolean;
  };
}

export class StatusHandlerService {
  constructor(private readonly defaultPollIntervalMs: number = 1000) {}

  async handleStatus(endpoint: any, runpodId: string, job: Job, pollIntervalMs?: number): Promise<any> {
    const finalStatus = await this.pollForCompletion(
      endpoint,
      runpodId,
      job,
      typeof pollIntervalMs === 'number' ? pollIntervalMs : this.defaultPollIntervalMs
    );
    const result = this.extractResult(finalStatus);

    if (!this.hasVideoOutput(result)) {
      throw new Error(`No video URL in result, status ${JSON.stringify(finalStatus)}`);
    }

    return await this.processVideoResult(result, job);
  }

  private async pollForCompletion(
    endpoint: any,
    runpodId: string,
    job: Job,
    pollIntervalMs: number
  ): Promise<RunpodStatus> {
    let status: RunpodStatus | undefined;
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
    return !!(result?.message || result?.video || result?.download_url);
  }

  private async processVideoResult(result: any, job: Job): Promise<any> {
    // Normalize uprez output shape: prefer download_url, fallback to video
    const url = result.download_url || result.video;
    if (!url || result.requires_auth) {
      return result;
    }
    await job.log(`${new Date().toISOString()}: Returning URL for client download`);
    result.r2_url = url;
    return result;
  }
}
