import { UnrecoverableError, type Job } from 'bullmq';
import {
  isImagePresetName,
  MAX_IMAGE_INPUT_BYTES,
  WEBP_MIME_TYPE,
  type ImagePresetName,
} from '../config/image.config.js';
import {
  isNormalizedImage,
  normalizeImage,
  runImageTask,
  UnsupportedLocalImageError,
} from '../services/image-normalize.service.js';
import { getR2Object, putR2Object } from '../shared/r2.js';

interface ImageNormalizeJobData {
  object_key: string;
  preset: ImagePresetName;
  cache_control?: string;
}

interface ImageNormalizeResult {
  readonly status: 'normalized' | 'unchanged' | 'skipped';
  readonly object_key: string;
}

function assertImageNormalizeJobData(data: unknown): asserts data is ImageNormalizeJobData {
  const candidate = data as Partial<Record<keyof ImageNormalizeJobData, unknown>> | null;
  const isValid =
    typeof candidate?.object_key === 'string' &&
    candidate.object_key.length > 0 &&
    isImagePresetName(candidate.preset) &&
    (candidate.cache_control === undefined || typeof candidate.cache_control === 'string');

  if (!isValid) throw new UnrecoverableError(`Invalid image normalize job data: ${JSON.stringify(data)}`);
}

export async function handleImageNormalizeJob(job: Job<unknown>): Promise<ImageNormalizeResult> {
  assertImageNormalizeJobData(job.data);
  const { object_key: key, preset, cache_control: cacheControl } = job.data;

  return runImageTask(async (): Promise<ImageNormalizeResult> => {
    const source = await getR2Object(key, MAX_IMAGE_INPUT_BYTES);
    if (!source) return { status: 'skipped', object_key: key };

    if (await isNormalizedImage(source, preset)) return { status: 'unchanged', object_key: key };

    try {
      const image = await normalizeImage(source, preset);
      await putR2Object({ key, body: image.buffer, contentType: WEBP_MIME_TYPE, cacheControl });
      return { status: 'normalized', object_key: key };
    } catch (error) {
      if (!(error instanceof UnsupportedLocalImageError)) throw error;
      await job.log(`${new Date().toISOString()}: Kept original ${key}: ${error.message}`);
      return { status: 'skipped', object_key: key };
    }
  });
}
