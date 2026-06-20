import { ImageProvider, VideoProvider } from './provider.types.js';
import { falImageProvider, falVideoProvider } from './fal.provider.js';

const PROVIDERS: Record<string, VideoProvider> = {
  [falVideoProvider.name]: falVideoProvider,
};

const IMAGE_PROVIDERS: Record<string, ImageProvider> = {
  [falImageProvider.name]: falImageProvider,
};

export function getProvider(name: string): VideoProvider {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider "${name}" — register it in providers/index.ts`);
  }
  return provider;
}

export function getImageProvider(name: string): ImageProvider {
  const provider = IMAGE_PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown image provider "${name}" — register it in providers/index.ts`);
  }
  return provider;
}
