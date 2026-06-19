import { Job } from 'bullmq';
import env from '../shared/env.js';

export function resolveProviderKey(provider: string, _job: Job): string {
  switch (provider) {
    case 'fal': {
      if (!env.FAL_KEY) {
        throw new Error('FAL_KEY is not configured');
      }
      return env.FAL_KEY;
    }
    default:
      throw new Error(`No API key configured for provider "${provider}"`);
  }
}
