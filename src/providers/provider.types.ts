export interface NormalizedVideoInput {
  prompt: string;
  startImageUrl: string;
  endImageUrl?: string;
  durationSec?: number;
  negativePrompt?: string;
  cfgScale?: number;
}

export interface ProviderSubmitResult {
  requestId: string;
}

export type ProviderStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface ProviderPollResult {
  status: ProviderStatus;
  completed: boolean;
  videoUrl?: string;
  renderDurationMs?: number;
}

export interface VideoProvider {
  readonly name: string;
  submit(endpoint: string, input: NormalizedVideoInput, apiKey: string): Promise<ProviderSubmitResult>;
  poll(endpoint: string, requestId: string, apiKey: string): Promise<ProviderPollResult>;
  cancel?(endpoint: string, requestId: string, apiKey: string): Promise<void>;
}
