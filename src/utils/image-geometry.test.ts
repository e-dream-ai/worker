import { describe, expect, test } from 'vitest';
import { formatTarget, isTransformableUrl, pickTarget, sameTarget, withGeometry } from './image-geometry';

const KLING = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
  { width: 1080, height: 1080 },
] as const;

const SIGNED = 'https://edream-worker-alpha.infinidream.ai/u/d/d.png?sig=abc';

describe('pickTarget', () => {
  test('snaps the keyframes from frontend#733 to 1080p', () => {
    // 2944x1648 is Midjourney v8.2's --ar 16:9 raster, 0.48% off true 16:9.
    expect(pickTarget(2944, 1648, KLING)).toEqual({ width: 1920, height: 1080 });
  });

  test('picks by aspect ratio, not by size', () => {
    expect(pickTarget(3840, 2160, KLING)).toEqual({ width: 1920, height: 1080 });
    expect(pickTarget(720, 1280, KLING)).toEqual({ width: 1080, height: 1920 });
    expect(pickTarget(512, 512, KLING)).toEqual({ width: 1080, height: 1080 });
  });

  test('treats 2:1 and 1:2 as equidistant from square', () => {
    expect(pickTarget(2000, 1000, KLING)).toEqual({ width: 1920, height: 1080 });
    expect(pickTarget(1000, 2000, KLING)).toEqual({ width: 1080, height: 1920 });
  });

  test('returns nothing it cannot choose from', () => {
    expect(pickTarget(1920, 1080, [])).toBeUndefined();
    expect(pickTarget(0, 1080, KLING)).toBeUndefined();
    expect(pickTarget(1920, -1, KLING)).toBeUndefined();
  });
});

describe('withGeometry', () => {
  test('adds the transform params and keeps the signature', () => {
    const url = new URL(withGeometry(SIGNED, { width: 1920, height: 1080 }));
    expect(url.searchParams.get('sig')).toBe('abc');
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
  test('accepts our signed CDN urls and nothing else', () => {
    expect(isTransformableUrl(SIGNED)).toBe(true);
    expect(isTransformableUrl('https://example.com/someone-elses.png')).toBe(false);
    expect(isTransformableUrl('not a url')).toBe(false);
    expect(isTransformableUrl('iVBORw0KGgoAAAANSUhEUg==')).toBe(false);
  });
});

describe('sameTarget', () => {
  test('compares both dimensions', () => {
    expect(sameTarget({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(true);
    expect(sameTarget({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })).toBe(false);
    expect(formatTarget({ width: 1920, height: 1080 })).toBe('1920x1080');
  });
});
