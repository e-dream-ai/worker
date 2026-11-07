# <div align="center"><h1>e-dream.ai worker </h1></div>

The worker consumes generation jobs that the backend puts on Redis (BullMQ) queues, runs them on RunPod or fal, and uploads the results through the video service. It also serves the Bull Board admin UI and runs the marketing email worker.

## Setup

1. `nvm install && nvm use`
2. `npm install`
3. `cp .env.example .env` and fill in what you need (see [Environment variables](#environment-variables))
4. `npm run build`

## Checks

- `npm test`: unit tests (vitest). Providers are mocked, so no API keys or Redis are needed.
- `npm run typecheck`

## Developing and testing changes

1. Make the change and cover it with unit tests where you can (for example, `src/providers/fal.provider.test.ts` covers the fal request bodies).
2. Open a PR into `stage`. Merging it deploys the stage worker.
3. Test end to end on stage, from the stage frontend or with an engines config (see below).

Don't run a local worker against the stage or alpha Redis. It consumes the same queues as the deployed worker, so the two would take each other's jobs.

### Testing on stage with engines

The [engines](https://github.com/e-dream-ai/engines) repo has a JSON config and a batch script for each model. The scripts create dreams through the backend API, so running one against stage sends real jobs through the stage backend and worker, and you can repeat the same request without clicking through the frontend.

1. Clone `e-dream-ai/engines` and run `pip install -r requirements.txt` (this also installs the SDK).
2. Copy `.env.example` to `.env`. Set `BACKEND_URL=https://api-stage.infinidream.ai/api/v1`, a stage `API_KEY`, and the stage test-input UUIDs that configs reference as `${VAR}` (for example, `STILL_UUID`).
3. Edit the model's config in `configs/` and run its script from the `engines/` directory:

   ```bash
   python3 scripts/run_krea_2_turbo_batch.py   # uses configs/krea-2-turbo-config.json
   ```

4. Watch the job in the stage Bull Board (see [Ops](#ops)). Results are added to the configured playlist, and image results are also downloaded locally.

## Adding a RunPod model

1. **Container.** Build it in its own `gpu-container-*` repo, push the image to Docker Hub (`edreamai/...`) and create a RunPod serverless endpoint. Test the endpoint directly with a sample input (for example, `test_input.json` in `gpu-container-discodiffusion`) before touching the worker.
2. **Worker.**
   - `src/shared/env.ts`: add `RUNPOD_<NAME>_ENDPOINT_ID: str({ default: '' })`
   - `src/config/runpod.config.ts`: add the endpoint
   - `src/workers/job-handlers.ts`: add a handler that builds the RunPod input, runs it, waits with `statusHandler.handleStatus` and uploads the result with `videoServiceClient`
   - `src/index.ts`: register the worker with `WorkerFactory.createWorker`, create the `Queue` and add it to Bull Board
3. **Backend.** In `backend/src/utils/prompt.util.ts`, add the algorithm to `SUPPORTED_ALGORITHMS` and `ALGORITHM_REGISTRY`. The queue name must match the one in the worker.
4. **Stage.** Set the endpoint ID on the stage Heroku app only, merge into `stage` and test from the stage frontend. Alpha won't use the model until it's merged to `main` and the env var is set on the alpha app.

## Environment variables

`src/shared/env.ts` is the source of truth and `.env.example` lists every variable. Every variable has a default, so the worker boots with an empty `.env`; set only what you're testing.

- **Redis:** `REDISCLOUD_URL`, or `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` for a local Redis
- **fal:** `FAL_KEY`
- **RunPod:** `RUNPOD_API_KEY`, plus one endpoint ID per model:
  - `RUNPOD_ANIMATEDIFF_ENDPOINT_ID`
  - `RUNPOD_HUNYUAN_ENDPOINT_ID`
  - `RUNPOD_DEFORUM_ENDPOINT_ID`
  - `RUNPOD_UPREZ_ENDPOINT_ID` (used by the enhance queue)
  - `RUNPOD_LTX_ENDPOINT_ID`
  - `RUNPOD_NVIDIA_SR_ENDPOINT_ID`
  - `RUNPOD_VIDEOINGEST_ENDPOINT_ID`
  - `RUNPOD_DISCODIFFUSION_ENDPOINT_ID`
- **Cloudflare R2:** `R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- **Backend:** `BACKEND_URL`, `BACKEND_API_KEY`, `INTERNAL_API_KEY`
- **Admin UI:** `ADMIN_PASS` (password for the user `admin`)
- **Marketing:** see [Marketing Email CLI](#marketing-email-cli)

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis.
3. Bull Board (log in as `admin` with `ADMIN_PASS`):
   - stage: https://gpu-worker-0ac312b41451.herokuapp.com/admin/queues/
   - alpha: https://gpu-worker-prod-8775591876d9.herokuapp.com/admin/queues

## Marketing Email CLI

Marketing sends are triggered from the `worker/` project and processed by the marketing worker.

### Prerequisites

- `worker/.env` must include:
  - `BACKEND_URL` (backend API base URL, e.g. `https://api-stage.infinidream.ai/api/v1`)
  - `BACKEND_API_KEY` (admin API key)
  - `MARKETING_EMAIL_SECRET` (shared internal secret)
  - `MARKETING_CONCURRENCY` (optional, default 10)
  - `MARKETING_RATE_LIMIT_PER_SECOND` (optional, default 6)
- Resend template must include variable `UNSUBSCRIBE_URL` in the template body
  - Example: `<a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a>`

### Build worker

```bash
cd worker
npm run build
```

### One-command send (starts worker + triggers send)

```bash
npm run marketing:send -- --template-id tpl_123 --dry-run
```

```bash
npm run marketing:send -- --template-id tpl_123 --limit 100 --offset 0
```

Send to one specific user:

```bash
npm run marketing:send -- --template-id tpl_123 --email user@example.com
```

or by user id:

```bash
npm run marketing:send -- --template-id tpl_123 --user-id 42
```

Send to users whose emails start with specific prefixes:

```bash
npm run marketing:send -- --template-id tpl_123 --email-prefix spot --email-prefix patrik.vulinec56
```

Send only to users on a minimum client version:

```bash
npm run marketing:send -- --template-id tpl_123 --min-last-client-version 0.14.7
```

Filters can be combined:

```bash
npm run marketing:send -- --template-id tpl_123 --email-prefix spot --min-last-client-version 0.14.7
```

The command starts the marketing worker in-process and will auto-exit when the queue is empty. You can also stop it early with Ctrl+C.
