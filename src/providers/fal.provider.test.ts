import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getModelConfig } from '../config/models.config.js';
import { buildKontextInput, falImageProvider, nearestKreaAspectRatio } from './fal.provider.js';

const { submit, status, result } = vi.hoisted(() => ({ submit: vi.fn(), status: vi.fn(), result: vi.fn() }));

vi.mock('@fal-ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fal-ai/client')>()),
  createFalClient: () => ({ queue: { submit, status, result } }),
}));

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ request_id: 'request-1' });
  status.mockReset();
  status.mockResolvedValue({ status: 'COMPLETED' });
  result.mockReset();
});

describe('fal image polling', () => {
  test('returns the expanded prompt Krea Turbo used', async () => {
    result.mockResolvedValue({
      data: { images: [{ url: 'https://fal/1.png' }], prompt: 'a cat', actual_prompt: 'a sleek tabby cat at dusk' },
    });
    await expect(falImageProvider.pollImage('fal-ai/krea-2/turbo', 'request-1', 'test-key')).resolves.toMatchObject({
      completed: true,
      imageUrls: ['https://fal/1.png'],
      actualPrompt: 'a sleek tabby cat at dusk',
    });
  });

  test.each([null, '', '  ', undefined])('leaves actualPrompt unset when fal returns %j', async (actualPrompt) => {
    result.mockResolvedValue({ data: { images: [{ url: 'https://fal/1.png' }], actual_prompt: actualPrompt } });
    const poll = await falImageProvider.pollImage('fal-ai/krea-2/turbo', 'request-1', 'test-key');
    expect(poll.imageUrls).toEqual(['https://fal/1.png']);
    expect(poll.actualPrompt).toBeUndefined();
  });

  test('still fails a completed request with no image', async () => {
    result.mockResolvedValue({ data: { images: [], actual_prompt: 'a tabby' } });
    await expect(falImageProvider.pollImage('fal-ai/krea-2/turbo', 'request-1', 'test-key')).rejects.toThrow(
      /no image url/
    );
  });
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

  test.each([true, false])('passes Krea prompt expansion through when set (%s)', async (promptExpansion) => {
    await falImageProvider.submitImage('fal-ai/krea-2/turbo', { prompt: 'glowing', promptExpansion }, 'test-key');
    expect(submit).toHaveBeenCalledWith('fal-ai/krea-2/turbo', {
      input: { prompt: 'glowing', num_images: 1, enable_prompt_expansion: promptExpansion },
    });
  });

  test('submits Krea Style with style scale and prompt expansion', async () => {
    await falImageProvider.submitImage(
      'fal-ai/krea-2/turbo/style',
      { prompt: 'glowing', imageUrl: 'https://r2/style.png', styleScale: 2.5, promptExpansion: true },
      'test-key'
    );
    expect(submit).toHaveBeenCalledWith('fal-ai/krea-2/turbo/style', {
      input: {
        prompt: 'glowing',
        num_images: 1,
        enable_prompt_expansion: true,
        reference_image_urls: ['https://r2/style.png'],
        style_scale: 2.5,
      },
    });
  });

  test.each([-0.1, 4.1, Number.NaN])('rejects Krea style scale %s before submitting', async (styleScale) => {
    await expect(
      falImageProvider.submitImage(
        'fal-ai/krea-2/turbo/style',
        { prompt: 'glowing', imageUrl: 'https://r2/style.png', styleScale },
        'test-key'
      )
    ).rejects.toThrow(/style_scale/);
    expect(submit).not.toHaveBeenCalled();
  });

  test('ignores style scale on plain Krea Turbo', async () => {
    await falImageProvider.submitImage('fal-ai/krea-2/turbo', { prompt: 'glowing', styleScale: 2 }, 'test-key');
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

  test('submits Krea 2 Large with an aspect ratio, seed and creativity, without Turbo-only fields', async () => {
    const model = getModelConfig('krea-2-large');
    const result = await falImageProvider.submitImage(
      model.endpoint,
      {
        prompt: 'glowing',
        width: 1280,
        height: 720,
        seed: 7,
        creativity: 'high',
        numImages: 1,
        numInferenceSteps: 4,
        promptExpansion: true,
        styleScale: 2,
      },
      'test-key'
    );

    const input = { prompt: 'glowing', aspect_ratio: '16:9', seed: 7, creativity: 'high' };
    expect(submit).toHaveBeenCalledWith('krea/v2/large/text-to-image', { input });
    expect(result).toEqual({ requestId: 'request-1', submittedInput: input });
  });

  test('leaves Krea 2 Large aspect ratio, seed and creativity to fal when unset', async () => {
    await falImageProvider.submitImage('krea/v2/large/text-to-image', { prompt: 'glowing', seed: -1 }, 'test-key');
    expect(submit).toHaveBeenCalledWith('krea/v2/large/text-to-image', { input: { prompt: 'glowing' } });
  });

  test.each(['', 'extreme', 'High'])('rejects Krea 2 Large creativity %j before submitting', async (creativity) => {
    await expect(
      falImageProvider.submitImage('krea/v2/large/text-to-image', { prompt: 'glowing', creativity }, 'test-key')
    ).rejects.toThrow(/creativity/);
    expect(submit).not.toHaveBeenCalled();
  });

  test.each([
    [1024, 1024, '1:1'],
    [1024, 768, '4:3'],
    [1152, 768, '3:2'],
    [1280, 720, '16:9'],
    [1280, 544, '2.35:1'],
    [1024, 1280, '4:5'],
    [768, 1152, '2:3'],
    [720, 1280, '9:16'],
    [768, 1024, '4:5'],
    [512, 512, '1:1'],
    [3000, 1000, '2.35:1'],
  ])('maps %ix%i to Krea aspect ratio %s', (width, height, ratio) => {
    expect(nearestKreaAspectRatio(width, height)).toBe(ratio);
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
