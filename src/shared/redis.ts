import Redis from 'ioredis';
import env from './env.js';

const redisClient = env.REDISCLOUD_URL
  ? new Redis(env.REDISCLOUD_URL, {
      maxRetriesPerRequest: null,
    })
  : new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });

if (env.DEBUG) console.log('redisClient', env.REDISCLOUD_URL, redisClient);

export default redisClient;
