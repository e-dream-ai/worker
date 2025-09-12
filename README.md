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

## Developer CLI

### Option 1: Shell Script

```bash
./gpu video "A fish on a bicycle"
./gpu animate "sunrise over mountains" "midday clouds" "sunset colors"
./gpu deforum '{"prompts": {"0": "cyberpunk city", "100": "neon lights"}}'
./gpu help
```

### Option 2: NPM Scripts

```bash
npm run video -- "A magical forest"
npm run animate -- "frame1" "frame2" "frame3"
npm run deforum -- '{"prompts": {...}}'
```

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis
