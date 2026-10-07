export type ImagePresetName = 'dream' | 'thumbnail' | 'avatar';

export interface ImagePreset {
  readonly maxDimension: number;
  readonly quality: number;
}

export const IMAGE_PRESETS = {
  dream: { maxDimension: 4096, quality: 85 },
  thumbnail: { maxDimension: 2048, quality: 85 },
  avatar: { maxDimension: 1024, quality: 85 },
} as const satisfies Record<ImagePresetName, ImagePreset>;

export function isImagePresetName(value: unknown): value is ImagePresetName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(IMAGE_PRESETS, value);
}

export const IMAGE_NORMALIZE_QUEUE = 'imagenormalize';
export const WEBP_EXTENSION = 'webp';
export const WEBP_MIME_TYPE = 'image/webp';
export const WEBP_EFFORT = 4;
export const MAX_IMAGE_INPUT_PIXELS = 50_000_000;
export const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024;
export const BACKEND_REQUEST_TIMEOUT_MS = 30_000;

export const LOCAL_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'tif',
  'tiff',
  'avif',
  'svg',
]);
