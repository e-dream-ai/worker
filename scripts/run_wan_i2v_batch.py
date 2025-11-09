import json
import os
import subprocess
import sys
import time
import tempfile
import hashlib
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional, Set
from dotenv import load_dotenv

worker_dir = Path(__file__).parent.parent
load_dotenv(worker_dir / ".env")


def load_job_config(script_dir: Path) -> Dict[str, Any]:
    """Load job.json from scripts directory."""
    job_file = script_dir / "job.json"
    if not job_file.exists():
        raise FileNotFoundError(f"job.json not found at {job_file}")
    
    with open(job_file, 'r') as f:
        return json.load(f)


def get_images_from_path(image_path: str, base_dir: Path) -> List[Path]:
    """Get all image files from the image_path directory."""
    if os.path.isabs(image_path):
        image_dir = Path(image_path)
    else:
        image_dir = base_dir / image_path
    
    if not image_dir.exists():
        raise FileNotFoundError(f"Image directory not found: {image_dir}")
    
    if not image_dir.is_dir():
        raise ValueError(f"image_path must be a directory: {image_dir}")
    
    image_extensions = {'.png', '.jpg', '.jpeg', '.webp'}
    images = [
        img for img in image_dir.iterdir()
        if img.is_file() and img.suffix.lower() in image_extensions
    ]
    
    if not images:
        raise ValueError(f"No image files found in {image_dir}")
    
    return sorted(images)


def create_job_identifier(image_path: Path, combo_prompt: str) -> str:
    """Create a unique identifier for an image+combo combination."""
    image_name = image_path.name
    combo_hash = hashlib.md5(combo_prompt.encode()).hexdigest()[:8]
    return f"{image_name}:{combo_hash}"


def create_job_json(
    base_config: Dict[str, Any],
    image_path: Path,
    combo_prompt: str,
    base_dir: Path
) -> Dict[str, Any]:
    """Create a job JSON for a single image + combo combination."""
    main_prompt = base_config.get("prompt", "")
    combined_prompt = f"{main_prompt} {combo_prompt}".strip()
    
    if image_path.is_absolute():
        try:
            rel_path = image_path.relative_to(base_dir)
        except ValueError:
            rel_path = image_path
    else:
        rel_path = image_path
    
    job_json = {
        "infinidream_algorithm": "wan-i2v",
        "prompt": combined_prompt,
        "image": str(rel_path),
    }
    
    params_to_copy = [
        "size", "duration", "num_inference_steps", "guidance", "seed",
        "negative_prompt", "flow_shift", "enable_prompt_optimization",
        "enable_safety_checker"
    ]
    
    for param in params_to_copy:
        if param in base_config:
            job_json[param] = base_config[param]
    
    return job_json


def get_existing_dream_identifiers(playlist_uuid: str, client) -> Set[str]:
    """Get set of existing dream identifiers from a playlist."""
    existing_identifiers = set()
    
    try:
        playlist = client.get_playlist(playlist_uuid, auto_populate=True)
        items = playlist.get("items", [])
        
        for item in items:
            if item.get("type") == "dream" and item.get("dreamItem"):
                dream = item["dreamItem"]
                description = dream.get("description", "")
                name = dream.get("name", "")
                
                text_to_check = f"{description} {name}"
                if "BATCH_IDENTIFIER:" in text_to_check:
                    parts = text_to_check.split("BATCH_IDENTIFIER:")
                    if len(parts) > 1:
                        identifier = parts[1].split()[0] if parts[1].split() else ""
                        if identifier:
                            existing_identifiers.add(identifier)
    except Exception as e:
        print(f"Warning: Error getting existing dreams from playlist: {e}", file=sys.stderr)
    
    return existing_identifiers


def get_job_result_from_redis(job_id: str, queue_name: str = "wani2v") -> Optional[Dict[str, Any]]:
    """Get job result from Redis by reading BullMQ job data directly."""
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
    """Queue a job via lightweight TypeScript script and return job ID."""
    queue_js = worker_dir / "dist" / "queue-wan-i2v.js"
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

