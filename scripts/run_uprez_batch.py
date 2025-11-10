import json
import os
import subprocess
import sys
import time
import tempfile
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional, Set
from dotenv import load_dotenv

worker_dir = Path(__file__).parent.parent
load_dotenv(worker_dir / ".env")


def load_config(script_dir: Path) -> Dict[str, Any]:
    config_file = script_dir / "uprez-config.json"
    if not config_file.exists():
        raise FileNotFoundError(f"uprez-config.json not found at {config_file}")
    
    with open(config_file, 'r') as f:
        return json.load(f)


def get_all_playlist_dreams(client, playlist_uuid: str) -> List[Dict[str, Any]]:
    all_dreams = []
    skip = 0
    take = 100
    
    while True:
        try:
            response = client.get_playlist_items(playlist_uuid, take=take, skip=skip)
            items = response.get("items", [])
            
            if not items:
                break
            
            for item in items:
                if item.get("type") == "dream" and item.get("dreamItem"):
                    dream = item["dreamItem"]
                    all_dreams.append({
                        "dream": dream,
                        "playlist_item_id": item.get("id"),
                    })
            
            total_count = response.get("totalCount", 0)
            if len(all_dreams) >= total_count or len(items) < take:
                break
            
            skip += take
        except Exception as e:
            print(f"Error fetching playlist items: {e}", file=sys.stderr)
            break
    
    return all_dreams


def is_dream_already_uprezed(client, original_dream_uuid: str, marker: str = "uprez") -> bool:
    try:
        dream = client.get_dream(original_dream_uuid)
        if not dream:
            return False
        description = dream.get("description", "") or ""
        return marker.lower() in description.lower()
    except Exception:
        return False


def create_uprez_job_json(
    dream: Dict[str, Any],
    uprez_config: Dict[str, Any]
) -> Dict[str, Any]:
    job_json = {
        "infinidream_algorithm": "uprez",
        "upscale_factor": uprez_config.get("upscale_factor", 2),
        "interpolation_factor": uprez_config.get("interpolation_factor", 2),
        "output_format": uprez_config.get("output_format", "mp4"),
        "tile_size": uprez_config.get("tile_size", 1024),
        "tile_padding": uprez_config.get("tile_padding", 10),
        "quality": uprez_config.get("quality", "high"),
    }
    
    dream_uuid = dream.get("uuid")
    video_url = dream.get("video") or dream.get("original_video")
    
    if dream_uuid:
        job_json["video_uuid"] = dream_uuid
    elif video_url:
        job_json["video_url"] = video_url
    else:
        raise ValueError(f"Dream {dream_uuid} has no video_uuid or video URL")
    
    if "output_fps" in uprez_config:
        job_json["output_fps"] = uprez_config["output_fps"]
    
    return job_json


