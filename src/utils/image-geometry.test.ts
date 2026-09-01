import { describe, expect, test } from 'vitest';
import { WORKER_MODELS } from '../config/models.config';
import { formatSize, isTransformableUrl, pickTarget, sameSize, withGeometry } from './image-geometry';

const kling = WORKER_MODELS['kling-i2v'];
if (kling.mediaType !== 'video' || !kling.inputGeometry) {
  throw new Error('kling-i2v is expected to be a video model declaring inputGeometry');
}
const KLING = kling.inputGeometry;

const SIG = 'a'.repeat(64);
const SIGNED = `https://edream-worker-alpha.infinidream.ai/u/d/d.png?sig=${SIG}`;

describe('pickTarget', () => {
  test('snaps the keyframes from frontend#733 to 1080p', () => {
    // 2944x1648 is Midjourney v8.2's --ar 16:9 raster, 0.48% off true 16:9.
    expect(pickTarget({ width: 2944, height: 1648 }, KLING)).toEqual({ width: 1920, height: 1080 });
  });

  test('picks by aspect ratio, not by size', () => {
    expect(pickTarget({ width: 3840, height: 2160 }, KLING)).toEqual({ width: 1920, height: 1080 });
    expect(pickTarget({ width: 720, height: 1280 }, KLING)).toEqual({ width: 1080, height: 1920 });
    expect(pickTarget({ width: 512, height: 512 }, KLING)).toEqual({ width: 1080, height: 1080 });
  });

  test('measures distance in log space, so 2:1 and 1:2 are symmetric about square', () => {
    expect(pickTarget({ width: 2000, height: 1000 }, KLING)).toEqual({ width: 1920, height: 1080 });
    expect(pickTarget({ width: 1000, height: 2000 }, KLING)).toEqual({ width: 1080, height: 1920 });
  });

  test('returns nothing for a source it cannot measure', () => {
    expect(pickTarget({ width: 0, height: 1080 }, KLING)).toBeUndefined();
    expect(pickTarget({ width: 1920, height: -1 }, KLING)).toBeUndefined();
    expect(pickTarget({ width: NaN, height: 1080 }, KLING)).toBeUndefined();
    expect(pickTarget({ width: Infinity, height: 1080 }, KLING)).toBeUndefined();
  });

  test('snaps to the nearest candidate even when nothing is close', () => {
    expect(pickTarget({ width: 1600, height: 1200 }, KLING)).toEqual({ width: 1080, height: 1080 });
  });
});

describe('withGeometry', () => {
  test('adds the transform params and keeps the signature', () => {
    const url = new URL(withGeometry(SIGNED, { width: 1920, height: 1080 }));
    expect(url.searchParams.get('sig')).toBe(SIG);
    expect(url.searchParams.get('w')).toBe('1920');
    expect(url.searchParams.get('h')).toBe('1080');
    // cover is what guarantees exactly the requested size
    expect(url.searchParams.get('fit')).toBe('cover');
    // Cloudflare cannot emit png; format=png silently returns jpeg
    expect(url.searchParams.get('format')).toBe('jpeg');
    expect(url.searchParams.get('q')).toBe('95');
  });

  test('overwrites params instead of appending duplicates', () => {
    const once = withGeometry(SIGNED, { width: 1920, height: 1080 });
    const twice = withGeometry(once, { width: 1080, height: 1080 });
    expect(new URL(twice).searchParams.getAll('w')).toEqual(['1080']);
  });
});

describe('isTransformableUrl', () => {
  test('accepts a url carrying a sha256 hex signature', () => {
    expect(isTransformableUrl(SIGNED)).toBe(true);
  });

  test('rejects anything without a well-formed signature', () => {
    expect(isTransformableUrl('https://example.com/someone-elses.png')).toBe(false);
    expect(isTransformableUrl('https://example.com/x.png?sig=abc')).toBe(false);
    expect(isTransformableUrl(`https://example.com/x.png?sig=${'A'.repeat(64)}`)).toBe(false);
    expect(isTransformableUrl('not a url')).toBe(false);
    expect(isTransformableUrl('iVBORw0KGgoAAAANSUhEUg==')).toBe(false);
  });

  test('recognizes the signature shape, not the origin — a foreign host still passes', () => {
    expect(isTransformableUrl(`https://not-ours.example.com/x.png?sig=${SIG}`)).toBe(true);
  });
});

describe('sameSize', () => {
  test('compares both dimensions', () => {
    expect(sameSize({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(true);
    expect(sameSize({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })).toBe(false);
    expect(sameSize({ width: 1920, height: 1080 }, { width: 1920, height: 1081 })).toBe(false);
  });
});

describe('formatSize', () => {
  test('renders WxH', () => {
    expect(formatSize({ width: 1920, height: 1080 })).toBe('1920x1080');
  });
});
