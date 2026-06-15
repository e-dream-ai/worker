import { Job } from 'bullmq';
import { VideoServiceClient } from './video-service.client.js';
import { handleOpenAiJob } from './openai-handler.service.js';
import { handleFalJob } from './fal-handler.service.js';

const videoServiceClient = new VideoServiceClient();

export async function handleUserEndpointJob(job: Job): Promise<any> {
  const {
    dream_uuid,
    userEndpointDecryptedKey,
    userEndpointUrl,
    userEndpointProvider,
    userEndpointModelId,
    prompt,
    image,
    size,
    n,
  } = job.data;

  // Validate required fields
  if (!dream_uuid) {
    throw new Error('[UserEndpoint] dream_uuid is required');
  }
  if (!userEndpointDecryptedKey) {
    throw new Error('[UserEndpoint] userEndpointDecryptedKey is required');
  }
  if (!userEndpointUrl) {
    throw new Error('[UserEndpoint] userEndpointUrl is required');
  }
  if (!userEndpointProvider) {
    throw new Error('[UserEndpoint] userEndpointProvider is required');
  }
  if (!prompt) {
    throw new Error('[UserEndpoint] prompt is required');
  }

  await job.log(
    `${new Date().toISOString()}: [UserEndpoint] Starting job for dream=${dream_uuid} provider=${userEndpointProvider}`
  );

  const adapterParams = {
    endpointUrl: userEndpointUrl,
    apiKey: userEndpointDecryptedKey,
    modelId: userEndpointModelId,
    prompt,
    image,
    size,
    n,
  };

  let r2Urls: string[];
  let renderDuration: number;

  if (userEndpointProvider === 'openai') {
    const result = await handleOpenAiJob(job, adapterParams);
    r2Urls = result.r2Urls;
    renderDuration = result.renderDuration;
  } else if (userEndpointProvider === 'fal') {
    const result = await handleFalJob(job, adapterParams);
    r2Urls = result.r2Urls;
    renderDuration = result.renderDuration;
  } else {
    throw new Error(`[UserEndpoint] Unknown provider: ${userEndpointProvider}`);
  }

  if (r2Urls.length === 0) {
    throw new Error('[UserEndpoint] No images produced by adapter');
  }

  await job.log(`${new Date().toISOString()}: [UserEndpoint] Updating dream ${dream_uuid} with result`);
  // uploadGeneratedImage catches internally and returns a boolean (it does NOT throw).
  // Here the attach IS the deliverable, so a false return must fail the job — otherwise the
  // dream is marked completed with no image and never flagged failed.
  const ok = await videoServiceClient.uploadGeneratedImage(dream_uuid, r2Urls[0], renderDuration);
  if (!ok) {
    throw new Error(`[UserEndpoint] Failed to attach generated image to dream ${dream_uuid}`);
  }

  await job.log(`${new Date().toISOString()}: [UserEndpoint] Done`);
  return { r2Urls, renderDuration };
}