def get_job_result_from_redis(job_id: str, queue_name: str = "uprezvideo") -> Optional[Dict[str, Any]]:
    try:
        import redis
        
        redis_url = os.environ.get("REDISCLOUD_URL")
        if redis_url:
            redis_client = redis.from_url(redis_url, decode_responses=False)
        else:
            redis_host = os.environ.get("REDIS_HOST", "localhost")
            redis_port = int(os.environ.get("REDIS_PORT", "6379"))
            redis_password = os.environ.get("REDIS_PASSWORD", "")
            redis_client = redis.Redis(
                host=redis_host,
                port=redis_port,
                password=redis_password if redis_password else None,
                decode_responses=False
            )
        
        job_key = f"bull:{queue_name}:{job_id}"
        job_hash = redis_client.hgetall(job_key)
        
        if not job_hash:
            return None
        
        returnvalue_bytes = job_hash.get(b"returnvalue") or job_hash.get("returnvalue")
        if not returnvalue_bytes:
            return None
        
        if isinstance(returnvalue_bytes, bytes):
            returnvalue_str = returnvalue_bytes.decode('utf-8')
        else:
            returnvalue_str = str(returnvalue_bytes)
        
        try:
            result = json.loads(returnvalue_str)
            if isinstance(result, dict) and result.get("r2_url"):
                return result
            elif isinstance(result, dict):
                return result
            else:
                return {"r2_url": returnvalue_str} if returnvalue_str else None
        except (json.JSONDecodeError, TypeError):
            return {"r2_url": returnvalue_str} if returnvalue_str else None
    except ImportError:
        try:
            from bullmq import Queue, Job
            import redis
            
            redis_url = os.environ.get("REDISCLOUD_URL")
            if redis_url:
                redis_client = redis.from_url(redis_url)
            else:
                redis_host = os.environ.get("REDIS_HOST", "localhost")
                redis_port = int(os.environ.get("REDIS_PORT", "6379"))
                redis_password = os.environ.get("REDIS_PASSWORD", "")
                redis_client = redis.Redis(
                    host=redis_host,
                    port=redis_port,
                    password=redis_password if redis_password else None,
                    decode_responses=False
                )
            
            queue = Queue(queue_name, connection=redis_client)
            job = Job.fromId(queue, job_id)
            
            if job and job.returnvalue:
                return job.returnvalue
            return None
        except Exception:
            return None
    except Exception as e:
        print(f"Error getting job result: {e}", file=sys.stderr)
        return None


def queue_job_via_cli(job_json: Dict[str, Any], worker_dir: Path) -> Tuple[subprocess.CompletedProcess, Optional[str]]:
    queue_js = worker_dir / "dist" / "queue-uprez.js"
    if not queue_js.exists():
        raise FileNotFoundError(
            f"TypeScript not built. Run 'npm run build' first. Expected: {queue_js}"
        )
    
    json_str = json.dumps(job_json)
    cmd = ["node", str(queue_js)]
    
    result = subprocess.run(
        cmd,
        cwd=str(worker_dir),
        input=json_str,
        text=True,
        capture_output=True
    )
    
    job_id = None
    if result.returncode == 0 and result.stdout:
        try:
            lines = result.stdout.strip().split('\n')
            json_line = None
            for line in reversed(lines):
                line = line.strip()
                if line.startswith('{') and line.endswith('}'):
                    json_line = line
                    break
            
            if json_line:
                output_data = json.loads(json_line)
                job_id = output_data.get("jobId")
        except (json.JSONDecodeError, KeyError, ValueError):
            pass
    
    return result, job_id


def update_dream_description(client, dream_uuid: str, marker: str = "uprez") -> bool:
    try:
        dream = client.get_dream(dream_uuid)
        if not dream:
            return False
        
        current_description = dream.get("description") or ""
        
        if marker.lower() in current_description.lower():
            return True
        
        if current_description:
            new_description = f"{current_description} {marker}"
        else:
            new_description = marker
        
        from edream_sdk.types.dream_types import UpdateDreamRequest
        update_data: UpdateDreamRequest = {
            "description": new_description
        }
        
        client.update_dream(dream_uuid, update_data)
        return True
    except Exception as e:
        print(f"Error updating dream description: {e}", file=sys.stderr)
        return False


