# <div align="center"><h1>e-dream.ai worker </h1></div>

## Setup

1. `nvm install/use`
2. `npm install`

### Install redis

`brew install redis`

### Edit .env

Grab the appropriate runpod .env from 1Password and save to `.env`

## Running

1. `npm start` to start the worker(s)
2. `node dist/prompt.js A Fish in a skyscraper` to execute a job with a prompt
