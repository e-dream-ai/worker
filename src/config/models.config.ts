interface BaseModelConfig {
  id: string;
  provider: 'fal';
  endpoint: string;
}

export interface VideoModelConfig extends BaseModelConfig {
  mediaType: 'video';
  minDurationSec: number;
  maxDurationSec: number;
  defaultDurationSec: number;
  allowedDurationsSec?: number[];
}

export interface ImageModelConfig extends BaseModelConfig {
  mediaType: 'image';
}

export type WorkerModelConfig = VideoModelConfig | ImageModelConfig;

export const WORKER_MODELS: Record<string, WorkerModelConfig> = {
  'kling-i2v': {
    id: 'kling-i2v',
    provider: 'fal',
    mediaType: 'video',
    endpoint: 'fal-ai/kling-video/v3/pro/image-to-video',
    minDurationSec: 3,
    maxDurationSec: 15,
    defaultDurationSec: 5,
  },
  'kling-25-i2v': {
    id: 'kling-25-i2v',
    provider: 'fal',
    mediaType: 'video',
    endpoint: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    minDurationSec: 5,
    maxDurationSec: 10,
    defaultDurationSec: 5,
    allowedDurationsSec: [5, 10],
  },
  'flux-schnell': {
    id: 'flux-schnell',
    provider: 'fal',
    mediaType: 'image',
    endpoint: 'fal-ai/flux-1/schnell',
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
