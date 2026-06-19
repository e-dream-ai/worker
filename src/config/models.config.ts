export interface WorkerModelConfig {
  id: string;
  provider: 'fal';
  endpoint: string;
  minDurationSec: number;
  maxDurationSec: number;
  defaultDurationSec: number;
  allowedDurationsSec?: number[];
}

export const WORKER_MODELS: Record<string, WorkerModelConfig> = {
  'kling-i2v': {
    id: 'kling-i2v',
    provider: 'fal',
    endpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
    minDurationSec: 3,
    maxDurationSec: 15,
    defaultDurationSec: 5,
  },
  'kling-25-i2v': {
    id: 'kling-25-i2v',
    provider: 'fal',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    minDurationSec: 5,
    maxDurationSec: 10,
    defaultDurationSec: 5,
    allowedDurationsSec: [5, 10],
  },
};

export function getModelConfig(modelId: string | undefined): WorkerModelConfig {
  if (!modelId) {
    throw new Error('No model id (infinidream_algorithm) provided in job data');
  }
  const config = WORKER_MODELS[modelId];
  if (!config) {
    throw new Error(`Unknown model "${modelId}" — add it to config/models.config.ts`);
  }
  return config;
}
