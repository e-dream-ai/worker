import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';

/**
 * The clip's final frame, as PNG bytes.
 *
 * `-sseof -0.1` seeks to the last tenth of a second and `-update 1` keeps
 * overwriting the single output file, so what lands on disk is the last frame
 * actually decoded — more reliable than seeking to `duration`, which lands past
 * the end on some encodes and yields nothing.
 */
export async function extractFinalFrame(videoBytes: Buffer): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary unavailable (ffmpeg-static resolved to null)');
  }

  const dir = await mkdtemp(join(tmpdir(), 'tailframe-'));
  const input = join(dir, 'clip.mp4');
  const output = join(dir, 'frame.png');

  try {
    await writeFile(input, videoBytes);
    await runFfmpeg(ffmpegPath, [
      '-v',
      'error',
      '-sseof',
      '-0.1',
      '-i',
      input,
      '-update',
      '1',
      '-frames:v',
      '1',
      '-y',
      output,
    ]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk).slice(0, 2000);
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
    );
  });
}

export async function downloadBytes(url: string): Promise<Buffer> {
  const { fetch } = await import('undici');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
