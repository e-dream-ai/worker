import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import FormData from 'form-data';
import { CLIService } from './services/cli.service.js';
import env from './shared/env.js';

const cliService = new CLIService();

interface JobData {
  [key: string]: unknown;
  image?: string;
  last_image?: string;
}

async function uploadImageToWorker(imagePath: string, workerUrl: string): Promise<string> {
  const formData = new FormData();
  const imageBuffer = readFileSync(imagePath);
  const filename = path.basename(imagePath);
  formData.append('image', imageBuffer, filename);

  const response = await fetch(`${workerUrl}/api/upload-image`, {
    method: 'POST',
    body: formData as any,
    headers: formData.getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Worker upload failed: ${response.status} ${response.statusText}. ${errorText}`);
  }

  const data = (await response.json()) as { url: string };
  return data.url;
}

async function findAndUploadImages(data: JobData, baseDir: string, workerUrl: string): Promise<JobData> {
  const result = { ...data };
  const imageFields = ['image', 'last_image'];

  for (const field of imageFields) {
    const imagePath = result[field] as string | undefined;

    if (!imagePath || typeof imagePath !== 'string') {
      continue;
    }

    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      console.log(`${field} is already a URL: ${imagePath}`);
      continue;
    }

    if (!imagePath.includes('/') && !imagePath.includes('\\')) {
      try {
        Buffer.from(imagePath, 'base64');
        console.log(`${field} appears to be base64, skipping upload`);
        continue;
      } catch {
        // Not base64, continue to check if it's a file path
      }
    }

    let resolvedPath: string;
    if (path.isAbsolute(imagePath)) {
      resolvedPath = imagePath;
    } else {
      resolvedPath = path.resolve(baseDir, imagePath);
    }

    if (!existsSync(resolvedPath)) {
      console.warn(`${field} path "${imagePath}" (resolved: ${resolvedPath}) not found, skipping upload`);
      continue;
    }

    try {
      console.log(`Uploading ${field} to worker: ${resolvedPath}...`);
      const presignedUrl = await uploadImageToWorker(resolvedPath, workerUrl);
      result[field] = presignedUrl;
      console.log(`${field} uploaded: ${presignedUrl.substring(0, 80)}...`);
    } catch (error: any) {
      console.error(`Failed to upload ${field} (${resolvedPath}): ${error.message}`);
      throw new Error(`Failed to upload image for ${field}: ${error.message}`);
    }
  }

  return result;
}

async function submitJobWithImageUpload(filePath: string, options: { output?: string }): Promise<void> {
  if (!filePath.endsWith('.json')) {
    throw new Error('Input file must be a .json file');
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const jsonData: JobData = JSON.parse(raw);

  const baseDir = path.dirname(path.resolve(filePath));
  const workerUrl = env.WORKER_URL;

  console.log(`Processing job file: ${filePath}`);
  console.log(`Base directory: ${baseDir}`);
  console.log(`Worker URL: ${workerUrl}`);

  const processedData = await findAndUploadImages(jsonData, baseDir, workerUrl);

  const tempFilePath = path.join(baseDir, `.${path.basename(filePath, '.json')}.processed.json`);
  fs.writeFileSync(tempFilePath, JSON.stringify(processedData, null, 2));
  console.log(`Processed JSON saved to: ${tempFilePath}`);

  try {
    await cliService.processJobFileAuto(tempFilePath, options);
  } finally {
    if (existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      console.log(`Cleaned up temporary file: ${tempFilePath}`);
    }
  }
}

program
  .name('submit-job')
  .description('Submit job with automatic image upload to R2')
  .argument('<file>', 'Path to JSON file containing job settings')
  .option('-o, --output <path>', 'Output file path (default: same directory as input file with .mp4 extension)')
  .action(async (file: string, options) => {
    try {
      await submitJobWithImageUpload(file, options);
    } catch (error: any) {
      console.error(`\nError: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
