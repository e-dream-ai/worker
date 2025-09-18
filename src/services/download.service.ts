import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

interface DownloadOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

export class DownloadService {
  private readonly defaultOptions: Required<DownloadOptions> = {
    maxRetries: 3,
    timeoutMs: 300000,
  };

  async downloadFile(url: string, destinationPath: string, options: DownloadOptions = {}): Promise<void> {
    const config = { ...this.defaultOptions, ...options };
    this.ensureDirectoryExists(destinationPath);

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        await this.attemptDownload(url, destinationPath, config.timeoutMs);
        return;
      } catch (error) {
        if (attempt === config.maxRetries) {
          throw new Error(`Failed to download ${url} after ${config.maxRetries} attempts: ${error.message}`);
        }
        await this.waitForRetry(attempt);
      }
    }
  }

  private async attemptDownload(url: string, destinationPath: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const request = client.get(url, (response) => {
        if (this.isRedirect(response)) {
          return this.attemptDownload(response.headers.location!, destinationPath, timeoutMs)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const fileStream = fs.createWriteStream(destinationPath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (error) => {
          this.cleanupFile(destinationPath);
          reject(error);
        });

        response.on('error', (error) => {
          this.cleanupFile(destinationPath);
          reject(error);
        });
      });

      request.on('error', reject);
      request.setTimeout(timeoutMs, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  private isRedirect(response: http.IncomingMessage): boolean {
    return response.statusCode! >= 300 && response.statusCode! < 400 && !!response.headers.location;
  }

  private ensureDirectoryExists(filePath: string): void {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  private cleanupFile(filePath: string): void {
    fs.unlink(filePath, () => {});
  }

  private async waitForRetry(attempt: number): Promise<void> {
    const waitTime = Math.pow(2, attempt) * 1000;
    return new Promise((resolve) => setTimeout(resolve, waitTime));
  }
}
