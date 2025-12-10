import axios from 'axios';
import { Readable } from 'stream';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import env from '../shared/env.js';

interface DreamInfo {
  uuid: string;
  user: {
    uuid: string;
    cognitoId?: string;
  };
}

export class VideoServiceClient {
  private readonly videoServiceUrl: string;
  private readonly videoServiceApiKey: string;
  private readonly backendUrl: string;
  private readonly backendApiKey: string;
  private readonly s3Client: S3Client | null;
  private readonly bucketName: string;

  constructor() {
    this.videoServiceUrl = env.VIDEO_SERVICE_URL;
    this.videoServiceApiKey = env.VIDEO_SERVICE_API_KEY;
    this.backendUrl = env.BACKEND_URL;
    this.backendApiKey = env.BACKEND_API_KEY;
    this.bucketName = env.R2_BUCKET_NAME;

    if (env.R2_ENDPOINT_URL && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
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

  async uploadGeneratedVideo(dreamUuid: string, videoUrl: string): Promise<boolean> {
    try {
      const dream = await this.getDreamInfo(dreamUuid);
      const userIdentifier = dream.user.cognitoId || dream.user.uuid;

      const r2Path = await this.uploadVideoToR2(videoUrl, dreamUuid, userIdentifier);
      await this.updateDreamOriginalVideo(dreamUuid, r2Path);

      const extension = 'mp4';

      await this.turnOnVideoServiceWorker();

      const response = await axios.post(
        `${this.videoServiceUrl}/process-video`,
        {
          dream_uuid: dreamUuid,
          extension: extension,
        },
        {
          headers: {
            Authorization: `Api-Key ${this.videoServiceApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.success !== false;
    } catch (error: any) {
      console.error(`Failed to upload generated video for dream ${dreamUuid}:`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        stack: error.stack,
      });
      return false;
    }
  }

  private async turnOnVideoServiceWorker(): Promise<void> {
    try {
      await axios.post(
        `${this.backendUrl}/dream/job/worker`,
        {},
        {
          headers: {
            Authorization: `Api-Key ${this.backendApiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error: any) {
      console.error('Failed to turn on video service worker:', error.message || error);
    }
  }

  private async getDreamInfo(dreamUuid: string): Promise<DreamInfo> {
    const response = await axios.get(`${this.backendUrl}/dream/${dreamUuid}`, {
      headers: {
        Authorization: `Api-Key ${this.backendApiKey}`,
      },
    });
    return response.data.data.dream;
  }

  private async updateDreamOriginalVideo(dreamUuid: string, r2Path: string): Promise<void> {
    await axios.put(
      `${this.backendUrl}/dream/${dreamUuid}`,
      {
        original_video: r2Path,
        status: 'queue',
      },
      {
        headers: {
          Authorization: `Api-Key ${this.backendApiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  private async uploadVideoToR2(videoUrl: string, dreamUuid: string, userIdentifier: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error('R2 client not initialized');
    }

    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const stream = Readable.fromWeb(response.body as ReadableStream);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const videoBuffer = Buffer.concat(chunks);

    const objectKey = `${userIdentifier}/${dreamUuid}/${dreamUuid}.mp4`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      Body: videoBuffer,
      ContentType: 'video/mp4',
    });

    await this.s3Client.send(command);

    return objectKey;
  }
}
