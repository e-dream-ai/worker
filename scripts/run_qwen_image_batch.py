import json
import os
import subprocess
import sys
import time
import tempfile
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from dotenv import load_dotenv
import requests

worker_dir = Path(__file__).parent.parent
load_dotenv(worker_dir / ".env")


def load_config(script_dir: Path) -> Dict[str, Any]:
    """Load qwen-image-config.json from scripts directory."""
    config_file = script_dir / "qwen-image-config.json"
    if not config_file.exists():
        raise FileNotFoundError(f"qwen-image-config.json not found at {config_file}")
    
    with open(config_file, 'r') as f:
        return json.load(f)


def create_job_json(
    base_config: Dict[str, Any],
    prompt: str,
    seed: Optional[int] = None
) -> Dict[str, Any]:
    """Create a job JSON for a single image generation."""
    job_json = {
        "infinidream_algorithm": "qwen-image",
        "prompt": prompt,
    }
    
    params_to_copy = [
        "size", "negative_prompt", "enable_safety_checker"
    ]
    
    for param in params_to_copy:
        if param in base_config:
            job_json[param] = base_config[param]
    
    if seed is not None:
        job_json["seed"] = seed
    elif "seed" in base_config:
        job_json["seed"] = base_config["seed"]
    else:
        job_json["seed"] = -1
    
    return job_json


def get_job_result_from_redis(job_id: str, queue_name: str = "qwenimage") -> Optional[Dict[str, Any]]:
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
    queue_js = worker_dir / "dist" / "queue-qwen-image.js"
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


def download_image(url: str, output_path: Path) -> bool:
    """Download an image from a URL to a local file."""
    try:
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return True
    except Exception as e:
        print(f"Error downloading image from {url}: {e}", file=sys.stderr)
        return False


def main():
    """Main execution function."""
    script_file = Path(__file__).resolve()
    scripts_dir = script_file.parent
    worker_dir = scripts_dir.parent
    
    print(f"Worker directory: {worker_dir}")
    print(f"Scripts directory: {scripts_dir}")
    
    print("\nLoading qwen-image-config.json...")
    try:
        config = load_config(scripts_dir)
        print(f"Loaded qwen-image-config.json")
    except Exception as e:
        print(f"Error loading qwen-image-config.json: {e}", file=sys.stderr)
        sys.exit(1)
    
    prompt = config.get("prompt")
    if not prompt:
        print("'prompt' not found in qwen-image-config.json", file=sys.stderr)
        sys.exit(1)
    
    num_generations = config.get("num_generations", 1)
    if num_generations < 1:
        print("'num_generations' must be at least 1", file=sys.stderr)
        sys.exit(1)
    
    output_folder = config.get("output_folder", "generated-images")
    if not output_folder:
        print("'output_folder' not specified in qwen-image-config.json", file=sys.stderr)
        sys.exit(1)
    
    # Resolve output folder path
    if os.path.isabs(output_folder):
        output_dir = Path(output_folder)
    else:
        output_dir = worker_dir / output_folder
    
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nOutput directory: {output_dir}")
    
    print(f"\nPrompt: {prompt}")
    print(f"Number of generations: {num_generations}")
    
    print("\n" + "="*60)
    print("Queueing jobs to Redis...")
    print("="*60)
    
    successful_jobs = 0
    failed_jobs = 0
    job_ids = []
    
    for idx in range(1, num_generations + 1):
        seed = config.get("seed")
        if seed is None or seed == -1:
            # Use different seed for each generation if seed is -1 or not specified
            seed = -1 if idx == 1 else None
        
        try:
            job_json = create_job_json(config, prompt, seed)
        except Exception as e:
            print(f"[{idx}/{num_generations}] Failed: Error creating job JSON: {e}", file=sys.stderr)
            failed_jobs += 1
            continue
        
        try:
            result, job_id = queue_job_via_cli(job_json, worker_dir)
            if result.returncode == 0:
                print(f"[{idx}/{num_generations}] Queued job")
                successful_jobs += 1
                if job_id:
                    job_ids.append((job_id, idx))
            else:
                error_msg = result.stderr.strip() if hasattr(result, 'stderr') and result.stderr else "Unknown error"
                print(f"[{idx}/{num_generations}] Failed: Return code {result.returncode}: {error_msg}", file=sys.stderr)
                failed_jobs += 1
        except Exception as e:
            print(f"[{idx}/{num_generations}] Failed: Error: {e}", file=sys.stderr)
            failed_jobs += 1
    
    print("\n" + "="*60)
    print("Queueing Summary")
    print("="*60)
    print(f"Total jobs: {num_generations}")
    print(f"Successfully queued: {successful_jobs}")
    print(f"Failed to queue: {failed_jobs}")
    print(f"Jobs to track: {len(job_ids)}")
    
    if job_ids:
        print(f"\nWaiting for {len(job_ids)} jobs to complete...")
        print("(Images will be downloaded as they complete)")
        
        processed_jobs = set()
        downloaded_count = 0
        max_wait_time = 3600
        poll_interval = 10
        start_time = time.time()
        
        try:
            while job_ids and (time.time() - start_time) < max_wait_time:
                remaining_jobs = []
                for job_id, gen_idx in job_ids:
                    if job_id in processed_jobs:
                        continue
                    
                    result = get_job_result_from_redis(job_id)
                    if result and result.get("r2_url"):
                        r2_url = result["r2_url"]
                        print(f"\nJob {job_id} (generation {gen_idx}) completed - downloading now...")
                        
                        try:
                            # Determine filename
                            base_filename = config.get("output_filename", "qwen-image")
                            if num_generations > 1:
                                filename = f"{base_filename}_{gen_idx:04d}.png"
                            else:
                                filename = f"{base_filename}.png"
                            
                            output_path = output_dir / filename
                            
                            if download_image(r2_url, output_path):
                                print(f"  Downloaded to: {output_path}")
                                downloaded_count += 1
                                processed_jobs.add(job_id)
                            else:
                                print(f"  Failed to download, will retry...")
                                remaining_jobs.append((job_id, gen_idx))
                        except Exception as e:
                            import traceback
                            error_msg = str(e)
                            print(f"  Error processing job {job_id}: {error_msg}", file=sys.stderr)
                            print(f"  Full traceback:", file=sys.stderr)
                            traceback.print_exc(file=sys.stderr)
                            remaining_jobs.append((job_id, gen_idx))
                    else:
                        remaining_jobs.append((job_id, gen_idx))
                
                job_ids = remaining_jobs
                
                if not job_ids:
                    break
                
                print(f"  Waiting for {len(job_ids)} more jobs...")
                time.sleep(poll_interval)
            
            if job_ids:
                print(f"\nTimeout: {len(job_ids)} jobs did not complete in time")
            
            print(f"\nDownload complete!")
            print(f"  Output directory: {output_dir}")
            print(f"  Images downloaded: {downloaded_count}")
            if job_ids:
                print(f"  Jobs not completed: {len(job_ids)}")
        except KeyboardInterrupt:
            print(f"\n\nInterrupted by user")
            print(f"  Images downloaded so far: {downloaded_count}")
            print(f"  Remaining jobs: {len(job_ids)}")
            sys.exit(1)
    
    print("\nNote: Jobs are now in Redis queue and will be processed by the worker.")
    
    if failed_jobs > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

