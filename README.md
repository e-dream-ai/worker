# <div align="center"><h1>e-dream.ai worker </h1></div>

## Running

There are two ways to use this project:

### A) Local development (run worker locally)

1. `nvm install`
2. `nvm use`
3. `npm install`
4. Ensure Redis is available locally (for example on macOS: `brew services start redis`)
5. Create `.env`.
6. Build: `npm run build`
7. Start the worker and admin UI: `npm start`
8. In another terminal, run jobs using JSON files:
   - `node dist/prompt.js prompt/deforum-fish.json` (creates `prompt/deforum-fish.mp4`)
   - `node dist/prompt.js prompt/animatediff-dog.json` (creates `prompt/animatediff-dog.mp4`)
   - `node dist/prompt.js prompt/uprez-example.json` (creates `prompt/uprez-example.mp4`)
   - `node dist/prompt.js prompt/wan-t2v-example.json` (creates `prompt/wan-t2v-example.mp4`)
   - `node dist/prompt.js prompt/wan-i2v-example.json` (creates `prompt/wan-i2v-example.mp4`)
   - `node dist/prompt.js prompt/wan-i2v-lora-example.json` (creates `prompt/wan-i2v-lora-example.mp4`)
   - By default, output files are saved alongside the input JSON with a `.mp4` extension
   - Use `-o` to specify a custom output path: `node dist/prompt.js prompt/deforum-fish.json -o my-custom-name.mp4`

Notes:

- The worker now always returns a presigned URL, and the CLI downloads to your machine.

Required env vars (local development)

- RUNPOD_API_KEY
- RUNPOD_ANIMATEDIFF_ENDPOINT_ID
- RUNPOD_HUNYUAN_ENDPOINT_ID
- RUNPOD_DEFORUM_ENDPOINT_ID
- RUNPOD_UPREZ_ENDPOINT_ID
- ADMIN_PASS (password for username `admin` in the admin UI)
- Redis: use local redis info (`REDIS_HOST=localhost`, `REDIS_PORT=6379`, `REDIS_PASSWORD=''`).

Note: Public endpoints like `wan-t2v`, `wan-i2v`, and `wan-i2v-lora` only require `RUNPOD_API_KEY` (no endpoint ID needed).

### B) Use deployed worker only (no local server)

1. Build once: `npm run build`
2. Point the CLI at the same Redis used by the worker. The CLI process needs a few env vars due to validation:
   - Required: `REDISCLOUD_URL`

```bash
node dist/prompt.js prompt/animatediff-dog.json -o ./out/dog.mp4
node dist/prompt.js prompt/uprez-example.json -o ./out/uprez.mp4
node dist/prompt.js prompt/deforum-fish.json -o ./out/deforum.mp4
node dist/prompt.js prompt/wan-t2v-example.json -o ./out/wan-t2v.mp4
node dist/prompt.js prompt/wan-i2v-example.json -o ./out/wan-i2v.mp4
node dist/prompt.js prompt/wan-i2v-lora-example.json -o ./out/wan-i2v-lora.mp4
```

How it works

- The worker returns `{ r2_url: <presigned-url> }`.
- The local CLI downloads from the provided URL to your specified `-o` path (or the default path when `-o` is omitted).

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis
3. https://gpu-worker-0ac312b41451.herokuapp.com/admin/queues/ for the Bull Dashboard (login the user "admin" and the password from the .env)
