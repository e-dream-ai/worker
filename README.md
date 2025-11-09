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

   **Automatic Image Upload (wan-i2v and wan-i2v-lora only):**

   For `wan-i2v` and `wan-i2v-lora` jobs, the CLI automatically:

   - Detects local image paths in `image` and `last_image` fields
   - Uploads them to the worker's `/api/upload-image` endpoint
   - Worker uploads to R2 and returns presigned URLs
   - Replaces paths with presigned URLs before submitting

   Example: `node dist/prompt.js prompt/wan-i2v-local-example.json` (automatically uploads local images)

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

For automatic image upload (wan-i2v and wan-i2v-lora jobs), also required:

- `WORKER_URL` (defaults to `http://localhost:3000` for local, or your deployed worker URL like `https://gpu-worker.herokuapp.com`)

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

### C) Batch Processing with Python Script

The `run_wan_i2v_batch.py` script allows you to queue multiple `wan-i2v` jobs at once, combining a main prompt with multiple "combo" prompts for each image in a directory.

**Prerequisites:**

1. Install Python dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Build TypeScript (if not already built):

   ```bash
   npm run build
   ```

3. Ensure Redis is running and accessible (same Redis instance as the worker)

**Setup:**

1. Configure `scripts/job.json`:

   ```json
   {
     "prompt": "Your main prompt here",
     "image_path": "scripts/images",
     "size": "1280*720",
     "duration": 5,
     "num_inference_steps": 30,
     "guidance": 5,
     "seed": 193078717,
     "combos": ["First combo prompt variation", "Second combo prompt variation"],
     "playlist": {
       "name": "My Batch Playlist",
       "description": "Optional description",
       "nsfw": false
     }
   }
   ```

2. Place images in the directory specified by `image_path` (e.g., `scripts/images/`)

**Running the script:**

```bash
cd scripts
python3 run_wan_i2v_batch.py
```

**Environment Variables:**

- `REDIS_HOST` (default: `localhost`) or `REDISCLOUD_URL`
- `REDIS_PORT` (default: `6379`)
- `REDIS_PASSWORD` (optional, empty string if none)
- `BACKEND_URL` - API backend URL
- `API_KEY` - API key for authentication

If `BACKEND_URL` and `API_KEY` are not set, the script will queue jobs but skip playlist creation.

### D) Uprez Batch Processing

The `run_uprez_batch.py` script allows you to automatically uprez all dreams in a playlist and add the uprezed versions to an output playlist.

**Prerequisites:**

1. Install Python dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Build TypeScript (if not already built):

   ```bash
   npm run build
   ```

3. Ensure Redis is running and accessible (same Redis instance as the worker)

**Setup:**

1. Configure `scripts/uprez-config.json`:

   ```json
   {
     "playlist_uuid": "your-source-playlist-uuid-here",
     "output_playlist": {
       "name": "Uprezed Playlist",
       "description": "Automatically uprezed videos",
       "nsfw": false
     },
     "uprez_config": {
       "upscale_factor": 2,
       "interpolation_factor": 2,
       "output_format": "mp4",
       "tile_size": 1024,
       "tile_padding": 10,
       "quality": "high"
     },
     "tracking": {
       "marker": "uprez",
       "existing_playlist_uuid": null
     }
   }
   ```

   **Configuration Options:**

   - `playlist_uuid`: UUID of the source playlist containing dreams to uprez
   - `output_playlist`: Required only when creating a new playlist. Contains name, description, and nsfw flag
   - `uprez_config`: Uprez processing settings (upscale_factor, interpolation_factor, output_format, tile_size, tile_padding, quality, optional output_fps)
   - `tracking`:
     - `marker`: Text to mark processed dreams (default: "uprez")
     - `existing_playlist_uuid`: UUID of existing output playlist (optional). If set, new uprezed videos will be added to this playlist instead of creating a new one.

## Ops

1. Visit https://www.runpod.io/console/serverless/user/endpoint/89vs9h0qx0g966?tab=requests to see recent activity and cancel jobs you don't wish to keep running.
2. https://apps.apple.com/us/app/red-2-ui-for-redis/id1491764008?mt=12 is helpful for seeing what's in Redis
3. https://gpu-worker-0ac312b41451.herokuapp.com/admin/queues/ for the Bull Dashboard (login the user "admin" and the password from the .env)
