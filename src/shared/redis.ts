import Redis, { RedisOptions } from 'ioredis';
import env from './env.js';

const REDIS_HOST = env.REDIS_HOST;
const REDIS_PORT = env.REDIS_PORT;
const REDIS_PASSWORD = env.REDIS_PASSWORD;
const REDISCLOUD_URL = env.REDISCLOUD_URL;

/**
 * redis config
 */
export const redisOptions: RedisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};

const redisClient = REDISCLOUD_URL
  ? new Redis(REDISCLOUD_URL, {
      maxRetriesPerRequest: null,
    })
  : new Redis(redisOptions);

if (env.DEBUG) console.log('redisClient', REDISCLOUD_URL, redisClient);

export default redisClient;
