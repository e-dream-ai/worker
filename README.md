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
4. Run jobs using JSON files:
   - `node dist/prompt.js deforum prompt/deforum-fish.json` (creates `prompt/deforum-fish.mp4`)
   - `node dist/prompt.js animatediff prompt/animatediff-dog.json` (creates `prompt/animatediff-dog.mp4`)
   - By default, output files are saved in the same directory as the input JSON file with a `.mp4` extension
   - Use the `-o` option to specify a custom output path: `node dist/prompt.js deforum prompt/deforum-fish.json -o my-custom-name.mp4` (creates `my-custom-name.mp4` in current directory)

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis
