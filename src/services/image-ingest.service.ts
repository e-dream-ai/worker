import axios from 'axios';
import type { Job } from 'bullmq';
import pRetry, { type Options as RetryOptions, type RetryContext } from 'p-retry';
import {
  BACKEND_REQUEST_TIMEOUT_MS,
  LOCAL_IMAGE_EXTENSIONS,
  MAX_IMAGE_INPUT_BYTES,
  WEBP_EXTENSION,
} from '../config/image.config.js';
import env from '../shared/env.js';
import { getR2Object } from '../shared/r2.js';
import { getJobRunContext, type JobRunContext } from '../utils/job-progress.js';
import {
  normalizeImage,
  runImageTask,
  UnsupportedLocalImageError,
  type NormalizedImage,
} from './image-normalize.service.js';

const UPLOAD_TIMEOUT_MS = 60_000;

export interface VideoIngestJobData extends Partial<JobRunContext> {
  dream_uuid: string;
  type?: 'video' | 'image' | 'md5' | 'filmstrip';
  extension?: string;
}

export interface ImageIngestResult {
  readonly status: 'success';
  readonly type: 'image';
  readonly dream_uuid: string;
}

interface ApiResponse<T> {
  data: T;
}

interface DreamSource {
  original_video?: string | null;
}

interface MultipartUpload {
  urls: string[];
  uploadId: string;
}

type ProgressStatus = 'IN_PROGRESS' | 'COMPLETED';

const isRetryableBackendError = ({ error }: RetryContext): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
};

const BACKEND_RETRY = {
  retries: 2,
  minTimeout: 500,
  shouldRetry: isRetryableBackendError,
} as const satisfies RetryOptions;

const backend = axios.create({
  baseURL: env.BACKEND_URL,
  timeout: BACKEND_REQUEST_TIMEOUT_MS,
  headers: {
    Authorization: `Api-Key ${env.BACKEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

export function canIngestImageLocally(extension?: string): boolean {
  return env.IMAGE_INGEST_LOCAL && !!extension && LOCAL_IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

async function reportProgress(job: Job<VideoIngestJobData>, status: ProgressStatus, progress: number): Promise<void> {
  try {
    await job.updateProgress({
      ...getJobRunContext(job),
      status,
      progress,
      completed: status === 'COMPLETED',
      job_type: 'image',
      stage: 'ingesting',
      dream_uuid: job.data.dream_uuid,
    });
  } catch (error) {
    console.error(`Failed to report image ingest progress for job ${job.id}:`, error);
  }
}

async function getDreamSource(dreamUuid: string): Promise<DreamSource> {
  const { data } = await pRetry(
    () =>
      backend.get<ApiResponse<{ dream: DreamSource }>>(`/dream/${dreamUuid}`, {
        headers: { 'User-Agent': 'EdreamSDK' },
      }),
    BACKEND_RETRY
  );
  return data.data.dream;
}

async function setDreamProcessing(dreamUuid: string): Promise<void> {
  await pRetry(() => backend.post(`/dream/${dreamUuid}/status/processing`), BACKEND_RETRY);
}

async function setDreamProcessed(dreamUuid: string, image: NormalizedImage): Promise<void> {
  await pRetry(
    () =>
      backend.post(`/dream/${dreamUuid}/status/processed`, {
        processedVideoSize: image.size,
        processedMediaWidth: image.width,
        processedMediaHeight: image.height,
        md5: image.md5,
        mediaType: 'image',
      }),
    BACKEND_RETRY
  );
}

function objectKeyFromSignedUrl(url: string): string | null {
  try {
    const { pathname } = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return decodeURIComponent(pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

async function readOriginalImage(url: string): Promise<Buffer> {
  const key = objectKeyFromSignedUrl(url);
  const buffer = key ? await getR2Object(key, MAX_IMAGE_INPUT_BYTES).catch(() => null) : null;
  if (!buffer) {
    throw new UnsupportedLocalImageError(`Original image is not readable from R2: ${key ?? url}`);
  }
  return buffer;
}

async function uploadProcessedImage(dreamUuid: string, buffer: Buffer): Promise<void> {
  const file = { type: 'dream', extension: WEBP_EXTENSION, processed: true } as const;
  const { data } = await backend.post<ApiResponse<MultipartUpload>>(`/dream/${dreamUuid}/create-multipart-upload`, {
    ...file,
    parts: 1,
  });
  const { urls, uploadId } = data.data;
  const [uploadUrl] = urls;
  if (!uploadUrl) throw new Error(`No upload URL returned for dream ${dreamUuid}`);

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    body: buffer,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const etag = upload.headers.get('etag');
  if (!upload.ok || !etag) {
    throw new Error(`Failed to upload processed image: ${upload.status} ${upload.statusText}`);
  }

  await backend.post(`/dream/${dreamUuid}/complete-multipart-upload`, {
    ...file,
    uploadId,
    parts: [{ PartNumber: 1, ETag: etag }],
  });
}

export async function ingestImageLocally(job: Job<VideoIngestJobData>): Promise<ImageIngestResult> {
  const dreamUuid = job.data.dream_uuid;

  await reportProgress(job, 'IN_PROGRESS', 0);

  const [{ original_video: originalUrl }] = await Promise.all([
    getDreamSource(dreamUuid),
    setDreamProcessing(dreamUuid),
  ]);
  if (!originalUrl) throw new Error(`Dream ${dreamUuid} has no original image`);

  const image = await runImageTask(async () => normalizeImage(await readOriginalImage(originalUrl), 'dream'));

  await reportProgress(job, 'IN_PROGRESS', 50);
  await uploadProcessedImage(dreamUuid, image.buffer);
  await setDreamProcessed(dreamUuid, image);
  await reportProgress(job, 'COMPLETED', 100);

  return { status: 'success', type: 'image', dream_uuid: dreamUuid };
}
