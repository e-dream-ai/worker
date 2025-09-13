# <div align="center"><h1>e-dream.ai worker </h1></div>

## Setup

1. `nvm install`
2. `nvm use`
3. `npm install`
4. `brew install redis`
5. Grab the appropriate runpod .env from 1Password and save to `.env`
6. `npm run build`

## Running

1. `nvm use`
2. `npm start &` to start the worker and server
3. visit http://localhost:3000/admin/queues to view job queues
4. `node dist/prompt.js A fish on a bicycle` to execute a job with a prompt OR `node dist/prompt.js keyframe1, keyframe2, keyframe3` to replace multiple keyframes with comma-separated values, see

```
node dist/prompt.js deforum \{\"0\": \"a fish on a bicycle\"\}
```

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis
