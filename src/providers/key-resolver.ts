import axios from 'axios';
import { Job } from 'bullmq';
import env from '../shared/env.js';

export async function resolveProviderKey(provider: string, job: Job): Promise<string> {
  if (provider !== 'fal') {
    throw new Error(`No API key configured for provider "${provider}"`);
  }

  const useGlobalKey = job.data?.use_global_key !== false;
  if (useGlobalKey) {
    if (!env.FAL_KEY) {
      throw new Error('FAL_KEY is not configured');
    }
    return env.FAL_KEY;
  }

  const userId = job.data?.user_id;
  if (userId === undefined || userId === null) {
    throw new Error('Cannot resolve user provider key: missing user_id on job');
  }

  const { data } = await axios.get(`${env.BACKEND_URL}/internal/provider-keys/resolve`, {
    params: { userId, provider },
    headers: { 'x-internal-key': env.INTERNAL_API_KEY },
  });

  const key = data?.data?.key;
  if (!key) {
    throw new Error(`No ${provider} key resolved for user ${userId}`);
  }
  return key;
}
