import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { existsSync } from 'fs';
import { CLIService } from './services/cli.service.js';
import { R2UploadService } from './services/r2-upload.service.js';

const r2UploadService = new R2UploadService();
const cliService = new CLIService();

interface JobData {
  [key: string]: unknown;
  image?: string;
  last_image?: string;
}

async function findAndUploadImages(data: JobData, baseDir: string, jobId: string): Promise<JobData> {
  const result = { ...data };
  const imageFields = ['image', 'last_image'];

  for (const field of imageFields) {
    const imagePath = result[field] as string | undefined;

    if (!imagePath || typeof imagePath !== 'string') {
      continue;
    }

    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      console.log(`✓ ${field} is already a URL: ${imagePath}`);
      continue;
    }

    if (!imagePath.includes('/') && !imagePath.includes('\\')) {
      try {
        Buffer.from(imagePath, 'base64');
        console.log(`✓ ${field} appears to be base64, skipping upload`);
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
      console.warn(`⚠ ${field} path "${imagePath}" (resolved: ${resolvedPath}) not found, skipping upload`);
      continue;
    }

    try {
      console.log(`📤 Uploading ${field}: ${resolvedPath}...`);
      const presignedUrl = await r2UploadService.uploadImageToR2(resolvedPath, jobId);
      result[field] = presignedUrl;
      console.log(`✓ ${field} uploaded to R2: ${presignedUrl.substring(0, 80)}...`);
    } catch (error: any) {
      console.error(`❌ Failed to upload ${field} (${resolvedPath}): ${error.message}`);
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

  const tempJobId = `temp-${Date.now()}`;

  const baseDir = path.dirname(path.resolve(filePath));

  console.log(`Processing job file: ${filePath}`);
  console.log(`Base directory: ${baseDir}`);

  const processedData = await findAndUploadImages(jsonData, baseDir, tempJobId);

  const tempFilePath = path.join(baseDir, `.${path.basename(filePath, '.json')}.processed.json`);
  fs.writeFileSync(tempFilePath, JSON.stringify(processedData, null, 2));
  console.log(`Processed JSON saved to: ${tempFilePath}`);

  try {
    await cliService.processJobFileAuto(tempFilePath, options);
  } finally {
    if (existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
      console.log(`🧹 Cleaned up temporary file: ${tempFilePath}`);
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
      console.error(`\n❌ Error: ${error.message}`);
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