def main():
    script_file = Path(__file__).resolve()
    scripts_dir = script_file.parent
    worker_dir = scripts_dir.parent
    
    print(f"Worker directory: {worker_dir}")
    print(f"Scripts directory: {scripts_dir}")
    
    print("\nLoading uprez-config.json...")
    try:
        config = load_config(scripts_dir)
        print(f"Loaded uprez-config.json")
    except Exception as e:
        print(f"Error loading uprez-config.json: {e}", file=sys.stderr)
        sys.exit(1)
    
    playlist_uuid = config.get("playlist_uuid")
    if not playlist_uuid:
        print("'playlist_uuid' not found in uprez-config.json", file=sys.stderr)
        sys.exit(1)
    
    uprez_config = config.get("uprez_config", {})
    tracking_config = config.get("tracking", {})
    marker = tracking_config.get("marker", "uprez")
    existing_playlist_uuid = tracking_config.get("existing_playlist_uuid")
    
    print(f"\nSource playlist UUID: {playlist_uuid}")
    print(f"Marker: {marker}")
    
    try:
        from edream_sdk.client import create_edream_client
        from edream_sdk.types.playlist_types import CreatePlaylistRequest
        
        backend_url = os.environ.get("BACKEND_URL")
        api_key = os.environ.get("API_KEY")
        
        if not backend_url or not api_key:
            print("\nMissing environment variables:", file=sys.stderr)
            if not backend_url:
                print("  - BACKEND_URL", file=sys.stderr)
            if not api_key:
                print("  - API_KEY", file=sys.stderr)
            sys.exit(1)
        
        client = create_edream_client(backend_url, api_key)
        print(f"Connected to backend: {backend_url}")
    except ImportError:
        print("\nError: edream_sdk not installed", file=sys.stderr)
        print("Install it with: pip install -r requirements.txt", file=sys.stderr)
        sys.exit(1)
    
    print(f"\nFetching dreams from playlist...")
    try:
        all_dreams = get_all_playlist_dreams(client, playlist_uuid)
        print(f"Found {len(all_dreams)} dream(s) in playlist")
    except Exception as e:
        print(f"Error fetching playlist dreams: {e}", file=sys.stderr)
        sys.exit(1)
    
    output_playlist = None
    if existing_playlist_uuid:
        print(f"\nUsing existing output playlist: {existing_playlist_uuid}")
        try:
            output_playlist = client.get_playlist(existing_playlist_uuid)
            print(f"Found playlist: {output_playlist.get('name', 'Unnamed')}")
        except Exception as e:
            print(f"Error getting existing playlist: {e}", file=sys.stderr)
            print("Will create a new playlist instead...")
            existing_playlist_uuid = None
    
    if not output_playlist:
        output_playlist_config = config.get("output_playlist", {})
        if not output_playlist_config:
            print("Error: 'output_playlist' config required when creating new playlist", file=sys.stderr)
            sys.exit(1)
        
        print(f"\nCreating new output playlist...")
        playlist_data: CreatePlaylistRequest = {
            "name": output_playlist_config.get("name", "Uprezed Playlist"),
            "description": output_playlist_config.get("description"),
            "nsfw": output_playlist_config.get("nsfw", False),
        }
        output_playlist = client.create_playlist(playlist_data)
        print(f"Created playlist: {output_playlist['uuid']} - {output_playlist.get('name', 'Unnamed')}")
    
    output_playlist_uuid = output_playlist["uuid"]
    
    print(f"\nChecking which dreams have already been uprezed...")
    dreams_to_process = []
    already_uprezed = []
    
    for dream_data in all_dreams:
        dream = dream_data["dream"]
        dream_uuid = dream.get("uuid")
        if is_dream_already_uprezed(client, dream_uuid, marker):
            already_uprezed.append(dream_uuid)
        else:
            dreams_to_process.append(dream_data)
    
    print(f"Dreams already uprezed: {len(already_uprezed)}")
    print(f"Dreams to process: {len(dreams_to_process)}")
    
    if not dreams_to_process:
        print("\nNo dreams to uprez. All dreams are already processed.")
        return
    
    print("\n" + "="*60)
    print("Queueing uprez jobs...")
    print("="*60)
    
    successful_jobs = 0
    failed_jobs = 0
    job_mapping = {}
    
    total_jobs = len(dreams_to_process)
    for idx, dream_data in enumerate(dreams_to_process, 1):
        dream = dream_data["dream"]
        dream_uuid = dream.get("uuid")
        dream_name = dream.get("name") or dream_uuid
        
        try:
            job_json = create_uprez_job_json(dream, uprez_config)
        except Exception as e:
            print(f"[{idx}/{total_jobs}] Failed: Error creating job JSON for {dream_name}: {e}", file=sys.stderr)
            failed_jobs += 1
            continue
        
        try:
            result, job_id = queue_job_via_cli(job_json, worker_dir)
            if result.returncode == 0:
                print(f"[{idx}/{total_jobs}] Queued: {dream_name}")
                successful_jobs += 1
                if job_id:
                    job_mapping[job_id] = {"dream_uuid": dream_uuid, "dream_name": dream_name}
            else:
                error_msg = result.stderr.strip() if hasattr(result, 'stderr') and result.stderr else "Unknown error"
                print(f"[{idx}/{total_jobs}] Failed: Return code {result.returncode}: {error_msg}", file=sys.stderr)
                failed_jobs += 1
        except Exception as e:
            print(f"[{idx}/{total_jobs}] Failed: Error: {e}", file=sys.stderr)
            failed_jobs += 1
    
    print("\n" + "="*60)
    print("Queueing Summary")
    print("="*60)
    print(f"Total dreams: {total_jobs}")
    print(f"Successfully queued: {successful_jobs}")
    print(f"Failed to queue: {failed_jobs}")
    print(f"Jobs to track: {len(job_mapping)}")
    
    if job_mapping:
        print(f"\nWaiting for {len(job_mapping)} jobs to complete...")
        print("(Videos will be uploaded as they complete)")
        
        processed_jobs = set()
        uploaded_count = 0
        max_wait_time = 7200
        poll_interval = 10
        start_time = time.time()
        temp_dir = Path(tempfile.mkdtemp(prefix="uprez_videos_"))
        
        try:
            while job_mapping and (time.time() - start_time) < max_wait_time:
                remaining_jobs = {}
                for job_id, dream_info in job_mapping.items():
                    if job_id in processed_jobs:
                        continue
                    
                    dream_uuid = dream_info["dream_uuid"]
                    dream_name = dream_info["dream_name"]
                    
                    result = get_job_result_from_redis(job_id, "uprezvideo")
                    if result and result.get("r2_url"):
                        r2_url = result["r2_url"]
                        print(f"\nJob {job_id} completed - processing now...")
                        print(f"  Original dream: {dream_uuid}")
                        
                        try:
                            temp_file = temp_dir / f"uprez_{job_id}.mp4"
                            print(f"  Downloading from R2...")
                            
                            if client.download_file(r2_url, str(temp_file)):
                                print(f"  Downloaded, creating dream and adding to playlist...")
                                new_dream = client.add_file_to_playlist(output_playlist_uuid, str(temp_file), name=dream_name)
                                print(f"  Added to playlist (dream: {new_dream['uuid']})")
                                
                                print(f"  Marking original dream as uprezed...")
                                if update_dream_description(client, dream_uuid, marker):
                                    print(f"  Original dream marked successfully")
                                else:
                                    print(f"  Warning: Failed to mark original dream", file=sys.stderr)
                                
                                uploaded_count += 1
                                processed_jobs.add(job_id)
                                
                                temp_file.unlink(missing_ok=True)
                            else:
                                print(f"  Failed to download, will retry...")
                                remaining_jobs[job_id] = dream_info
                        except Exception as e:
                            print(f"  Error processing job {job_id}: {e}", file=sys.stderr)
                            import traceback
                            traceback.print_exc()
                            remaining_jobs[job_id] = dream_info
                    else:
                        remaining_jobs[job_id] = dream_info
                
                job_mapping = remaining_jobs
                
                if not job_mapping:
                    break
                
                print(f"  Waiting for {len(job_mapping)} more jobs...")
                time.sleep(poll_interval)
            
            if job_mapping:
                print(f"\nTimeout: {len(job_mapping)} jobs did not complete in time")
            
            print(f"\nProcessing complete!")
            print(f"  Output playlist UUID: {output_playlist_uuid}")
            print(f"  Videos uploaded: {uploaded_count}")
            if job_mapping:
                print(f"  Jobs not completed: {len(job_mapping)}")
        finally:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    print("\nNote: Jobs are now in Redis queue and will be processed by the worker.")
    
    if failed_jobs > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

