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
4. `node dist/prompt.js animatediff "frame1, frame2, frame3"` or `node dist/prompt.js deforum '{"0":"fish"}'`. You can also pass JSON via file using the @file syntax:
   - `node dist/prompt.js deforum @prompt/deforum-fish.json`
   - `node dist/prompt.js animatediff @prompt/animatediff-dog.json`

```
node dist/prompt.js deforum \{\"0\": \"a fish on a bicycle\"\}
```

### Bash CLI

- `./gpu animatediff @prompt/animatediff-dog.json`
- `./gpu deforum @prompt/deforum-fish.json`

If you see `permission denied` when running `./gpu`, make the script executable:

```
chmod +x ./gpu
```

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis
