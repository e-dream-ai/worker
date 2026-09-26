import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getModelConfig } from '../config/models.config.js';
import { buildKontextInput, falImageProvider } from './fal.provider.js';

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('@fal-ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fal-ai/client')>()),
  createFalClient: () => ({ queue: { submit } }),
}));

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ request_id: 'request-1' });
});

describe('buildKontextInput', () => {
  test('passes image_url + prompt, defaults num_images, and omits image_size', () => {
    const body = buildKontextInput({
      prompt: 'glowing',
      imageUrl: 'https://r2/x.png',
      seed: 7,
    });
    expect(body).toEqual({
      prompt: 'glowing',
      image_url: 'https://r2/x.png',
      num_images: 1,
      seed: 7,
    });
    expect(body).not.toHaveProperty('image_size');
  });

  test('omits seed when negative or absent', () => {
    expect(buildKontextInput({ prompt: 'x', imageUrl: 'u', seed: -1 })).not.toHaveProperty('seed');
    expect(buildKontextInput({ prompt: 'x', imageUrl: 'u' })).not.toHaveProperty('seed');
  });
});

describe('fal image submission', () => {
  test('submits Krea Turbo with size and seed without FLUX-only inference steps', async () => {
    const model = getModelConfig('krea-2-turbo');
    const result = await falImageProvider.submitImage(
      model.endpoint,
      { prompt: 'glowing', width: 1280, height: 720, seed: 0, numInferenceSteps: 4 },
      'test-key'
    );

    const input = {
      prompt: 'glowing',
      image_size: { width: 1280, height: 720 },
      num_images: 1,
      seed: 0,
    };
    expect(submit).toHaveBeenCalledWith('fal-ai/krea-2/turbo', { input });
    expect(result).toEqual({ requestId: 'request-1', submittedInput: input });
  });

  test('submits Krea Style with a reference image while retaining the requested output size', async () => {
    const model = getModelConfig('krea-2-turbo-style');
    await falImageProvider.submitImage(
      model.endpoint,
      { prompt: 'glowing', imageUrl: 'https://r2/style.png', width: 1024, height: 768, seed: 7, numInferenceSteps: 4 },
      'test-key'
    );

    expect(submit).toHaveBeenCalledWith('fal-ai/krea-2/turbo/style', {
      input: {
        prompt: 'glowing',
        reference_image_urls: ['https://r2/style.png'],
        image_size: { width: 1024, height: 768 },
        num_images: 1,
        seed: 7,
      },
    });
  });

  test.each([undefined, -1])('leaves Krea random seed and image size defaults to fal (seed %s)', async (seed) => {
    await falImageProvider.submitImage('fal-ai/krea-2/turbo', { prompt: 'glowing', seed }, 'test-key');
    expect(submit).toHaveBeenCalledWith('fal-ai/krea-2/turbo', {
      input: { prompt: 'glowing', num_images: 1 },
    });
  });

  test('rejects a missing Krea style reference before submitting', async () => {
    await expect(
      falImageProvider.submitImage('fal-ai/krea-2/turbo/style', { prompt: 'glowing' }, 'test-key')
    ).rejects.toThrow(/reference|source|image/i);
    expect(submit).not.toHaveBeenCalled();
  });

  test('retains FLUX Schnell inference steps', async () => {
    await falImageProvider.submitImage(
      getModelConfig('flux-schnell').endpoint,
      { prompt: 'glowing', width: 1024, height: 768, numInferenceSteps: 4 },
      'test-key'
    );
    expect(submit).toHaveBeenCalledWith('fal-ai/flux-1/schnell', {
      input: { prompt: 'glowing', num_images: 1, image_size: { width: 1024, height: 768 }, num_inference_steps: 4 },
    });
  });

  test('retains Kontext image_url mapping without an output size', async () => {
    await falImageProvider.submitImage(
      getModelConfig('flux-kontext-i2i').endpoint,
      { prompt: 'glowing', imageUrl: 'https://r2/source.png', width: 1024, height: 768, seed: 7 },
      'test-key'
    );
    expect(submit).toHaveBeenCalledWith('fal-ai/flux-pro/kontext', {
      input: { prompt: 'glowing', image_url: 'https://r2/source.png', num_images: 1, seed: 7 },
    });
  });
});
