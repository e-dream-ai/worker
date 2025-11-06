import 'dotenv/config';
import { bool, cleanEnv, port, str } from 'envalid';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production', 'stage'], default: 'development' }),
  PORT: port({ default: 3000 }),
  DEBUG: bool({ default: false }),

  /**
   * REDIS
   */
  REDISCLOUD_URL: str({ default: '' }),
  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),

  RUNPOD_API_KEY: str({ default: '' }),
  RUNPOD_HUNYUAN_ENDPOINT_ID: str({ default: '' }),
  RUNPOD_ANIMATEDIFF_ENDPOINT_ID: str({ default: '' }),
  RUNPOD_DEFORUM_ENDPOINT_ID: str({ default: '' }),
  RUNPOD_UPREZ_ENDPOINT_ID: str({ default: '' }),

  /**
   * CLOUDFLARE R2
   */
  R2_BUCKET_NAME: str({ default: '' }),
  R2_ENDPOINT_URL: str({ default: '' }),
  R2_ACCESS_KEY_ID: str({ default: '' }),
  R2_SECRET_ACCESS_KEY: str({ default: '' }),
  R2_UPLOAD_DIRECTORY: str({ default: 'video-outputs' }),
  R2_IMAGE_DIRECTORY: str({ default: 'image-inputs' }),
  R2_PRESIGNED_EXPIRY: str({ default: '86400' }),

  ADMIN_PASS: str({ default: '' }),
});

export default env;
