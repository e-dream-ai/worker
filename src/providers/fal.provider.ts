import { createFalClient, ValidationError, type FalClient } from '@fal-ai/client';
import {
  ImageProvider,
  NormalizedImageInput,
  NormalizedVideoInput,
  ProviderImagePollResult,
  ProviderLogEntry,
  ProviderPollResult,
  ProviderStatus,
  ProviderSubmitResult,
  VideoProvider,
} from './provider.types.js';

const clientsByKey = new Map<string, FalClient>();

async function withFalErrorDetail<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof ValidationError && error.body) {
      const fields = error.fieldErrors;
      const detail = fields
        .filter(({ msg }) => msg.trim())
        .map(({ loc, msg }) => {
          const field = (loc[0] === 'body' ? loc.slice(1) : loc).join('.');
          return field ? `${field}: ${msg.trim()}` : msg.trim();
        })
        .join('; ');

      if (detail) {
        const message = `fal rejected this request (HTTP ${error.status}): ${detail}`;
        error.message = fields.some(({ type }) => type === 'content_policy_violation')
          ? `The model's content filter rejected this prompt or image. Try rephrasing the prompt or using a different image. ${message}`
          : message;
      }
    }
    throw error;
  }
}

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
  const { request_id } = await withFalErrorDetail(() => client.queue.submit(endpoint, { input }));
  return { requestId: request_id, submittedInput: input };
}

async function resultFromFal<T>(
  endpoint: string,
  requestId: string,
  apiKey: string,
  extract: (data: unknown) => T | undefined
): Promise<{ status: ProviderStatus; completed: boolean; result?: T; logs?: ProviderLogEntry[] }> {
  const client = getClient(apiKey);
  const queueStatus = await withFalErrorDetail(() => client.queue.status(endpoint, { requestId, logs: true }));
  const { status } = queueStatus;
  const logs =
    'logs' in queueStatus && Array.isArray(queueStatus.logs)
      ? queueStatus.logs.map(({ message, level, timestamp }) => ({ message, level, timestamp }))
      : undefined;
  if (status !== 'COMPLETED') {
    return { status, completed: false, logs };
  }
  const { data } = await withFalErrorDetail(() => client.queue.result(endpoint, { requestId }));
  return { status: 'COMPLETED', completed: true, result: extract(data), logs };
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
    const { status, completed, result, logs } = await resultFromFal(
      endpoint,
      requestId,
      apiKey,
      (data) => (data as { video?: { url?: string } })?.video?.url
    );
    if (completed && !result) {
      throw new Error(`fal request ${requestId} completed but returned no video url`);
    }
    return { status, completed, videoUrl: result, logs };
  },

  cancel: cancelFal,
};

const isSeed = (seed: number | undefined): seed is number => seed !== undefined && Number.isInteger(seed) && seed >= 0;

function buildFluxInput(input: NormalizedImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    num_images: input.numImages ?? 1,
  };
  if (typeof input.width === 'number' && typeof input.height === 'number') {
    body.image_size = { width: input.width, height: input.height };
  }
  if (isSeed(input.seed)) {
    body.seed = input.seed;
  }
  if (typeof input.numInferenceSteps === 'number') {
    body.num_inference_steps = input.numInferenceSteps;
  }
  return body;
}

// Image-to-image (FLUX.1 Kontext). The fal Kontext endpoint takes the source
// image as `image_url` and has NO image_size/width/height (the output follows
// the source). Seed is optional; we only forward a real (>= 0) seed.
export function buildKontextInput(input: NormalizedImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    image_url: input.imageUrl,
    num_images: input.numImages ?? 1,
  };
  if (isSeed(input.seed)) {
    body.seed = input.seed;
  }
  return body;
}

function buildKreaInput(input: NormalizedImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    num_images: input.numImages ?? 1,
  };
  if (typeof input.width === 'number' && typeof input.height === 'number') {
    body.image_size = { width: input.width, height: input.height };
  }
  if (isSeed(input.seed)) {
    body.seed = input.seed;
  }
  if (typeof input.promptExpansion === 'boolean') {
    body.enable_prompt_expansion = input.promptExpansion;
  }
  return body;
}

const KREA_STYLE_SCALE_RANGE = { min: 0, max: 4 } as const;

