import axios from 'axios';
import https from 'https';
import FormData from 'form-data';
import { Job } from 'bullmq';
import { R2UploadService } from './r2-upload.service.js';
import { assertSafeExternalUrl, SafeAddress } from '../utils/url-safety.js';

/**
 * Build an https.Agent that pins outbound connections to the already-validated
 * IP, closing the DNS-rebinding TOCTOU window (validate-then-reconnect). Node
 * merges Agent options into the TLS connect, so SNI and the Host header still
 * use the hostname — only the resolved IP is forced.
 */
function pinnedAgent(safe: SafeAddress): https.Agent {
  return new https.Agent({
    lookup: (_hostname, _options, callback) => {
      // Ignore the requested hostname; always return the IP we validated.
      callback(null, safe.address, safe.family);
    },
  });
}

// Per-request timeouts (ms) so a hung provider can't hold a worker slot forever.
const GENERATION_TIMEOUT_MS = 120000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;

export interface OpenAiJobResult {
  r2Urls: string[];
  renderDuration: number;
}

const r2UploadService = new R2UploadService();

export async function handleOpenAiJob(
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
): Promise<OpenAiJobResult> {
  const { endpointUrl, apiKey, modelId, prompt, image, size, n = 1 } = params;
  const jobId = String(job.id);
  const startMs = Date.now();

  await job.log(`${new Date().toISOString()}: [OpenAI] Starting request to ${endpointUrl}`);

  // SSRF guard: the endpoint URL is user-controlled; block internal targets before any outbound call.
  // The returned address is pinned onto the provider POST below so a rebinding
  // host can't swap in an internal IP between validation and the request.
  const safeEndpoint = await assertSafeExternalUrl(endpointUrl);
  const endpointAgent = pinnedAgent(safeEndpoint);

  await job.updateProgress({ status: 'IN_PROGRESS', progress: 10, dream_uuid: job.data.dream_uuid });

  let responseData: any;

  if (image) {
    // Image-to-image: multipart/form-data POST to /images/edits
    const editsUrl = `${endpointUrl.replace(/\/$/, '')}/images/edits`;
    await job.log(`${new Date().toISOString()}: [OpenAI] Downloading source image for i2i request`);

    // Download the source image as a buffer
    const imgResponse = await axios.get(image, {
      responseType: 'arraybuffer',
      timeout: IMAGE_DOWNLOAD_TIMEOUT_MS,
    });
    const imgBuffer = Buffer.from(imgResponse.data);
    const contentType = (imgResponse.headers['content-type'] as string) || 'image/png';
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';

    const form = new FormData();
    form.append('image', imgBuffer, { filename: `input.${ext}`, contentType });
    form.append('prompt', prompt);
    form.append('n', String(n));
    if (size) {
      form.append('size', size);
    }
    if (modelId) {
      form.append('model', modelId);
    }

    await job.log(`${new Date().toISOString()}: [OpenAI] Submitting i2i (multipart) to ${editsUrl}`);
    const res = await axios.post(editsUrl, form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: GENERATION_TIMEOUT_MS,
      // Pin the validated IP and refuse redirects so the request can't escape
      // the pinned host (a redirect to an internal target would re-resolve).
      httpsAgent: endpointAgent,
      maxRedirects: 0,
    });
    responseData = res.data;
  } else {
    // Text-to-image: JSON POST to /images/generations
    const generationsUrl = `${endpointUrl.replace(/\/$/, '')}/images/generations`;
    const body: Record<string, unknown> = { prompt, n };
    if (size) body.size = size;
    if (modelId) body.model = modelId;

    await job.log(`${new Date().toISOString()}: [OpenAI] Submitting t2i (JSON) to ${generationsUrl}`);
    const res = await axios.post(generationsUrl, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: GENERATION_TIMEOUT_MS,
      // Pin the validated IP and refuse redirects so the request can't escape
      // the pinned host (a redirect to an internal target would re-resolve).
      httpsAgent: endpointAgent,
      maxRedirects: 0,
    });
    responseData = res.data;
  }

  await job.updateProgress({ status: 'IN_PROGRESS', progress: 60, dream_uuid: job.data.dream_uuid });
  await job.log(`${new Date().toISOString()}: [OpenAI] Got response, uploading results to R2`);

  const images: any[] = responseData?.data ?? [];
  const r2Urls: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    let imageUrl: string;

    if (item.b64_json) {
      imageUrl = `data:image/png;base64,${item.b64_json}`;
    } else if (item.url) {
      imageUrl = item.url;
    } else {
      await job.log(`${new Date().toISOString()}: [OpenAI] Skipping result item ${i} — no url or b64_json`);
      continue;
    }

    const r2Url = await r2UploadService.downloadAndUploadImage(imageUrl, `${jobId}-${i}`);
    r2Urls.push(r2Url);
    await job.log(`${new Date().toISOString()}: [OpenAI] Uploaded result ${i + 1}/${images.length} to R2`);
  }

  const renderDuration = Date.now() - startMs;
  await job.updateProgress({ status: 'COMPLETED', progress: 100, dream_uuid: job.data.dream_uuid });
  await job.log(
    `${new Date().toISOString()}: [OpenAI] Done. ${r2Urls.length} image(s) uploaded in ${renderDuration}ms`
  );

  return { r2Urls, renderDuration };
}
