import { Job, Queue } from 'bullmq';
import { getModelConfig } from '../config/models.config.js';
import { getProvider } from '../providers/index.js';
import { resolveProviderKey } from '../providers/key-resolver.js';
import { NormalizedVideoInput, ProviderPollResult, VideoProvider } from '../providers/provider.types.js';
import { VideoServiceClient } from '../services/video-service.client.js';
import { processImageForEndpoint } from './job-handlers.js';
import redisClient from '../shared/redis.js';

const videoServiceClient = new VideoServiceClient();

const POLL_INTERVAL_MS = 5000;

export async function handleFalVideoJob(job: Job): Promise<unknown> {
  const {
    prompt,
    source_dream_uuid: image,
    end_source_uuid: endImage,
    negative_prompt,
    duration,
    cfg_scale,
    infinidream_algorithm,
    dream_uuid,
    auto_upload = true,
  } = job.data;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required and must be a string');
  }
  if (!image || typeof image !== 'string') {
    throw new Error('source_dream_uuid is required (URL or dream UUID of the start frame)');
  }

  const modelConfig = getModelConfig(infinidream_algorithm);
  const provider = getProvider(modelConfig.provider);
  const apiKey = resolveProviderKey(modelConfig.provider, job);

  const [startImageUrl, endImageUrl] = await Promise.all([
    processImageForEndpoint(image, String(job.id)),
    endImage && typeof endImage === 'string'
      ? processImageForEndpoint(endImage, String(job.id))
      : Promise.resolve(undefined),
  ]);

  const durationSec = typeof duration === 'number' ? Math.round(duration) : modelConfig.defaultDurationSec;
  const isValidDuration = modelConfig.allowedDurationsSec
    ? modelConfig.allowedDurationsSec.includes(durationSec)
    : durationSec >= modelConfig.minDurationSec && durationSec <= modelConfig.maxDurationSec;
  if (!isValidDuration) {
    const allowed = modelConfig.allowedDurationsSec
      ? modelConfig.allowedDurationsSec.join(', ')
      : `${modelConfig.minDurationSec}-${modelConfig.maxDurationSec}`;
    throw new Error(`duration ${durationSec}s is invalid for ${infinidream_algorithm} (allowed: ${allowed}s)`);
  }

  const input: NormalizedVideoInput = {
    prompt,
    startImageUrl,
    endImageUrl,
    durationSec,
    negativePrompt: typeof negative_prompt === 'string' ? negative_prompt : undefined,
    cfgScale: typeof cfg_scale === 'number' ? cfg_scale : undefined,
  };

  const startedAt = Date.now();
  const { requestId } = await provider.submit(modelConfig.endpoint, input, apiKey);
  await job.updateData({ ...job.data, fal_request_id: requestId });
  await job.log(`${new Date().toISOString()}: Submitted to fal (${modelConfig.endpoint}), request ${requestId}`);

  const final = await pollUntilComplete(job, provider, modelConfig.endpoint, requestId, apiKey);
  const renderDurationMs = final.renderDurationMs ?? Date.now() - startedAt;

  if (!final.videoUrl) {
    throw new Error(`fal request ${requestId} finished without a video url`);
  }

  if (dream_uuid && auto_upload !== false) {
    await videoServiceClient.uploadGeneratedVideo(dream_uuid, final.videoUrl, renderDurationMs);
  }

  return { status: 'COMPLETED', video_url: final.videoUrl, render_duration: renderDurationMs };
}

async function pollUntilComplete(
  job: Job,
  provider: VideoProvider,
  endpoint: string,
  requestId: string,
  apiKey: string
): Promise<ProviderPollResult> {
  let lastStatus = '';

  for (;;) {
    if (await isCancelledByUser(job)) {
      await job.log(`${new Date().toISOString()}: Job cancelled by user, cancelling fal request ${requestId}`);
      if (provider.cancel) {
        try {
          await provider.cancel(endpoint, requestId, apiKey);
        } catch (error: unknown) {
          console.error(`Failed to cancel fal request ${requestId}:`, error);
        }
      }
      throw new Error('Job was cancelled by user');
    }

    const result = await provider.poll(endpoint, requestId, apiKey);

    await job.updateProgress({
      status: result.status,
      completed: result.completed,
      dream_uuid: job.data.dream_uuid,
      user_id: job.data.user_id,
    });

    if (result.status !== lastStatus) {
      lastStatus = result.status;
      await job.log(`${new Date().toISOString()}: fal status ${result.status}`);
    }

    if (result.completed) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function isCancelledByUser(job: Job): Promise<boolean> {
  if (job.data?.cancelled_by_user === true) {
    return true;
  }
  try {
    const state = await job.getState();
    if (state !== 'failed') {
      return false;
    }
    const queue = new Queue(job.queueName, { connection: redisClient });
    const freshJob = await queue.getJob(String(job.id));
    await queue.close();
    return freshJob?.data?.cancelled_by_user === true;
  } catch {
    return false;
  }
}