def main():
    """Main execution function."""
    script_file = Path(__file__).resolve()
    scripts_dir = script_file.parent
    worker_dir = scripts_dir.parent
    
    print(f"Worker directory: {worker_dir}")
    print(f"Scripts directory: {scripts_dir}")
    
    print("\nLoading job.json...")
    try:
        job_config = load_job_config(scripts_dir)
        print(f"Loaded job.json")
    except Exception as e:
        print(f"Error loading job.json: {e}", file=sys.stderr)
        sys.exit(1)
    
    image_path = job_config.get("image_path")
    if not image_path:
        print("'image_path' not found in job.json", file=sys.stderr)
        sys.exit(1)
    
    print(f"\nScanning images from: {image_path}")
    try:
        images = get_images_from_path(image_path, worker_dir)
        print(f"Found {len(images)} image(s)")
        for img in images:
            print(f"  - {img.name}")
    except Exception as e:
        print(f"Error getting images: {e}", file=sys.stderr)
        sys.exit(1)
    
    combos = job_config.get("combos", [])
    if not combos:
        print("\nNo 'combos' found in job.json, using empty combo")
        combos = [""]
    else:
        print(f"\nFound {len(combos)} combo(s)")
        for i, combo in enumerate(combos, 1):
            print(f"  {i}. {combo}")
    
    total_jobs = len(images) * len(combos)
    print(f"\nTotal jobs to run: {total_jobs} ({len(images)} images × {len(combos)} combos)")
    
    playlist_uuid = job_config.get("playlist_uuid")
    existing_identifiers: Set[str] = set()
    playlist = None
    
    if playlist_uuid:
        print("\n" + "="*60)
        print("Checking for existing playlist...")
        print("="*60)
        print(f"Playlist UUID: {playlist_uuid}")
        
        try:
            from edream_sdk.client import create_edream_client
            
            backend_url = os.environ.get("BACKEND_URL")
            api_key = os.environ.get("API_KEY")
            
            if not backend_url or not api_key:
                print("\nWarning: Missing API credentials (BACKEND_URL, API_KEY)")
                print("Cannot check for existing playlist. Will proceed without duplicate checking.")
            else:
                client = create_edream_client(backend_url, api_key)
                try:
                    playlist = client.get_playlist(playlist_uuid, auto_populate=True)
                    print(f"Playlist found: {playlist.get('name', 'Unnamed')}")
                    existing_identifiers = get_existing_dream_identifiers(playlist_uuid, client)
                    print(f"Found {len(existing_identifiers)} existing dream(s) in playlist")
                    if existing_identifiers:
                        print("Existing identifiers:")
                        for ident in sorted(existing_identifiers)[:10]:
                            print(f"  - {ident}")
                        if len(existing_identifiers) > 10:
                            print(f"  ... and {len(existing_identifiers) - 10} more")
                except Exception as e:
                    print(f"Error: Playlist not found or inaccessible: {e}", file=sys.stderr)
                    print("Will create new playlist if needed.")
                    playlist_uuid = None
        except ImportError:
            print("\nWarning: edream_sdk not installed. Cannot check for existing playlist.")
            print("Install it with: pip install -r requirements.txt")
            playlist_uuid = None
    
    print("\n" + "="*60)
    print("Queueing jobs to Redis...")
    print("="*60)
    
    successful_jobs = 0
    failed_jobs = 0
    skipped_jobs = 0
    job_ids = []
    
    job_count = 0
    for image_idx, image_path_obj in enumerate(images, 1):
        for combo in combos:
            job_count += 1
            combo_idx = combos.index(combo) + 1
            
            job_identifier = create_job_identifier(image_path_obj, combo)
            if job_identifier in existing_identifiers:
                print(f"[{job_count}/{total_jobs}] Skipped (already exists): {image_path_obj.name} + combo {combo_idx}")
                skipped_jobs += 1
                continue
            
            try:
                job_json = create_job_json(job_config, image_path_obj, combo, worker_dir)
            except Exception as e:
                print(f"[{job_count}/{total_jobs}] Failed: Error creating job JSON: {e}", file=sys.stderr)
                failed_jobs += 1
                continue
            
            try:
                result, job_id = queue_job_via_cli(job_json, worker_dir)
                if result.returncode == 0:
                    message = f"{image_path_obj.name} + combo {combo_idx}"
                    print(f"[{job_count}/{total_jobs}] {message}")
                    successful_jobs += 1
                    if job_id:
                        image_name_without_ext = image_path_obj.stem
                        job_ids.append((job_id, job_identifier, image_name_without_ext, combo_idx, image_path_obj))
                else:
                    error_msg = result.stderr.strip() if hasattr(result, 'stderr') and result.stderr else "Unknown error"
                    print(f"[{job_count}/{total_jobs}] Failed: Return code {result.returncode}: {error_msg}", file=sys.stderr)
                    failed_jobs += 1
            except Exception as e:
                print(f"[{job_count}/{total_jobs}] Failed: Error: {e}", file=sys.stderr)
                failed_jobs += 1
    
    print("\n" + "="*60)
    print("Queueing Summary")
    print("="*60)
    print(f"Total jobs: {total_jobs}")
    print(f"Successfully queued: {successful_jobs}")
    print(f"Skipped (already exist): {skipped_jobs}")
    print(f"Failed to queue: {failed_jobs}")
    print(f"Jobs to track: {len(job_ids)}")
    
    playlist_config = job_config.get("playlist")
    if (playlist_config or playlist_uuid) and job_ids:
        print("\n" + "="*60)
        print("Playlist Configuration")
        print("="*60)
        
        try:
            from edream_sdk.client import create_edream_client
            from edream_sdk.types.playlist_types import CreatePlaylistRequest
            
            backend_url = os.environ.get("BACKEND_URL")
            api_key = os.environ.get("API_KEY")
            
            if not backend_url or not api_key:
                print("\nSkipping playlist creation - missing environment variables:")
                if not backend_url:
                    print("  - BACKEND_URL")
                if not api_key:
                    print("  - API_KEY")
                print("\nSet these to enable playlist creation.")
            else:
                print(f"\nAPI credentials found")
                print(f"  Backend: {backend_url}")
                
                client = create_edream_client(backend_url, api_key)
                
                if playlist_uuid:
                    if not playlist:
                        try:
                            playlist = client.get_playlist(playlist_uuid, auto_populate=True)
                        except Exception as e:
                            print(f"\nError: Could not retrieve playlist {playlist_uuid}: {e}", file=sys.stderr)
                            print("Cannot proceed without valid playlist.")
                            sys.exit(1)
                    
                    print(f"\nUsing existing playlist: {playlist.get('name', 'Unnamed')}")
                    print(f"Playlist UUID: {playlist['uuid']}")
                    if playlist_config:
                        print(f"Config name: {playlist_config.get('name', 'Unnamed')}")
                        if playlist_config.get('description'):
                            print(f"Config description: {playlist_config.get('description')}")
                        print(f"Config NSFW: {playlist_config.get('nsfw', False)}")
                else:
                    if not playlist_config:
                        print("\nError: No playlist configuration found and no existing playlist UUID provided.")
                        print("Either provide 'playlist_uuid' or 'playlist' configuration in job.json")
                        sys.exit(1)
                    else:
                        playlist_data: CreatePlaylistRequest = {
                            "name": playlist_config.get("name", "Unnamed Playlist"),
                            "description": playlist_config.get("description"),
                            "nsfw": playlist_config.get("nsfw", False),
                        }
                        
                        print(f"\nCreating playlist: {playlist_data['name']}...")
                        if playlist_config.get('description'):
                            print(f"Description: {playlist_config.get('description')}")
                        print(f"NSFW: {playlist_config.get('nsfw', False)}")
                        playlist = client.create_playlist(playlist_data)
                        print(f"Playlist created: {playlist['uuid']}")
                
                print(f"\nWaiting for {len(job_ids)} jobs to complete...")
                print("(Videos will be uploaded as they complete)")
                
                processed_jobs = set()
                uploaded_count = 0
                max_wait_time = 3600
                poll_interval = 10
                start_time = time.time()
                temp_dir = Path(tempfile.mkdtemp(prefix="wan_i2v_videos_"))
                
                try:
                    while job_ids and (time.time() - start_time) < max_wait_time:
                        remaining_jobs = []
                        for job_id, job_identifier, image_name, combo_idx, image_path in job_ids:
                            if job_id in processed_jobs:
                                continue
                                
                            result = get_job_result_from_redis(job_id)
                            if result and result.get("r2_url"):
                                r2_url = result["r2_url"]
                                print(f"\nJob {job_id} completed - processing now...")
                                
                                try:
                                    temp_file = temp_dir / f"video_{job_id}.mp4"
                                    print(f"  Downloading from R2...")
                                    
                                    if client.download_file(r2_url, str(temp_file)):
                                        print(f"  Downloaded, creating dream and adding to playlist...")
                                        dream_name = f"{image_name}_combo-{combo_idx}"
                                        dream = client.add_file_to_playlist(playlist["uuid"], str(temp_file), name=dream_name)
                                        
                                        if not dream:
                                            raise Exception("add_file_to_playlist returned None")
                                        if "uuid" not in dream:
                                            raise Exception(f"Dream object missing uuid: {dream}")
                                        
                                        keyframe_uuid = None
                                        try:
                                            print(f"  Creating keyframe for dream: {dream_name}...")
                                            keyframe = client._create_keyframe(
                                                name=dream_name,
                                                file_path=str(image_path)
                                            )
                                            keyframe_uuid = keyframe["uuid"]
                                            print(f"  Keyframe created: {keyframe['uuid']}")
                                            
                                            print(f"  Adding keyframe to playlist...")
                                            client._add_keyframe_to_playlist(
                                                playlist["uuid"],
                                                keyframe_uuid
                                            )
                                            print(f"  Keyframe added to playlist")
                                        except Exception as e:
                                            print(f"  Warning: Could not create/add keyframe: {e}")
                                        
                                        try:
                                            current_desc = dream.get("description") or ""
                                            identifier_text = f"BATCH_IDENTIFIER:{job_identifier}"
                                            if identifier_text not in current_desc:
                                                new_desc = f"{current_desc} {identifier_text}".strip()
                                            else:
                                                new_desc = current_desc
                                            
                                            update_data = {
                                                "description": new_desc
                                            }
                                            if keyframe_uuid:
                                                update_data["startKeyframe"] = keyframe_uuid
                                                update_data["endKeyframe"] = keyframe_uuid
                                            
                                            if update_data:
                                                client.update_dream(dream["uuid"], update_data)
                                        except Exception as e:
                                            print(f"  Warning: Could not update dream: {e}")
                                        
                                        print(f"  Added to playlist (dream: {dream['uuid']}, name: {dream_name})")
                                        uploaded_count += 1
                                        processed_jobs.add(job_id)
                                        
                                        temp_file.unlink(missing_ok=True)
                                    else:
                                        print(f"  Failed to download, will retry...")
                                        remaining_jobs.append((job_id, job_identifier, image_name, combo_idx, image_path))
                                except Exception as e:
                                    import traceback
                                    error_msg = str(e)
                                    if isinstance(e, KeyError):
                                        error_msg = f"KeyError: Missing key '{e}'. Full error: {type(e).__name__}: {e}"
                                    print(f"  Error processing job {job_id}: {error_msg}", file=sys.stderr)
                                    print(f"  Full traceback:", file=sys.stderr)
                                    traceback.print_exc(file=sys.stderr)
                                    remaining_jobs.append((job_id, job_identifier, image_name, combo_idx, image_path))
                            else:
                                remaining_jobs.append((job_id, job_identifier, image_name, combo_idx, image_path))
                        
                        job_ids = remaining_jobs
                        
                        if not job_ids:
                            break
                        
                        print(f"  Waiting for {len(job_ids)} more jobs...")
                        time.sleep(poll_interval)
                    
                    if job_ids:
                        print(f"\nTimeout: {len(job_ids)} jobs did not complete in time")
                    
                    print(f"\nPlaylist processing complete!")
                    print(f"  Playlist UUID: {playlist['uuid']}")
                    print(f"  Videos uploaded: {uploaded_count}")
                    if job_ids:
                        print(f"  Jobs not completed: {len(job_ids)}")
                    
                    if uploaded_count > 0:
                        print(f"\nReordering playlist items by image name...")
                        try:
                            items_response = client.get_playlist_items(playlist["uuid"])
                            all_items = items_response.get("items", [])
                            
                            dream_items = [
                                item for item in all_items
                                if item.get("type") == "dream" and item.get("dreamItem")
                            ]
                            
                            def extract_sort_key(item):
                                dream = item.get("dreamItem", {})
                                name = dream.get("name", "")
                                
                                if "_combo-" in name:
                                    parts = name.rsplit("_combo-", 1)
                                    image_name = parts[0]
                                    try:
                                        combo_idx = int(parts[1])
                                    except (ValueError, IndexError):
                                        combo_idx = 0
                                    return (image_name, combo_idx)
                                else:
                                    return (name, 0)
                            
                            dream_items.sort(key=extract_sort_key)
                            
                            order_array = [
                                {"id": item["id"], "order": idx + 1}
                                for idx, item in enumerate(dream_items)
                            ]
                            
                            if order_array:
                                client.reorder_playlist(playlist["uuid"], order_array)
                                print(f"  Reordered {len(order_array)} dream(s)")
                            else:
                                print(f"  No dreams found to reorder")
                        except Exception as e:
                            print(f"  Warning: Could not reorder playlist: {e}")
                finally:
                    import shutil
                    shutil.rmtree(temp_dir, ignore_errors=True)
        except ImportError:
            print("\nSkipping playlist creation - edream_sdk not installed.")
            print("Install it with: pip install -r requirements.txt")
    
    print("\nNote: Jobs are now in Redis queue and will be processed by the worker.")
    
    if failed_jobs > 0:
        sys.exit(1)


