import runpodSdk from 'runpod-sdk';
import env from '../shared/env.js';

export const runpod = runpodSdk(env.RUNPOD_API_KEY);

export const endpoints = {
  animatediff: runpod.endpoint(env.RUNPOD_ANIMATEDIFF_ENDPOINT_ID),
  hunyuan: runpod.endpoint(env.RUNPOD_HUNYUAN_ENDPOINT_ID),
  deforum: runpod.endpoint(env.RUNPOD_DEFORUM_ENDPOINT_ID),
} as const;
