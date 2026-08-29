import { describe, expect, test } from 'vitest';
import { buildKlingInput, buildKontextInput } from './fal.provider';

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

describe('buildKlingInput', () => {
  const base = { prompt: 'a cat', startImageUrl: 'https://r2/start.png', durationSec: 5 };

  test('v2.5 takes the pair as image_url + tail_image_url', () => {
    const body = buildKlingInput('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', {
      ...base,
      endImageUrl: 'https://r2/end.png',
    });
    expect(body.image_url).toBe('https://r2/start.png');
    expect(body.tail_image_url).toBe('https://r2/end.png');
    expect(body.duration).toBe('5');
  });

  test('v3 takes the pair as start_image_url + end_image_url', () => {
    const body = buildKlingInput('fal-ai/kling-video/v3/pro/image-to-video', {
      ...base,
      endImageUrl: 'https://r2/end.png',
    });
    expect(body.start_image_url).toBe('https://r2/start.png');
    expect(body.end_image_url).toBe('https://r2/end.png');
    expect(body.generate_audio).toBe(false);
    expect(body).not.toHaveProperty('tail_image_url');
  });

  test('omits the tail entirely when there is no end frame', () => {
    const body = buildKlingInput('fal-ai/kling-video/v2.5-turbo/pro/image-to-video', base);
    expect(body).not.toHaveProperty('tail_image_url');
    expect(body).not.toHaveProperty('end_image_url');
  });
});
