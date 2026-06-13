import axios from 'axios';
import { Job } from 'bullmq';
import { R2UploadService } from './r2-upload.service.js';

export interface FalJobResult {
  r2Urls: string[];
  renderDuration: number;
}

const r2UploadService = new R2UploadService();

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function parseFalSize(size?: string): { width: number; height: number } | undefined {
  if (!size) return undefined;
  const parts = size.toLowerCase().split('x');
  if (parts.length === 2) {
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    if (!isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
  }
  return undefined;
}

export async function handleFalJob(
  job: Job,
  params: {
    endpointUrl: string;
    apiKey: string;
    modelId?: string;
    prompt: string;
    image?: string;
    size?: string;
    n?: number;
  }
): Promise<FalJobResult> {
  const { endpointUrl, apiKey, prompt, image, size, n = 1 } = params;
  const jobId = String(job.id);
  const startMs = Date.now();

  await job.log(`${new Date().toISOString()}: [FAL] Starting request to ${endpointUrl}`);
  await job.updateProgress({ status: 'IN_PROGRESS', progress: 5, dream_uuid: job.data.dream_uuid });

  const body: Record<string, unknown> = {
    prompt,
    num_images: n,
  };

  const parsedSize = parseFalSize(size);
  if (parsedSize) {
    body.image_size = parsedSize;
  }

  if (image) {
    body.image_url = image;
  }

  await job.log(`${new Date().toISOString()}: [FAL] Submitting request`);
  const submitRes = await axios.post(endpointUrl, body, {
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  const submitData = submitRes.data;

  let images: any[];

  if (submitData?.images && Array.isArray(submitData.images)) {
    // Synchronous response — images returned immediately
    await job.log(`${new Date().toISOString()}: [FAL] Synchronous response received`);
    images = submitData.images;
  } else if (submitData?.request_id) {
    // Async response — poll queue.fal.run
    const requestId: string = submitData.request_id;

    // Extract app path from endpoint URL pathname
    const endpointUrlObj = new URL(endpointUrl);
    const appPath = endpointUrlObj.pathname.replace(/^\//, '');

    const statusUrl = `https://queue.fal.run/${appPath}/requests/${requestId}/status`;
    const resultUrl = `https://queue.fal.run/${appPath}/requests/${requestId}`;

    await job.log(`${new Date().toISOString()}: [FAL] Async job, request_id=${requestId}. Polling ${statusUrl}`);

    let completed = false;
    let lastProgress = 10;

    while (!completed) {
      if (Date.now() - startMs > POLL_TIMEOUT_MS) {
        throw new Error(`[FAL] Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for request ${requestId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const statusRes = await axios.get(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      });

      const statusData = statusRes.data;
      const falStatus: string = statusData?.status ?? '';

      await job.log(`${new Date().toISOString()}: [FAL] Poll status=${falStatus}`);

      if (falStatus === 'FAILED') {
        throw new Error(`[FAL] Job failed: ${JSON.stringify(statusData)}`);
      }

      if (falStatus === 'COMPLETED') {
        completed = true;
      } else {
        // Map FAL queue position/progress to 0-90 range
        const queuePosition: number | undefined = statusData?.queue_position;
        if (typeof queuePosition === 'number' && queuePosition >= 0) {
          // Rough progress: the lower the queue position, the closer we are
          lastProgress = Math.min(85, 10 + Math.max(0, (10 - queuePosition) * 7));
        } else {
          lastProgress = Math.min(85, lastProgress + 5);
        }
        await job.updateProgress({ status: 'IN_PROGRESS', progress: lastProgress, dream_uuid: job.data.dream_uuid });
      }
    }

    await job.log(`${new Date().toISOString()}: [FAL] Fetching result from ${resultUrl}`);
    const resultRes = await axios.get(resultUrl, {
      headers: { Authorization: `Key ${apiKey}` },
    });

    images = resultRes.data?.images ?? [];
  } else {
    throw new Error(`[FAL] Unexpected response: ${JSON.stringify(submitData)}`);
  }

  await job.updateProgress({ status: 'IN_PROGRESS', progress: 70, dream_uuid: job.data.dream_uuid });
  await job.log(`${new Date().toISOString()}: [FAL] Uploading ${images.length} image(s) to R2`);

  const r2Urls: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const imageUrl: string = item?.url ?? item;

    if (!imageUrl || typeof imageUrl !== 'string') {
      await job.log(`${new Date().toISOString()}: [FAL] Skipping result item ${i} — no url`);
      continue;
    }

    const r2Url = await r2UploadService.downloadAndUploadImage(imageUrl, `${jobId}-${i}`);
    r2Urls.push(r2Url);
    await job.log(`${new Date().toISOString()}: [FAL] Uploaded result ${i + 1}/${images.length} to R2`);
  }

  const renderDuration = Date.now() - startMs;
  await job.updateProgress({ status: 'COMPLETED', progress: 100, dream_uuid: job.data.dream_uuid });
  await job.log(`${new Date().toISOString()}: [FAL] Done. ${r2Urls.length} image(s) uploaded in ${renderDuration}ms`);

  return { r2Urls, renderDuration };
}
