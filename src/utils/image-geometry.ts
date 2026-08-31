/**
 * Input-image geometry normalization for providers that resize the head and
 * tail images of a clip differently.
 *
 * fal's Kling endpoints reproduce `image_url` verbatim but center-crop
 * `tail_image_url` to a 2560px long side. A keyframe used as both the end of
 * clip N and the start of clip N+1 therefore renders at two different framings,
 * and the cut visibly pops. Measured on frontend#733: a 2944x1648 keyframe came
 * back cropped by exactly 2944/2560 = 1.150, dead center, on 10 of 10 clips.
 * frontend#640 was the same bug one model earlier, inside our own ComfyUI graph.
 *
 * Kling is a black box, so instead of correcting the crop we hand it images it
 * will not touch: snapped to a fixed size below the cap, via cf-image-worker's
 * transform params. That worker signs only the object key, so appending these
 * to an already-signed URL costs nothing and needs no new storage.
 */

export interface TargetGeometry {
  width: number;
  height: number;
}

/**
 * Cloudflare Image Resizing cannot emit PNG — `format=png` silently returns
 * JPEG — so the delivered input is always JPEG. Sourced from the lossless
 * original rather than the stored webp, q=95 measures 39.8dB against q=100 at
 * roughly 40% of the bytes, which is well past what the model can resolve.
 */
const OUTPUT_FORMAT = 'jpeg';
const OUTPUT_QUALITY = 95;

/**
 * cf-image-worker applies `w`/`h`/`fit`/`format`/`q` to any request carrying a
 * valid `sig`. Anything else (a third-party URL, a base64 blob, a local path
 * already uploaded elsewhere) has to go through untouched.
 */
export function isTransformableUrl(url: string): boolean {
  try {
    return new URL(url).searchParams.has('sig');
  } catch {
    return false;
  }
}

/**
 * Nearest candidate by aspect ratio. Compared in log space so that 2:1 and 1:2
 * sit the same distance from square rather than 1.0 and 0.5.
 */
export function pickTarget(
  width: number,
  height: number,
  candidates: readonly TargetGeometry[]
): TargetGeometry | undefined {
  if (candidates.length === 0 || !(width > 0) || !(height > 0)) {
    return undefined;
  }
  const sourceAspect = Math.log(width / height);
  const distance = (candidate: TargetGeometry) => Math.abs(Math.log(candidate.width / candidate.height) - sourceAspect);
  return candidates.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
}

export function sameTarget(a: TargetGeometry, b: TargetGeometry): boolean {
  return a.width === b.width && a.height === b.height;
}

export function formatTarget(target: TargetGeometry): string {
  return `${target.width}x${target.height}`;
}

/** Append the transform params. `fit=cover` guarantees exactly the target size. */
export function withGeometry(url: string, target: TargetGeometry): string {
  const parsed = new URL(url);
  parsed.searchParams.set('w', String(target.width));
  parsed.searchParams.set('h', String(target.height));
  parsed.searchParams.set('fit', 'cover');
  parsed.searchParams.set('format', OUTPUT_FORMAT);
  parsed.searchParams.set('q', String(OUTPUT_QUALITY));
  return parsed.toString();
}

/**
 * Ask cf-image-worker for the stored object's dimensions. Only needed when the
 * caller passed a raw URL instead of a dream UUID, since a dream record already
 * carries them.
 */
export async function probeImageSize(url: string): Promise<TargetGeometry | undefined> {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('format', 'json');
    const { fetch } = await import('undici');
    const response = await fetch(parsed.toString());
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { original?: { width?: number; height?: number } };
    const { width, height } = body.original ?? {};
    return width && height ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}
