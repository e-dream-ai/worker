import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';
import env from '../shared/env.js';

export class R2UploadService {
  private readonly s3Client: S3Client | null;
  private readonly bucketName: string;
  private readonly uploadDirectory: string;
  private readonly imageDirectory: string;
  private readonly presignedExpiry: number;

  constructor() {
    this.bucketName = env.R2_BUCKET_NAME;
    this.uploadDirectory = env.R2_UPLOAD_DIRECTORY;
    this.imageDirectory = env.R2_IMAGE_DIRECTORY;
    this.presignedExpiry = parseInt(env.R2_PRESIGNED_EXPIRY, 10);

    if (env.R2_ENDPOINT_URL && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME) {
      this.s3Client = new S3Client({
        endpoint: env.R2_ENDPOINT_URL,
        region: 'auto',
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      });
    } else {
      this.s3Client = null;
    }
  }

  async downloadAndUploadVideo(videoUrl: string, jobId: string, filename?: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error(
        'R2 is not configured. Please set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
      );
    }

    const { stream, contentLength } = await this.fetchVideoStream(videoUrl);
    const objectKey = await this.uploadStreamToR2(stream, jobId, filename, contentLength);
    const presignedUrl = await this.generatePresignedUrl(objectKey);

    return presignedUrl;
  }

  private async fetchVideoStream(url: string): Promise<{ stream: Readable; contentLength?: number }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const contentLength = response.headers.get('content-length');
    const stream = Readable.fromWeb(response.body as ReadableStream);

    return {
      stream,
      contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
    };
  }

  private async uploadStreamToR2(
    stream: Readable,
    jobId: string,
    filename?: string,
    contentLength?: number
  ): Promise<string> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    // Determine object key
    const fileExtension = '.mp4';
    const objectKey = filename
      ? `${this.uploadDirectory}/${filename}`
      : `${this.uploadDirectory}/${jobId}-${Date.now()}${fileExtension}`;

    const commandParams: any = {
      Bucket: this.bucketName,
      Key: objectKey,
      Body: stream,
      ContentType: 'video/mp4',
    };

    if (contentLength !== undefined && contentLength > 0 && !isNaN(contentLength)) {
      commandParams.ContentLength = contentLength;
    }

    const command = new PutObjectCommand(commandParams);

    await this.s3Client.send(command);
    return objectKey;
  }

  async uploadImageToR2(imagePath: string, jobId: string, filename?: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error(
        'R2 is not configured. Please set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
      );
    }

    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    const imageBuffer = readFileSync(imagePath);
    const fileExtension = extname(imagePath).toLowerCase();
    const contentType = this.getMimeTypeFromExtension(fileExtension);

    const objectKey = filename
      ? `${this.imageDirectory}/${filename}`
      : `${this.imageDirectory}/${jobId}-${Date.now()}${fileExtension}`;

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      Body: imageBuffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);

    return await this.generatePresignedUrl(objectKey);
  }

  private getMimeTypeFromExtension(extension: string): string {
    const extToMime: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
    };
    return extToMime[extension.toLowerCase()] || 'image/png';
  }

  private async generatePresignedUrl(objectKey: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn: this.presignedExpiry });
  }
}