function buildKreaStyleInput(input: NormalizedImageInput): Record<string, unknown> {
  if (!input.imageUrl?.trim()) {
    throw new Error('Krea 2 Turbo Style requires a source image');
  }
  const body: Record<string, unknown> = { ...buildKreaInput(input), reference_image_urls: [input.imageUrl] };
  if (input.styleScale !== undefined) {
    const { min, max } = KREA_STYLE_SCALE_RANGE;
    if (!Number.isFinite(input.styleScale) || input.styleScale < min || input.styleScale > max) {
      throw new Error(`Krea 2 Turbo Style style_scale must be between ${min} and ${max}`);
    }
    body.style_scale = input.styleScale;
  }
  return body;
}

// Krea 2 Large on fal takes one of these aspect ratios instead of a size, picks
// its own resolution, makes one image per request and has no prompt expansion.
const KREA_V2_ASPECT_RATIOS = [
  { name: '1:1', ratio: 1 },
  { name: '4:3', ratio: 4 / 3 },
  { name: '3:2', ratio: 3 / 2 },
  { name: '16:9', ratio: 16 / 9 },
  { name: '2.35:1', ratio: 2.35 },
  { name: '4:5', ratio: 4 / 5 },
  { name: '2:3', ratio: 2 / 3 },
  { name: '9:16', ratio: 9 / 16 },
] as const;

type KreaAspectRatio = (typeof KREA_V2_ASPECT_RATIOS)[number]['name'];

const KREA_V2_CREATIVITY = ['raw', 'low', 'medium', 'high'] as const;

type KreaCreativity = (typeof KREA_V2_CREATIVITY)[number];

type KreaV2Input = {
  prompt: string;
  aspect_ratio?: KreaAspectRatio;
  seed?: number;
  creativity?: KreaCreativity;
};

const isKreaCreativity = (value: string): value is KreaCreativity =>
  (KREA_V2_CREATIVITY as readonly string[]).includes(value);

export function nearestKreaAspectRatio(width: number, height: number): KreaAspectRatio {
  const target = Math.log(width / height);
  const distance = (ratio: number) => Math.abs(Math.log(ratio) - target);
  return KREA_V2_ASPECT_RATIOS.reduce((best, candidate) =>
    distance(candidate.ratio) < distance(best.ratio) ? candidate : best
  ).name;
}

function buildKreaV2Input(input: NormalizedImageInput): KreaV2Input {
  const body: KreaV2Input = { prompt: input.prompt };
  if (typeof input.width === 'number' && typeof input.height === 'number' && input.width > 0 && input.height > 0) {
    body.aspect_ratio = nearestKreaAspectRatio(input.width, input.height);
  }
  if (isSeed(input.seed)) {
    body.seed = input.seed;
  }
  if (input.creativity !== undefined) {
    if (!isKreaCreativity(input.creativity)) {
      throw new Error(`Krea 2 creativity must be one of ${KREA_V2_CREATIVITY.join(', ')}`);
    }
    body.creativity = input.creativity;
  }
  return body;
}

export const falImageProvider: ImageProvider = {
  name: 'fal',

  async submitImage(endpoint, input, apiKey): Promise<ProviderSubmitResult> {
    switch (endpoint) {
      case 'fal-ai/krea-2/turbo':
        return submitToFal(endpoint, buildKreaInput(input), apiKey);
      case 'fal-ai/krea-2/turbo/style':
        return submitToFal(endpoint, buildKreaStyleInput(input), apiKey);
      case 'krea/v2/large/text-to-image':
        return submitToFal(endpoint, buildKreaV2Input(input), apiKey);
      default:
        return submitToFal(endpoint, input.imageUrl ? buildKontextInput(input) : buildFluxInput(input), apiKey);
    }
  },

  async pollImage(endpoint, requestId, apiKey): Promise<ProviderImagePollResult> {
    const { status, completed, result, logs } = await resultFromFal(endpoint, requestId, apiKey, (data) => {
      const urls = ((data as { images?: Array<{ url?: string }> })?.images ?? [])
        .map((image) => image?.url)
        .filter((url): url is string => Boolean(url));
      return urls.length > 0 ? urls : undefined;
    });
    if (completed && !result) {
      throw new Error(`fal request ${requestId} completed but returned no image url`);
    }
    return { status, completed, imageUrls: result, logs };
  },

  cancel: cancelFal,
};
