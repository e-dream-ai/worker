import type { ImageSize, NonEmptyArray } from '../utils/image-geometry.js';

/**
 * Kling resizes head and tail images differently above a 2560px long side, so
 * its inputs get snapped to one of these first. See utils/image-geometry.ts.
 */
const KLING_INPUT_GEOMETRY: NonEmptyArray<ImageSize> = [
  { width: 1920, height: 1080 }, // 16:9
  { width: 1080, height: 1920 }, // 9:16
  { width: 1080, height: 1080 }, // 1:1
];

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
  cfgScaleRange?: { min: number; max: number };
  /**
   * Fixed sizes this model's input images are snapped to before submission,
   * picked by nearest aspect ratio. Set it where the provider handles the start
   * and end image differently; omit it to send images through untouched.
   */
  inputGeometry?: NonEmptyArray<ImageSize>;
}

export interface ImageModelConfig extends BaseModelConfig {
  mediaType: 'image';
  inputImage?: boolean; // model takes a source image (image-to-image, e.g. Kontext)
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
    cfgScaleRange: { min: 0, max: 1 },
    inputGeometry: KLING_INPUT_GEOMETRY,
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
    cfgScaleRange: { min: 0, max: 1 },
    inputGeometry: KLING_INPUT_GEOMETRY,
  },
  'flux-schnell': {
    id: 'flux-schnell',
    provider: 'fal',
    mediaType: 'image',
    endpoint: 'fal-ai/flux-1/schnell',
  },
  'flux-kontext-i2i': {
    id: 'flux-kontext-i2i',
    provider: 'fal',
    mediaType: 'image',
    endpoint: 'fal-ai/flux-pro/kontext',
    inputImage: true,
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
