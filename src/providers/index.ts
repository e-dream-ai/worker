import { VideoProvider } from './provider.types.js';
import { falVideoProvider } from './fal.provider.js';

const PROVIDERS: Record<string, VideoProvider> = {
  [falVideoProvider.name]: falVideoProvider,
};

export function getProvider(name: string): VideoProvider {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider "${name}" — register it in providers/index.ts`);
  }
  return provider;
}
