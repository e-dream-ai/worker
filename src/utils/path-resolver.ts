import path from 'path';

interface PathOptions {
  customOutputPath?: string;
  inputFilePath?: string;
  outputName?: string;
  jobId: string;
}

export class PathResolver {
  static resolveOutputPath(options: PathOptions): string {
    const { customOutputPath, inputFilePath, outputName, jobId } = options;

    if (customOutputPath) {
      return path.isAbsolute(customOutputPath) ? customOutputPath : path.resolve(process.cwd(), customOutputPath);
    }

    if (inputFilePath && outputName) {
      const inputDirectory = path.dirname(inputFilePath);
      const sanitizedName = this.sanitizeFilename(String(outputName));
      const filename = this.ensureVideoExtension(sanitizedName);
      return path.join(inputDirectory, filename);
    }

    const fallbackName = `${jobId}_${Date.now()}.mp4`;
    return path.resolve(process.cwd(), fallbackName);
  }

  private static sanitizeFilename(filename: string): string {
    return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '');
  }

  private static ensureVideoExtension(filename: string): string {
    return filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
  }
}
