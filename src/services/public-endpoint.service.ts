import env from '../shared/env.js';

export interface PublicEndpointResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  output?: {
    video_url?: string;
    result?: string;
    cost?: number;
    width?: number;
    height?: number;
    duration?: number;
    seed?: number;
    generation_time?: number;
    [key: string]: unknown;
  };
  error?: string;
}

export interface RunJobInput {
  [key: string]: unknown;
}

export class PublicEndpointService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(endpointPath: string) {
    this.baseUrl = `https://api.runpod.ai/v2/${endpointPath}`;
    this.apiKey = env.RUNPOD_API_KEY;
  }

  async run(input: RunJobInput): Promise<{ id: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Failed to start job: ${response.status} ${response.statusText}. ${errorText}`);
        console.error('[PublicEndpointService.run]', {
          endpoint: this.baseUrl,
          status: response.status,
          statusText: response.statusText,
          errorText,
          error: error.message,
        });
        throw error;
      }

      const data = (await response.json()) as PublicEndpointResponse;
      return { id: data.id };
    } catch (error: any) {
      if (error.message?.includes('Failed to start job')) {
        throw error;
      }
      console.error('[PublicEndpointService.run]', {
        endpoint: this.baseUrl,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  async runSync(input: RunJobInput): Promise<PublicEndpointResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/runsync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Failed to run sync job: ${response.status} ${response.statusText}. ${errorText}`);
        console.error('[PublicEndpointService.runSync]', {
          endpoint: this.baseUrl,
          status: response.status,
          statusText: response.statusText,
          errorText,
          error: error.message,
        });
        throw error;
      }

      return (await response.json()) as PublicEndpointResponse;
    } catch (error: any) {
      if (error.message?.includes('Failed to run sync job')) {
        throw error;
      }
      console.error('[PublicEndpointService.runSync]', {
        endpoint: this.baseUrl,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  async status(jobId: string): Promise<PublicEndpointResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Failed to get job status: ${response.status} ${response.statusText}. ${errorText}`);
        console.error('[PublicEndpointService.status]', {
          endpoint: this.baseUrl,
          jobId,
          status: response.status,
          statusText: response.statusText,
          errorText,
          error: error.message,
        });
        throw error;
      }

      return (await response.json()) as PublicEndpointResponse;
    } catch (error: any) {
      if (error.message?.includes('Failed to get job status')) {
        throw error;
      }
      console.error('[PublicEndpointService.status]', {
        endpoint: this.baseUrl,
        jobId,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  async cancel(jobId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/cancel/${jobId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PublicEndpointService.cancel] Error cancelling job:', {
          endpoint: this.baseUrl,
          jobId,
          status: response.status,
          errorText,
        });
      }
    } catch (error: any) {
      console.error('[PublicEndpointService.cancel] Failed to cancel job:', {
        endpoint: this.baseUrl,
        jobId,
        error: error.message || 'Unknown error',
      });
    }
  }
}
