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
2. `node dist/index.js &` to start the worker
3. `node dist/prompt.js A fish on a bicycle` to execute a job with a prompt, or `node dist/prompt.js keyframe1, keyframe2, keyframe3` to replace multiple keyframes with comma-separated values

It's also possible to use `npm run dev` to recompile/restart automatically, but NOTE: restarting the worker doesn't yet monitor existing jobs
