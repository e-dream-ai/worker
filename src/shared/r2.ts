import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import env from './env.js';

const R2_REQUEST_TIMEOUT_MS = 30_000;

let client: S3Client | undefined;

function getR2Client(): S3Client {
  if (!env.R2_ENDPOINT_URL || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    throw new Error('R2 is not configured');
  }

  client ??= new S3Client({
    endpoint: env.R2_ENDPOINT_URL,
    region: 'auto',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return client;
}

export async function getR2Object(key: string, maxBytes: number): Promise<Buffer | null> {
  const { Body, ContentLength } = await getR2Client().send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { abortSignal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) }
  );

  if (!Body) return null;

  if (ContentLength === undefined || ContentLength > maxBytes) {
    await Body.transformToWebStream().cancel();
    return null;
  }

  return Buffer.from(await Body.transformToByteArray());
}

export async function putR2Object({
  key,
  body,
  contentType,
  cacheControl,
}: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
    { abortSignal: AbortSignal.timeout(R2_REQUEST_TIMEOUT_MS) }
  );
}
