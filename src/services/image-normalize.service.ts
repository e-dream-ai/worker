import { createHash } from 'crypto';
import pLimit from 'p-limit';
import sharp from 'sharp';
import env from '../shared/env.js';
import {
  IMAGE_PRESETS,
  MAX_IMAGE_INPUT_PIXELS,
  WEBP_EFFORT,
  WEBP_EXTENSION,
  type ImagePresetName,
} from '../config/image.config.js';

sharp.cache(false);

export const runImageTask = pLimit(Math.max(1, env.IMAGE_INGEST_CONCURRENCY));

export interface NormalizedImage {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly md5: string;
}

export class UnsupportedLocalImageError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'UnsupportedLocalImageError';
  }
}

export async function isNormalizedImage(input: Buffer, preset: ImagePresetName): Promise<boolean> {
  try {
    const { format, width, height, orientation } = await sharp(input, {
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    }).metadata();
    return (
      format === WEBP_EXTENSION &&
      (orientation === undefined || orientation === 1) &&
      Math.max(width, height) <= IMAGE_PRESETS[preset].maxDimension
    );
  } catch {
    return false;
  }
}

export async function normalizeImage(input: Buffer, preset: ImagePresetName): Promise<NormalizedImage> {
  const { maxDimension, quality } = IMAGE_PRESETS[preset];

  try {
    const { data, info } = await sharp(input, {
      animated: true,
      autoOrient: true,
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    })
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: WEBP_EFFORT })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      width: info.width,
      height: info.pageHeight ?? info.height,
      size: info.size,
      md5: createHash('md5').update(data).digest('hex'),
    };
  } catch (error) {
    throw new UnsupportedLocalImageError(error);
  }
}
