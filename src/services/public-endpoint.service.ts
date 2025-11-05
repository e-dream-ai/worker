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
      throw new Error(`Failed to start job: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = (await response.json()) as PublicEndpointResponse;
    return { id: data.id };
  }

  async runSync(input: RunJobInput): Promise<PublicEndpointResponse> {
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
      throw new Error(`Failed to run sync job: ${response.status} ${response.statusText}. ${errorText}`);
    }

    return (await response.json()) as PublicEndpointResponse;
  }

  async status(jobId: string): Promise<PublicEndpointResponse> {
    const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get job status: ${response.status} ${response.statusText}. ${errorText}`);
    }

    return (await response.json()) as PublicEndpointResponse;
  }
}
