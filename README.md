# <div align="center"><h1>e-dream.ai worker </h1></div>

## Setup

1. `nvm install`
2. `nvm use`
3. `npm install`
4. `brew install redis`
5. Grab the appropriate runpod .env from 1Password and save to `.env`

## Running

1. `nvm use`
2. `npm start` to start the worker or use `npm run dev` to recompile/restart automatically
3. `node dist/prompt.js A Fish in a skyscraper` to execute a job with a prompt
