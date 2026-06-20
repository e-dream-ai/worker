import { createFalClient } from '@fal-ai/client';
import {
  ImageProvider,
  NormalizedImageInput,
  NormalizedVideoInput,
  ProviderImagePollResult,
  ProviderPollResult,
  ProviderStatus,
  ProviderSubmitResult,
  VideoProvider,
} from './provider.types.js';

type FalClient = ReturnType<typeof createFalClient>;

const clientsByKey = new Map<string, FalClient>();

function getClient(apiKey: string): FalClient {
  let client = clientsByKey.get(apiKey);
  if (!client) {
    client = createFalClient({ credentials: apiKey });
    clientsByKey.set(apiKey, client);
  }
  return client;
}

async function submitToFal(
  endpoint: string,
  input: Record<string, unknown>,
  apiKey: string
): Promise<ProviderSubmitResult> {
  const client = getClient(apiKey);
  const { request_id } = await client.queue.submit(endpoint, { input });
  return { requestId: request_id };
}

async function resultFromFal<T>(
  endpoint: string,
  requestId: string,
  apiKey: string,
  extract: (data: unknown) => T | undefined
): Promise<{ status: ProviderStatus; completed: boolean; result?: T }> {
  const client = getClient(apiKey);
  const { status } = await client.queue.status(endpoint, { requestId, logs: false });
  if (status !== 'COMPLETED') {
    return { status, completed: false };
  }
  const { data } = await client.queue.result(endpoint, { requestId });
  return { status: 'COMPLETED', completed: true, result: extract(data) };
}

async function cancelFal(endpoint: string, requestId: string, apiKey: string): Promise<void> {
  const client = getClient(apiKey);
  await client.queue.cancel(endpoint, { requestId });
}

function buildKlingInput(endpoint: string, input: NormalizedVideoInput): Record<string, unknown> {
  const isV3 = endpoint.includes('/v3/');
  const body: Record<string, unknown> = {
    prompt: input.prompt,
  };
  if (isV3) {
    body.start_image_url = input.startImageUrl;
    body.generate_audio = false;
    if (input.endImageUrl) {
      body.end_image_url = input.endImageUrl;
    }
  } else {
    body.image_url = input.startImageUrl;
    if (input.endImageUrl) {
      body.tail_image_url = input.endImageUrl;
    }
  }
  if (typeof input.durationSec === 'number') {
    body.duration = String(Math.round(input.durationSec));
  }
  if (input.negativePrompt) {
    body.negative_prompt = input.negativePrompt;
  }
  if (typeof input.cfgScale === 'number') {
    body.cfg_scale = input.cfgScale;
  }
  return body;
}

export const falVideoProvider: VideoProvider = {
  name: 'fal',

  submit: (endpoint, input, apiKey) => submitToFal(endpoint, buildKlingInput(endpoint, input), apiKey),

  async poll(endpoint, requestId, apiKey): Promise<ProviderPollResult> {
    const { status, completed, result } = await resultFromFal(
      endpoint,
      requestId,
      apiKey,
      (data) => (data as { video?: { url?: string } })?.video?.url
    );
    if (completed && !result) {
      throw new Error(`fal request ${requestId} completed but returned no video url`);
    }
    return { status, completed, videoUrl: result };
  },

  cancel: cancelFal,
};

function buildFluxInput(input: NormalizedImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    num_images: input.numImages ?? 1,
  };
  if (typeof input.width === 'number' && typeof input.height === 'number') {
    body.image_size = { width: input.width, height: input.height };
  }
  if (typeof input.seed === 'number' && input.seed >= 0) {
    body.seed = input.seed;
  }
  if (typeof input.numInferenceSteps === 'number') {
    body.num_inference_steps = input.numInferenceSteps;
  }
  return body;
}

export const falImageProvider: ImageProvider = {
  name: 'fal',

  submitImage: (endpoint, input, apiKey) => submitToFal(endpoint, buildFluxInput(input), apiKey),

  async pollImage(endpoint, requestId, apiKey): Promise<ProviderImagePollResult> {
    const { status, completed, result } = await resultFromFal(endpoint, requestId, apiKey, (data) => {
      const urls = ((data as { images?: Array<{ url?: string }> })?.images ?? [])
        .map((image) => image?.url)
        .filter((url): url is string => Boolean(url));
      return urls.length > 0 ? urls : undefined;
    });
    if (completed && !result) {
      throw new Error(`fal request ${requestId} completed but returned no image url`);
    }
    return { status, completed, imageUrls: result };
  },

  cancel: cancelFal,
};
