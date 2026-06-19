import { createFalClient } from '@fal-ai/client';
import { NormalizedVideoInput, ProviderPollResult, ProviderSubmitResult, VideoProvider } from './provider.types.js';

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

function buildKlingInput(input: NormalizedVideoInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    start_image_url: input.startImageUrl,
    generate_audio: false,
  };
  if (typeof input.durationSec === 'number') {
    body.duration = String(Math.round(input.durationSec));
  }
  if (input.endImageUrl) {
    body.end_image_url = input.endImageUrl;
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

  async submit(endpoint, input, apiKey): Promise<ProviderSubmitResult> {
    const client = getClient(apiKey);
    const { request_id } = await client.queue.submit(endpoint, {
      input: buildKlingInput(input),
    });
    return { requestId: request_id };
  },

  async poll(endpoint, requestId, apiKey): Promise<ProviderPollResult> {
    const client = getClient(apiKey);
    const { status } = await client.queue.status(endpoint, { requestId, logs: false });

    if (status !== 'COMPLETED') {
      return { status, completed: false };
    }

    const { data } = (await client.queue.result(endpoint, { requestId })) as {
      data?: { video?: { url?: string } };
    };
    const videoUrl = data?.video?.url;
    if (!videoUrl) {
      throw new Error(`fal request ${requestId} completed but returned no video url`);
    }

    return {
      status: 'COMPLETED',
      completed: true,
      videoUrl,
    };
  },

  async cancel(endpoint, requestId, apiKey): Promise<void> {
    const client = getClient(apiKey);
    await client.queue.cancel(endpoint, { requestId });
  },
};
