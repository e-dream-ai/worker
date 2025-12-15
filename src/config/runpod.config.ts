import runpodSdk from 'runpod-sdk';
import env from '../shared/env.js';
import { PublicEndpointService } from '../services/public-endpoint.service.js';

export const runpod = runpodSdk(env.RUNPOD_API_KEY);

export const endpoints = {
  animatediff: runpod.endpoint(env.RUNPOD_ANIMATEDIFF_ENDPOINT_ID),
  hunyuan: runpod.endpoint(env.RUNPOD_HUNYUAN_ENDPOINT_ID),
  deforum: runpod.endpoint(env.RUNPOD_DEFORUM_ENDPOINT_ID),
  uprez: runpod.endpoint(env.RUNPOD_UPREZ_ENDPOINT_ID),
  wanT2V: new PublicEndpointService('wan-2-2-t2v-720'),
  wanI2V: new PublicEndpointService('wan-2-2-i2v-720'),
  wanI2VLora: new PublicEndpointService('wan-2-2-t2v-720-lora'),
  qwenImage: new PublicEndpointService('qwen-image-t2i'),
} as const;
