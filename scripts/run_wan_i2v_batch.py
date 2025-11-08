import json
import os
import subprocess
import sys
import time
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional
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
    
    print("\n" + "="*60)
    print("Queueing jobs to Redis...")
    print("="*60)
    
    def queue_single_job(args: Tuple[int, int, Path, str]) -> Tuple[int, bool, str, Optional[str]]:
        """Queue a single job and return (job_number, success, message, job_id)."""
        job_count, image_idx, image_path_obj, combo = args
        combo_idx = combos.index(combo) + 1
        
        try:
            job_json = create_job_json(job_config, image_path_obj, combo, worker_dir)
        except Exception as e:
            return (job_count, False, f"Error creating job JSON: {e}", None)
        
        try:
            result, job_id = queue_job_via_cli(job_json, worker_dir)
            if result.returncode == 0:
                return (job_count, True, f"{image_path_obj.name} + combo {combo_idx}", job_id)
            else:
                error_msg = result.stderr.strip() if hasattr(result, 'stderr') and result.stderr else "Unknown error"
                return (job_count, False, f"Return code {result.returncode}: {error_msg}", None)
        except Exception as e:
            return (job_count, False, f"Error: {e}", None)
    
    job_args = []
    job_count = 0
    for image_idx, image_path_obj in enumerate(images, 1):
        for combo in combos:
            job_count += 1
            job_args.append((job_count, image_idx, image_path_obj, combo))
    
    successful_jobs = 0
    failed_jobs = 0
    job_ids = []
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_job = {executor.submit(queue_single_job, args): args[0] for args in job_args}
        
        for future in as_completed(future_to_job):
            job_num = future_to_job[future]
            try:
                job_num_result, success, message, job_id = future.result()
                
                if success:
                    print(f"[{job_num_result}/{total_jobs}] {message}")
                    successful_jobs += 1
                    if job_id:
                        job_ids.append(job_id)
                else:
                    print(f"[{job_num_result}/{total_jobs}] Failed: {message}", file=sys.stderr)
                    failed_jobs += 1
            except Exception as e:
                print(f"[{job_num}/{total_jobs}] Exception: {e}", file=sys.stderr)
                failed_jobs += 1
    
    print("\n" + "="*60)
    print("Queueing Summary")
    print("="*60)
    print(f"Total jobs: {total_jobs}")
    print(f"Successfully queued: {successful_jobs}")
    print(f"Failed to queue: {failed_jobs}")
    print(f"Jobs to track: {len(job_ids)}")
    
    playlist_config = job_config.get("playlist")
    if playlist_config and job_ids:
        print("\n" + "="*60)
        print("Playlist Configuration")
        print("="*60)
        print(f"Playlist name: {playlist_config.get('name', 'Unnamed')}")
        if playlist_config.get('description'):
            print(f"Description: {playlist_config.get('description')}")
        print(f"NSFW: {playlist_config.get('nsfw', False)}")
        
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
                playlist_data: CreatePlaylistRequest = {
                    "name": playlist_config.get("name", "Unnamed Playlist"),
                    "description": playlist_config.get("description"),
                    "nsfw": playlist_config.get("nsfw", False),
                }
                
                print(f"\nCreating playlist: {playlist_data['name']}...")
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
                        for job_id in job_ids:
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
                                        dream = client.add_file_to_playlist(playlist["uuid"], str(temp_file))
                                        print(f"  Added to playlist (dream: {dream['uuid']})")
                                        uploaded_count += 1
                                        processed_jobs.add(job_id)
                                        
                                        temp_file.unlink(missing_ok=True)
                                    else:
                                        print(f"  Failed to download, will retry...")
                                        remaining_jobs.append(job_id)
                                except Exception as e:
                                    print(f"  Error processing job {job_id}: {e}", file=sys.stderr)
                                    remaining_jobs.append(job_id)
                            else:
                                remaining_jobs.append(job_id)
                        
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