def test_redis_job(job_id: str, queue_name: str = "wani2v", test_full_flow: bool = False):
    """Test function to read job result from Redis by job ID and optionally test full playlist flow."""
    print(f"Testing Redis job lookup for job ID: {job_id}")
    print(f"Queue name: {queue_name}")
    if test_full_flow:
        print("Full flow test: ENABLED (will create playlist and upload video)")
    print("=" * 60)
    
    try:
        import redis
        
        redis_url = os.environ.get("REDISCLOUD_URL")
        if redis_url:
            print(f"Connecting to Redis via REDISCLOUD_URL...")
            redis_client = redis.from_url(redis_url, decode_responses=False)
        else:
            redis_host = os.environ.get("REDIS_HOST", "localhost")
            redis_port = int(os.environ.get("REDIS_PORT", "6379"))
            redis_password = os.environ.get("REDIS_PASSWORD", "")
            print(f"Connecting to Redis at {redis_host}:{redis_port}...")
            redis_client = redis.Redis(
                host=redis_host,
                port=redis_port,
                password=redis_password if redis_password else None,
                decode_responses=False
            )
        
        job_key = f"bull:{queue_name}:{job_id}"
        print(f"\nLooking for key: {job_key}")
        
        job_hash = redis_client.hgetall(job_key)
        
        if not job_hash:
            print(f"\nJob not found in Redis!")
            print(f"Key '{job_key}' does not exist or is empty.")
            return None
        
        print(f"\nJob found! Hash contains {len(job_hash)} field(s)")
        print("\nAll fields in job hash:")
        for key, value in job_hash.items():
            key_str = key.decode('utf-8') if isinstance(key, bytes) else str(key)
            value_preview = str(value)[:100] if value else "None"
            if len(str(value)) > 100:
                value_preview += "..."
            print(f"  - {key_str}: {value_preview}")
        
        returnvalue_bytes = job_hash.get(b"returnvalue") or job_hash.get("returnvalue")
        
        if not returnvalue_bytes:
            print(f"\nNo 'returnvalue' field found in job hash")
            print("Job may not be completed yet.")
            return None
        
        print(f"\nFound 'returnvalue' field")
        
        if isinstance(returnvalue_bytes, bytes):
            returnvalue_str = returnvalue_bytes.decode('utf-8')
        else:
            returnvalue_str = str(returnvalue_bytes)
        
        print(f"\nReturnvalue (raw): {returnvalue_str[:200]}...")
        
        try:
            result = json.loads(returnvalue_str)
            print(f"\nSuccessfully parsed returnvalue as JSON")
            print(f"\nParsed result:")
            print(json.dumps(result, indent=2))
            
            if isinstance(result, dict):
                r2_url = result.get("r2_url")
                video_url = result.get("video_url")
                result_url = result.get("result")
                
                print(f"\nExtracted URLs:")
                if r2_url:
                    print(f"  r2_url: {r2_url}")
                else:
                    print(f"  r2_url: Not found")
                
                if video_url:
                    print(f"  video_url: {video_url}")
                if result_url:
                    print(f"  result: {result_url}")
                
                if r2_url:
                    print(f"\nSUCCESS: Job has r2_url, ready for playlist!")
                    
                    if test_full_flow:
                        print("\n" + "=" * 60)
                        print("Testing Full Playlist Flow")
                        print("=" * 60)
                        
                        backend_url = os.environ.get("BACKEND_URL")
                        api_key = os.environ.get("API_KEY")
                        
                        if not backend_url or not api_key:
                            print("\nSkipping playlist test - missing environment variables:")
                            if not backend_url:
                                print("  - BACKEND_URL")
                            if not api_key:
                                print("  - API_KEY")
                            print("\nSet these in .env to test playlist creation.")
                            return result
                        
                        try:
                            from edream_sdk.client import create_edream_client
                            from edream_sdk.types.playlist_types import CreatePlaylistRequest
                            
                            print(f"\nAPI credentials found")
                            print(f"  Backend: {backend_url}")
                            
                            client = create_edream_client(backend_url, api_key)
                            
                            playlist_data: CreatePlaylistRequest = {
                                "name": f"Test Playlist - Job {job_id}",
                                "description": f"Test playlist created from job {job_id}",
                                "nsfw": False,
                            }
                            
                            print(f"\nCreating test playlist...")
                            playlist = client.create_playlist(playlist_data)
                            print(f"Playlist created: {playlist['uuid']}")
                            print(f"  Name: {playlist.get('name', 'N/A')}")
                            
                            print(f"\nDownloading video from R2...")
                            print(f"  URL: {r2_url[:100]}...")
                            
                            temp_dir = Path(tempfile.mkdtemp(prefix="test_wan_i2v_"))
                            temp_file = temp_dir / f"video_{job_id}.mp4"
                            
                            if client.download_file(r2_url, str(temp_file)):
                                print(f"  Downloaded to: {temp_file}")
                                print(f"  File size: {temp_file.stat().st_size / 1024 / 1024:.2f} MB")
                                
                                print(f"\nUploading video to playlist...")
                                dream = client.add_file_to_playlist(playlist["uuid"], str(temp_file))
                                print(f"  Dream created: {dream['uuid']}")
                                print(f"  Dream name: {dream.get('name', 'N/A')}")
                                
                                import shutil
                                shutil.rmtree(temp_dir, ignore_errors=True)
                                print(f"\nCleaned up temporary files")
                                
                                print(f"\n" + "=" * 60)
                                print("FULL FLOW TEST SUCCESSFUL!")
                                print("=" * 60)
                                print(f"Playlist UUID: {playlist['uuid']}")
                                print(f"Dream UUID: {dream['uuid']}")
                                print(f"\nYou can view the playlist in your dashboard.")
                            else:
                                print(f"  Failed to download video from R2")
                                import shutil
                                shutil.rmtree(temp_dir, ignore_errors=True)
                                
                        except ImportError:
                            print("\nError: edream_sdk not installed")
                            print("Install it with: pip install -r requirements.txt")
                        except Exception as e:
                            print(f"\nError during playlist test: {e}")
                            import traceback
                            traceback.print_exc()
                    
                    return result
                else:
                    print(f"\nWARNING: No r2_url found in result")
                    if test_full_flow:
                        print("Cannot test full flow without r2_url")
                    return result
            else:
                print(f"\nResult is not a dict: {type(result)}")
                return {"r2_url": returnvalue_str} if returnvalue_str else None
                
        except json.JSONDecodeError as e:
            print(f"\nFailed to parse returnvalue as JSON: {e}")
            print(f"Treating as string URL: {returnvalue_str}")
            return {"r2_url": returnvalue_str} if returnvalue_str else None
            
    except ImportError:
        print("\nError: redis module not installed")
        print("Install it with: pip install redis")
        return None
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        if len(sys.argv) < 3:
            print("Usage: python3 run_wan_i2v_batch.py test <job_id> [queue_name] [--full]")
            print("Example: python3 run_wan_i2v_batch.py test 28 wani2v")
            print("Example: python3 run_wan_i2v_batch.py test 28 wani2v --full")
            print("Example: python3 run_wan_i2v_batch.py test 28 --full")
            sys.exit(1)
        
        job_id = sys.argv[2]
        test_full_flow = "--full" in sys.argv
        
        queue_name = "wani2v"
        for arg in sys.argv[3:]:
            if arg != "--full":
                queue_name = arg
                break
        
        test_redis_job(job_id, queue_name, test_full_flow)
    else:
        main()

