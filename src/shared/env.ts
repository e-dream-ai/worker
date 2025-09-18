import 'dotenv/config';
import { bool, cleanEnv, port, str } from 'envalid';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production', 'stage'] }),
  PORT: port({ default: 3000 }),
  DEBUG: bool({ default: false }),
  REMOTE_MODE: bool({ default: false }),

  /**
   * REDIS
   */
  REDISCLOUD_URL: str({ default: '' }),
  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),

  RUNPOD_API_KEY: str(),
  RUNPOD_HUNYUAN_ENDPOINT_ID: str(),
  RUNPOD_ANIMATEDIFF_ENDPOINT_ID: str(),
  RUNPOD_DEFORUM_ENDPOINT_ID: str(),

  ADMIN_PASS: str(),
});

export default env;
