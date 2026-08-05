import { describe, expect, test } from 'vitest';
import { buildKontextInput } from './fal.provider';

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
