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
      const error = new Error(
        'R2 is not configured. Please set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
      );
      console.error('[R2UploadService.downloadAndUploadVideo]', {
        jobId,
        videoUrl,
        filename,
        error: error.message,
      });
      throw error;
    }

    try {
      const { stream, contentLength } = await this.fetchVideoStream(videoUrl);
      const objectKey = await this.uploadStreamToR2(stream, jobId, filename, contentLength);
      const presignedUrl = await this.generatePresignedUrl(objectKey);

      return presignedUrl;
    } catch (error: any) {
      console.error('[R2UploadService.downloadAndUploadVideo]', {
        jobId,
        videoUrl,
        filename,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  async downloadAndUploadImage(imageUrl: string, jobId: string, filename?: string): Promise<string> {
    if (!this.s3Client) {
      const error = new Error(
        'R2 is not configured. Please set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
      );
      console.error('[R2UploadService.downloadAndUploadImage]', {
        jobId,
        imageUrl,
        filename,
        error: error.message,
      });
      throw error;
    }

    try {
      const { stream, contentLength, contentType } = await this.fetchImageStream(imageUrl);
      const objectKey = await this.uploadImageStreamToR2(stream, jobId, filename, contentType, contentLength);
      const presignedUrl = await this.generatePresignedUrl(objectKey);

      return presignedUrl;
    } catch (error: any) {
      console.error('[R2UploadService.downloadAndUploadImage]', {
        jobId,
        imageUrl,
        filename,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  private async fetchVideoStream(url: string): Promise<{ stream: Readable; contentLength?: number }> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
        console.error('[R2UploadService.fetchVideoStream]', {
          url,
          status: response.status,
          statusText: response.statusText,
          error: error.message,
        });
        throw error;
      }

      if (!response.body) {
        const error = new Error('Response body is null');
        console.error('[R2UploadService.fetchVideoStream]', {
          url,
          error: error.message,
        });
        throw error;
      }

      const contentLength = response.headers.get('content-length');
      const stream = Readable.fromWeb(response.body as ReadableStream);

      return {
        stream,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
      };
    } catch (error: any) {
      if (error.message?.includes('Failed to fetch video') || error.message?.includes('Response body is null')) {
        throw error;
      }
      console.error('[R2UploadService.fetchVideoStream]', {
        url,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  private async fetchImageStream(
    url: string
  ): Promise<{ stream: Readable; contentLength?: number; contentType?: string }> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        console.error('[R2UploadService.fetchImageStream]', {
          url,
          status: response.status,
          statusText: response.statusText,
          error: error.message,
        });
        throw error;
      }

      if (!response.body) {
        const error = new Error('Response body is null');
        console.error('[R2UploadService.fetchImageStream]', {
          url,
          error: error.message,
        });
        throw error;
      }

      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type') || 'image/png';
      const stream = Readable.fromWeb(response.body as ReadableStream);

      return {
        stream,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
        contentType,
      };
    } catch (error: any) {
      if (error.message?.includes('Failed to fetch image') || error.message?.includes('Response body is null')) {
        throw error;
      }
      console.error('[R2UploadService.fetchImageStream]', {
        url,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  private async uploadStreamToR2(
    stream: Readable,
    jobId: string,
    filename?: string,
    contentLength?: number
  ): Promise<string> {
    if (!this.s3Client) {
      const error = new Error('S3 client not initialized');
      console.error('[R2UploadService.uploadStreamToR2]', {
        jobId,
        filename,
        error: error.message,
      });
      throw error;
    }

    try {
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
    } catch (error: any) {
      console.error('[R2UploadService.uploadStreamToR2]', {
        jobId,
        filename,
        bucketName: this.bucketName,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  private async uploadImageStreamToR2(
    stream: Readable,
    jobId: string,
    filename?: string,
    contentType?: string,
    contentLength?: number
  ): Promise<string> {
    if (!this.s3Client) {
      const error = new Error('S3 client not initialized');
      console.error('[R2UploadService.uploadImageStreamToR2]', {
        jobId,
        filename,
        error: error.message,
      });
      throw error;
    }

    try {
      let fileExtension = '.png';
      if (filename) {
        const ext = extname(filename).toLowerCase();
        if (ext) {
          fileExtension = ext;
        }
      } else if (contentType) {
        const mimeToExt: Record<string, string> = {
          'image/jpeg': '.jpg',
          'image/jpg': '.jpg',
          'image/png': '.png',
          'image/webp': '.webp',
          'image/gif': '.gif',
          'image/bmp': '.bmp',
          'image/svg+xml': '.svg',
          'image/tiff': '.tiff',
          'image/x-icon': '.ico',
          'image/heif': '.heif',
          'image/heic': '.heic',
        };
        fileExtension = mimeToExt[contentType.toLowerCase()] || '.png';
      }

      const objectKey = filename
        ? `${this.imageDirectory}/${filename}`
        : `${this.imageDirectory}/${jobId}-${Date.now()}${fileExtension}`;

      const finalContentType = contentType || this.getMimeTypeFromExtension(fileExtension);

      const commandParams: any = {
        Bucket: this.bucketName,
        Key: objectKey,
        Body: stream,
        ContentType: finalContentType,
      };

      if (contentLength !== undefined && contentLength > 0 && !isNaN(contentLength)) {
        commandParams.ContentLength = contentLength;
      }

      const command = new PutObjectCommand(commandParams);

      await this.s3Client.send(command);
      return objectKey;
    } catch (error: any) {
      console.error('[R2UploadService.uploadImageStreamToR2]', {
        jobId,
        filename,
        bucketName: this.bucketName,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  async uploadImageToR2(imagePath: string, jobId: string, filename?: string): Promise<string> {
    if (!this.s3Client) {
      const error = new Error(
        'R2 is not configured. Please set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
      );
      console.error('[R2UploadService.uploadImageToR2]', {
        jobId,
        imagePath,
        filename,
        error: error.message,
      });
      throw error;
    }

    if (!existsSync(imagePath)) {
      const error = new Error(`Image file not found: ${imagePath}`);
      console.error('[R2UploadService.uploadImageToR2]', {
        jobId,
        imagePath,
        filename,
        error: error.message,
      });
      throw error;
    }

    try {
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
    } catch (error: any) {
      console.error('[R2UploadService.uploadImageToR2]', {
        jobId,
        imagePath,
        filename,
        bucketName: this.bucketName,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }

  async uploadImageBufferToR2(imageBuffer: Buffer, jobId: string, filename?: string): Promise<string> {
    if (!this.s3Client) {
      const error = new Error(
        'R2 is not configured. Please set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME environment variables.'
      );
      console.error('[R2UploadService.uploadImageBufferToR2]', {
        jobId,
        filename,
        bufferSize: imageBuffer.length,
        error: error.message,
      });
      throw error;
    }

    try {
      const fileExtension = filename ? extname(filename).toLowerCase() : '.png';
      const contentType = this.getMimeTypeFromExtension(fileExtension);

      const objectKey = filename
        ? `${this.imageDirectory}/${filename}`
        : `${this.imageDirectory}/${jobId}-${Date.now()}${fileExtension}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        Body: imageBuffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);

      return await this.generatePresignedUrl(objectKey);
    } catch (error: any) {
      console.error('[R2UploadService.uploadImageBufferToR2]', {
        jobId,
        filename,
        bufferSize: imageBuffer.length,
        bucketName: this.bucketName,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
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
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.ico': 'image/x-icon',
      '.heif': 'image/heif',
      '.heic': 'image/heic',
    };
    return extToMime[extension.toLowerCase()] || 'image/png';
  }

  private async generatePresignedUrl(objectKey: string): Promise<string> {
    if (!this.s3Client) {
      const error = new Error('S3 client not initialized');
      console.error('[R2UploadService.generatePresignedUrl]', {
        objectKey,
        error: error.message,
      });
      throw error;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn: this.presignedExpiry });
    } catch (error: any) {
      console.error('[R2UploadService.generatePresignedUrl]', {
        objectKey,
        bucketName: this.bucketName,
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      throw error;
    }
  }
}
