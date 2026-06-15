import axios from 'axios';
import https from 'https';
import { Job } from 'bullmq';
import { R2UploadService } from './r2-upload.service.js';
import { assertSafeExternalUrl, SafeAddress } from '../utils/url-safety.js';

/**
 * Build an https.Agent that pins outbound connections to the already-validated
 * IP, closing the DNS-rebinding TOCTOU window. Node merges Agent options into
 * the TLS connect, so SNI and the Host header still use the hostname.
 */
function pinnedAgent(safe: SafeAddress): https.Agent {
  return new https.Agent({
    lookup: (_hostname, _options, callback) => {
      callback(null, safe.address, safe.family);
    },
  });
}

export interface FalJobResult {
  r2Urls: string[];
  renderDuration: number;
}

const r2UploadService = new R2UploadService();

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Per-request timeouts (ms) so a hung provider can't hold a worker slot forever.
// The overall POLL_TIMEOUT_MS still bounds the total polling duration.
const SUBMIT_TIMEOUT_MS = 30000;
const POLL_REQUEST_TIMEOUT_MS = 10000;

/**
 * Parse a size string for FAL's `image_size` field.
 * - "WxH" (e.g. "1024x768") -> { width, height } object
 * - any other non-empty string (e.g. "square_hd", "landscape_16_9") -> passed
 *   through unchanged so FAL can interpret its named/preset sizes.
 */
function parseFalSize(size?: string): { width: number; height: number } | string | undefined {
  if (!size) return undefined;
  const parts = size.toLowerCase().split('x');
  if (parts.length === 2) {
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    if (!isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
  }
  // Not WxH — pass the original string through for FAL's named/preset sizes.
  return size;
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

  // SSRF guard: the endpoint URL is user-controlled; block internal targets before any outbound call.
  // The submit endpoint is a single known host, so we pin the validated IP onto
  // the submit POST below to close the DNS-rebinding TOCTOU window.
  const safeEndpoint = await assertSafeExternalUrl(endpointUrl);
  const submitAgent = pinnedAgent(safeEndpoint);

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
    timeout: SUBMIT_TIMEOUT_MS,
    // Pin the validated submit-host IP and refuse redirects (rebinding/redirect
    // can't escape the pin). NOTE: we only pin the SUBMIT call. The status/result
    // polls below target a DIFFERENT host (queue.fal.run) derived from FAL's
    // response, so pinning the submit IP onto them would be wrong — we
    // re-validate those URLs separately instead.
    httpsAgent: submitAgent,
    maxRedirects: 0,
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

      // The poll host (queue.fal.run) comes from FAL's response and may differ
      // from the submit host, so we re-validate it each time rather than pinning
      // the submit IP. We do NOT pin here: these are fal-controlled hosts and we
      // let them resolve normally; re-validating is cheap and blocks the obvious
      // internal-target hole if a response ever pointed us somewhere unsafe.
      await assertSafeExternalUrl(statusUrl);
      const statusRes = await axios.get(statusUrl, {
        headers: { Authorization: `Key ${apiKey}` },
        timeout: POLL_REQUEST_TIMEOUT_MS,
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
    // Same asymmetry as the status poll: re-validate the fal-controlled result
    // host, but do NOT pin (different host from the pinned submit endpoint).
    await assertSafeExternalUrl(resultUrl);
    const resultRes = await axios.get(resultUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      timeout: POLL_REQUEST_TIMEOUT_MS,
    });

    // Different FAL apps return images at different paths; fall back so a
    // differently-shaped result doesn't silently yield zero images.
    images = resultRes.data?.images ?? resultRes.data?.output?.images ?? [];
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
