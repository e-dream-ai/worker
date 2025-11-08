# Uprez Batch Processing Script

The `run_uprez_batch.py` script allows you to automatically uprez all dreams in a playlist and add the uprezed versions to an output playlist.

## Prerequisites

1. Install Python dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Build TypeScript (if not already built):

   ```bash
   npm run build
   ```

3. Ensure Redis is running and accessible (same Redis instance as the worker)

4. Install the Python SDK:
   ```bash
   cd ../python-api
   pip install -e .
   ```

## Setup

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
   - `output_playlist`: Required only when creating a new playlist. Contains:
     - `name`: Name for the new playlist
     - `description`: Optional description
     - `nsfw`: Boolean flag
   - `uprez_config`: Uprez processing settings:
     - `upscale_factor`: How much to upscale (default: 2)
     - `interpolation_factor`: Frame interpolation factor (default: 2)
     - `output_format`: Output format (default: "mp4")
     - `tile_size`: Tile size for processing (default: 1024)
     - `tile_padding`: Tile padding (default: 10)
     - `quality`: Quality setting (default: "high")
     - `output_fps`: Optional output FPS
   - `tracking`:
     - `marker`: Text to mark processed dreams (default: "uprez")
     - `existing_playlist_uuid`: UUID of existing output playlist (optional). If set, new uprezed videos will be added to this playlist instead of creating a new one.
