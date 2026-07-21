"""FastAPI entry point for the Snap & Shine image enhancement service."""

import asyncio
import base64
import hashlib
import io
import logging
import os
import random
import shutil
import sqlite3
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image, UnidentifiedImageError

load_dotenv()

OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
MAX_BATCH_FILES = 100

# Output image constraints
MAX_OUTPUT_WIDTH = 1448
MAX_OUTPUT_HEIGHT = 1086
MIN_OUTPUT_KB = 900   # min ~0.9MB
MAX_OUTPUT_KB = 1100  # max ~1.1MB

# Batch processing
CONCURRENCY_LIMIT = int(os.getenv("MAX_CONCURRENT_JOBS", "5"))
MAX_RETRIES = 4
RETRY_BASE_DELAYS = [2.0, 4.0, 8.0, 16.0]  # base seconds; random jitter is added per attempt
RETRYABLE_CODES = {429, 500, 502, 503}

DB_PATH = Path("snap_shine_jobs.db")
JOB_INPUTS_DIR = Path("job_inputs")  # original uploads kept here for resume support
JOB_TTL_DAYS = 7                      # completed/cancelled jobs older than this are purged

# Input validation
SUPPORTED_FORMATS = frozenset({"JPEG", "PNG", "WEBP", "BMP", "TIFF"})
MAX_INPUT_KB = 20_000         # reject uploads larger than 20 MB
MIN_INPUT_DIMENSION = 64      # reject images smaller than 64×64 px

# Pipeline metadata & cost
PIPELINE_VERSION = "1.0.0"
COST_PER_IMAGE_USD = float(os.getenv("COST_PER_IMAGE_USD", "0.08"))  # gpt-image-1 high quality estimate

ENHANCEMENT_PROMPT = (
"You are a professional product photographer and high-end photo retoucher. Your task is to enhance the existing product photograph—not redesign, recreate, replace, or illustrate it."
"The product in the output must be the exact same physical object shown in the input image."
"Do NOT change anything about the product itself."
"Keep the exact shape and dimensions."
"Keep the exact color and finish."
"Preserve all engravings, logos, text, markings, serial numbers, patterns, stitching, screws, and decorative details."
"Preserve all materials, textures, grain, scratches, reflections, and natural imperfections."
"Keep the same viewing angle, perspective, orientation, focal length, and proportions."
"Do not add, remove, invent, or modify any feature of the product."
"Your job is only to improve the photography."
"Specifically:"
"1. Replace the background with a seamless pure white (#FFFFFF) studio background."
"2. Apply realistic professional studio lighting:"
"• Soft key light from the upper left."
"• Gentle fill light from the right."
"• Subtle rim light for depth and separation."
"• Balanced exposure with natural highlights and shadows."
"3. Add a very soft natural contact shadow directly beneath the product so it appears realistically grounded."
"4. Improve sharpness, clarity, dynamic range, and color accuracy while preserving every authentic surface detail."
"5. Remove only dust, sensor spots, background distractions, and image noise."
"6. Maintain realistic reflections and metallic surfaces. Do not create artificial reflections or glossy effects."
"7. Preserve the original crop, framing, and composition unless additional whitespace is needed for a clean studio presentation."
"The final result should be indistinguishable from a real photograph taken in a professional commercial studio using high-end camera equipment."
"It must never appear:"
"• AI-generated."
"• Illustrated."
"• Painted."
"• Synthetic."
"• Stylized."
"• 3D rendered."
"• CGI."
"The output should be suitable for premium e-commerce platforms including Amazon, Shopify, luxury retail websites, catalogs, and printed marketing materials."
" For knives, preserve the exact blade profile, grind, edge geometry, handle shape, wood grain, Damascus pattern (if present), hardware, rivets, screws, pins, "
"bolsters, lanyard holes, sheath, and all manufacturer markings. Do not alter blade length, handle proportions, finish, or edge appearance."
)

logger = logging.getLogger(__name__)

_semaphore: asyncio.Semaphore                    # initialised in lifespan
_cancelled_jobs: Set[str] = set()                # job IDs requested for cancellation
_running_items: Set[Tuple[str, int]] = set()     # (job_id, idx) currently in-flight


# ===========================================================================
# Database initialisation & housekeeping
# ===========================================================================

def _init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id         TEXT    PRIMARY KEY,
                status     TEXT    NOT NULL DEFAULT 'queued',
                total      INTEGER NOT NULL,
                succeeded  INTEGER NOT NULL DEFAULT 0,
                failed     INTEGER NOT NULL DEFAULT 0,
                started_at REAL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS job_items (
                job_id           TEXT    NOT NULL REFERENCES jobs(id),
                idx              INTEGER NOT NULL,
                filename         TEXT    NOT NULL,
                success          INTEGER NOT NULL DEFAULT 0,
                error            TEXT,
                image            TEXT,
                input_path       TEXT,
                duration_s       REAL,
                input_hash       TEXT,
                pipeline_version TEXT,
                estimated_cost   REAL,
                from_cache       INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (job_id, idx)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS image_cache (
                input_hash TEXT    PRIMARY KEY,
                output_b64 TEXT    NOT NULL,
                created_at REAL    NOT NULL
            )
        """)
        # Idempotent migrations for pre-existing databases
        for ddl in [
            "ALTER TABLE jobs ADD COLUMN started_at REAL",
            "ALTER TABLE job_items ADD COLUMN input_path TEXT",
            "ALTER TABLE job_items ADD COLUMN duration_s REAL",
            "ALTER TABLE job_items ADD COLUMN input_hash TEXT",
            "ALTER TABLE job_items ADD COLUMN pipeline_version TEXT",
            "ALTER TABLE job_items ADD COLUMN estimated_cost REAL",
            "ALTER TABLE job_items ADD COLUMN from_cache INTEGER NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass  # column already exists
        conn.commit()


def _db_cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_DAYS * 86_400
    with sqlite3.connect(DB_PATH) as conn:
        old = conn.execute(
            "SELECT id FROM jobs WHERE status IN ('done','cancelled') AND started_at < ?",
            (cutoff,),
        ).fetchall()
        for (job_id,) in old:
            job_dir = JOB_INPUTS_DIR / job_id
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            conn.execute("DELETE FROM job_items WHERE job_id=?", (job_id,))
            conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        if old:
            logger.info("Purged %d expired job(s)", len(old))
        conn.commit()


async def _cleanup_loop() -> None:
    """Hourly housekeeping: purge jobs older than JOB_TTL_DAYS."""
    while True:
        await asyncio.sleep(3_600)
        try:
            await asyncio.to_thread(_db_cleanup_old_jobs)
        except Exception:
            logger.exception("Cleanup task failed")


# ===========================================================================
# Startup resume helpers
# ===========================================================================

def _db_get_pending_jobs() -> List[Dict[str, Any]]:
    """Return jobs that were interrupted (not done/cancelled) with their still-pending items."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        jobs = conn.execute(
            "SELECT id FROM jobs WHERE status NOT IN ('done', 'cancelled')"
        ).fetchall()
        result = []
        for job_row in jobs:
            job_id = job_row["id"]
            items = conn.execute(
                "SELECT idx, filename, input_path FROM job_items "
                "WHERE job_id=? AND success=0 AND error IS NULL",
                (job_id,),
            ).fetchall()
            result.append({"job_id": job_id, "items": [dict(r) for r in items]})
    return result


async def _resume_interrupted_jobs(api_key: str) -> None:
    pending = await asyncio.to_thread(_db_get_pending_jobs)
    for job in pending:
        job_id = job["job_id"]
        resumable = []
        for item in job["items"]:
            input_path = item.get("input_path")
            if not input_path or not Path(input_path).exists():
                await asyncio.to_thread(
                    _db_save_item, job_id, item["idx"], False, None,
                    "Input file unavailable after server restart.", None,
                )
                continue
            resumable.append({
                "idx": item["idx"],
                "filename": item["filename"],
                "bytes": Path(input_path).read_bytes(),
                "content_type": "image/jpeg",
            })
        if resumable:
            logger.info("Resuming job %s — %d pending image(s)", job_id, len(resumable))
            asyncio.create_task(_run_batch_job(job_id, resumable, api_key))
        else:
            await asyncio.to_thread(_db_finish_job, job_id, "done")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _semaphore
    _semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)
    JOB_INPUTS_DIR.mkdir(exist_ok=True)
    _init_db()
    cleanup_task = asyncio.create_task(_cleanup_loop())
    api_key = os.getenv("OPENAI_API_KEY", "")
    if api_key:
        await _resume_interrupted_jobs(api_key)
    yield
    cleanup_task.cancel()


app = FastAPI(title="Maslool Snap & Shine API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing required environment variable: {name}")
    return value


def _validate_input(file_bytes: bytes, filename: str = "") -> Tuple[int, int]:
    """Validate the uploaded image. Returns (width, height). Raises HTTPException on failure."""
    if len(file_bytes) > MAX_INPUT_KB * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(file_bytes) // 1024} KB). Maximum is {MAX_INPUT_KB} KB.",
        )
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            img.verify()
        with Image.open(io.BytesIO(file_bytes)) as img:
            fmt = img.format or ""
            width, height = img.size
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Please upload a valid image file.") from exc
    if fmt.upper() not in SUPPORTED_FORMATS:
        supported = ", ".join(sorted(SUPPORTED_FORMATS))
        raise HTTPException(status_code=400, detail=f"Unsupported format '{fmt}'. Supported: {supported}.")
    if width < MIN_INPUT_DIMENSION or height < MIN_INPUT_DIMENSION:
        raise HTTPException(
            status_code=400,
            detail=f"Image too small ({width}×{height} px). Minimum is {MIN_INPUT_DIMENSION}×{MIN_INPUT_DIMENSION} px.",
        )
    return width, height


def _compress_output(image_bytes: bytes) -> bytes:
    """Resize and compress the enhanced image to fit within size and dimension limits."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        # Convert to RGB (remove alpha if any)
        if img.mode in ("RGBA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "RGBA":
                background.paste(img, mask=img.split()[3])
            else:
                background.paste(img)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Resize if too large
        img.thumbnail((MAX_OUTPUT_WIDTH, MAX_OUTPUT_HEIGHT), Image.LANCZOS)

        # Compress to JPEG; target between MIN_OUTPUT_KB and MAX_OUTPUT_KB
        quality = 95
        prev_buffer: Optional[io.BytesIO] = None
        while quality >= 60:
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            size_kb = buffer.tell() / 1024
            if size_kb <= MAX_OUTPUT_KB:
                # Prefer this if it meets the minimum; otherwise keep the
                # previous over-max buffer (closer to the target floor).
                if size_kb >= MIN_OUTPUT_KB or prev_buffer is None:
                    break
                buffer = prev_buffer
                break
            prev_buffer = buffer
            quality -= 5

        return buffer.getvalue()


def _get_output_metadata(b64_image: str) -> Dict[str, Any]:
    """Verify the output image is valid and return dimensional metadata."""
    raw = base64.b64decode(b64_image)
    if not raw:
        raise HTTPException(status_code=502, detail="Output image is empty.")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
        with Image.open(io.BytesIO(raw)) as img:
            width, height = img.size
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Output image failed integrity check.") from exc
    return {
        "output_width": width,
        "output_height": height,
        "output_size_kb": round(len(raw) / 1024, 1),
        "output_hash": hashlib.sha256(raw).hexdigest(),
    }


def _db_get_cached(input_hash: str) -> Optional[str]:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT output_b64 FROM image_cache WHERE input_hash=?", (input_hash,)
        ).fetchone()
    return row[0] if row else None


def _db_set_cached(input_hash: str, output_b64: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO image_cache (input_hash, output_b64, created_at) VALUES (?, ?, ?)",
            (input_hash, output_b64, time.time()),
        )
        conn.commit()


def _db_get_metrics() -> Dict[str, Any]:
    now = time.time()
    today_start = now - (now % 86_400)  # UTC midnight

    with sqlite3.connect(DB_PATH) as conn:
        today = conn.execute("""
            SELECT COUNT(*) AS cnt, SUM(ji.success) AS ok, AVG(ji.duration_s) AS avg_d
            FROM job_items ji
            JOIN jobs j ON j.id = ji.job_id
            WHERE j.started_at >= ?
        """, (today_start,)).fetchone()

        overall = conn.execute("""
            SELECT COUNT(*) AS total, SUM(success) AS succeeded,
                   AVG(duration_s) AS avg_d, SUM(estimated_cost) AS total_cost,
                   SUM(from_cache) AS cache_hits
            FROM job_items
        """).fetchone()

        active_jobs = conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE status NOT IN ('done','cancelled')"
        ).fetchone()[0]

        queue_len = conn.execute("""
            SELECT COUNT(*) FROM job_items
            WHERE success=0 AND error IS NULL
              AND job_id IN (SELECT id FROM jobs WHERE status NOT IN ('done','cancelled'))
        """).fetchone()[0]

        cache_size = conn.execute("SELECT COUNT(*) FROM image_cache").fetchone()[0]

    today_cnt = today[0] or 0
    today_ok = today[1] or 0
    return {
        "pipeline_version": PIPELINE_VERSION,
        "images_today": today_cnt,
        "success_rate_today": round(today_ok / today_cnt, 3) if today_cnt > 0 else None,
        "avg_duration_s_today": round(today[2], 1) if today[2] else None,
        "total_processed": overall[0] or 0,
        "total_succeeded": overall[1] or 0,
        "avg_duration_s": round(overall[2], 1) if overall[2] else None,
        "total_cost_usd": round(overall[3], 4) if overall[3] else 0.0,
        "cache_hits": overall[4] or 0,
        "cache_size": cache_size,
        "active_jobs": active_jobs,
        "queue_length": queue_len,
    }


def _enhance_image(file_bytes: bytes, filename: str, content_type: str, api_key: str) -> str:
    """Send the raw upload to OpenAI gpt-image-1 at highest quality, compress output, return base64 JPEG."""
    try:
        response = requests.post(
            OPENAI_IMAGE_EDIT_URL,
            headers={"Authorization": "Bearer " + api_key},
            files={"image": (filename, file_bytes, content_type)},
            data={
                "model": "gpt-image-1",
                "prompt": ENHANCEMENT_PROMPT,
                "size": "1536x1024",
                "quality": "high",
            },
            timeout=180,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Image enhancement failed: could not reach OpenAI.") from exc

    if response.status_code != 200:
        message = response.text or "OpenAI could not enhance the image."
        # Preserve retryable codes so the retry wrapper knows to back off
        status = response.status_code if response.status_code in RETRYABLE_CODES else 502
        raise HTTPException(status_code=status, detail=f"Image enhancement failed: {message}")

    payload: Dict[str, Any] = response.json()
    data = payload.get("data")
    if not data:
        raise HTTPException(status_code=502, detail="OpenAI did not return an enhanced image.")

    first_result = data[0]
    raw_bytes: Optional[bytes] = None

    base64_image = first_result.get("b64_json")
    if base64_image:
        raw_bytes = base64.b64decode(base64_image)
    else:
        image_url = first_result.get("url")
        if not image_url:
            raise HTTPException(status_code=502, detail="OpenAI response did not include image data.")
        try:
            download_response = requests.get(image_url, timeout=120)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail="Failed to download the enhanced image from OpenAI.") from exc
        if download_response.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to download the enhanced image from OpenAI.")
        raw_bytes = download_response.content

    # Compress and resize to fit within limits
    compressed = _compress_output(raw_bytes)
    return base64.b64encode(compressed).decode("utf-8")


async def _enhance_with_retry(
    file_bytes: bytes, filename: str, content_type: str, api_key: str
) -> str:
    """Enhance one image with semaphore-controlled concurrency and exponential backoff retries."""
    last_exc: Exception = RuntimeError("No attempts made")

    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            base = RETRY_BASE_DELAYS[min(attempt - 1, len(RETRY_BASE_DELAYS) - 1)]
            delay = base + random.uniform(0.0, 1.0)  # jitter prevents thundering-herd retries
            logger.info("Retry %d/%d for '%s' — waiting %.1fs", attempt, MAX_RETRIES, filename, delay)
            await asyncio.sleep(delay)

        try:
            async with _semaphore:
                return await asyncio.to_thread(
                    _enhance_image, file_bytes, filename, content_type, api_key
                )
        except HTTPException as exc:
            last_exc = exc
            if exc.status_code not in RETRYABLE_CODES:
                raise  # Don't retry auth errors or bad requests
            logger.warning("HTTP %d for '%s' (attempt %d/%d)", exc.status_code, filename, attempt + 1, MAX_RETRIES + 1)

    raise last_exc


async def _read_upload(file: UploadFile) -> Tuple[str, str, bytes]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Please upload an image file.")
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    await asyncio.to_thread(_validate_input, file_bytes, file.filename)
    return file.filename, file.content_type or "image/jpeg", file_bytes


def _batch_error_result(index: int, filename: str, error: str) -> Dict[str, Any]:
    return {"index": index, "filename": filename, "success": False, "error": error}


# ---------------------------------------------------------------------------
# SQLite helpers (all run in a thread via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _db_create_job(job_id: str, total: int, items: List[Dict[str, Any]]) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO jobs (id, status, total, started_at) VALUES (?, 'queued', ?, ?)",
            (job_id, total, time.time()),
        )
        conn.executemany(
            "INSERT INTO job_items (job_id, idx, filename, input_path) VALUES (?, ?, ?, ?)",
            [(job_id, i["idx"], i["filename"], i.get("input_path")) for i in items],
        )
        conn.commit()


def _db_save_item(
    job_id: str, idx: int, success: bool,
    image: Optional[str], error: Optional[str], duration_s: Optional[float],
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    extra = extra or {}
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            UPDATE job_items
            SET success=?, image=?, error=?, duration_s=?,
                input_hash=?, pipeline_version=?, estimated_cost=?, from_cache=?
            WHERE job_id=? AND idx=?
        """, (
            1 if success else 0, image, error, duration_s,
            extra.get("input_hash"), extra.get("pipeline_version"),
            extra.get("estimated_cost"), 1 if extra.get("from_cache") else 0,
            job_id, idx,
        ))
        if success:
            conn.execute("UPDATE jobs SET succeeded=succeeded+1 WHERE id=?", (job_id,))
        else:
            conn.execute("UPDATE jobs SET failed=failed+1 WHERE id=?", (job_id,))
        conn.commit()


def _db_finish_job(job_id: str, status: str = "done") -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
        conn.commit()


def _db_get_status(job_id: str, running_count: int = 0) -> Optional[Dict[str, Any]]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        job = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not job:
            return None
        rows = conn.execute(
            "SELECT idx, filename, success, error, image, duration_s "
            "FROM job_items WHERE job_id=? ORDER BY idx",
            (job_id,),
        ).fetchall()

    completed = job["succeeded"] + job["failed"]
    queued = max(job["total"] - completed - running_count, 0)

    eta_seconds: Optional[float] = None
    started_at = job["started_at"]
    if completed > 0 and started_at and job["status"] not in ("done", "cancelled"):
        avg = (time.time() - started_at) / completed
        eta_seconds = round(avg * (job["total"] - completed))

    completed_results = []
    for row in rows:
        if not row["success"] and row["error"] is None:
            continue  # still pending or running
        r: Dict[str, Any] = {
            "index": row["idx"],
            "filename": row["filename"],
            "success": bool(row["success"]),
        }
        if row["error"]:
            r["error"] = row["error"]
        if row["image"]:
            r["image"] = row["image"]
        if row["duration_s"] is not None:
            r["duration_s"] = round(row["duration_s"], 1)
        completed_results.append(r)

    return {
        "job_id": job_id,
        "status": job["status"],
        "total": job["total"],
        "succeeded": job["succeeded"],
        "failed": job["failed"],
        "completed": completed,
        "running": running_count,
        "queued": queued,
        "eta_seconds": eta_seconds,
        "results": completed_results,
    }


@app.get("/")
def read_root() -> Dict[str, str]:
    return {"status": "ok", "service": "Maslool Snap & Shine API"}


@app.post("/enhance")
async def enhance(file: UploadFile = File(...)) -> Dict[str, str]:
    filename, content_type, file_bytes = await _read_upload(file)
    openai_api_key = _require_env("OPENAI_API_KEY")
    enhanced_base64 = await _enhance_with_retry(file_bytes, filename, content_type, openai_api_key)
    return {"image": enhanced_base64}


# ---------------------------------------------------------------------------
# Background worker for batch jobs
# ---------------------------------------------------------------------------

async def _run_batch_job(job_id: str, items: List[Dict[str, Any]], api_key: str) -> None:
    logger.info("Job %s started — %d images", job_id, len(items))

    async def process_one(item: Dict[str, Any]) -> None:
        idx: int = item["idx"]
        filename: str = item["filename"]

        if job_id in _cancelled_jobs:
            await asyncio.to_thread(_db_save_item, job_id, idx, False, None, "Job cancelled.", None)
            return

        input_hash = hashlib.sha256(item["bytes"]).hexdigest()

        # Duplicate detection — reuse cached result if the same input was enhanced before
        cached_b64 = await asyncio.to_thread(_db_get_cached, input_hash)
        if cached_b64:
            await asyncio.to_thread(
                _db_save_item, job_id, idx, True, cached_b64, None, 0.0,
                {"input_hash": input_hash, "pipeline_version": PIPELINE_VERSION,
                 "estimated_cost": 0.0, "from_cache": True},
            )
            logger.info("Job %s  [%d/%d] '%s' ✓ (cache hit)", job_id, idx + 1, len(items), filename)
            return

        _running_items.add((job_id, idx))
        t0 = time.monotonic()
        try:
            enhanced = await _enhance_with_retry(item["bytes"], filename, item["content_type"], api_key)

            # Output integrity verification
            await asyncio.to_thread(_get_output_metadata, enhanced)

            duration = time.monotonic() - t0

            # Store in cache for future duplicate detection
            await asyncio.to_thread(_db_set_cached, input_hash, enhanced)

            await asyncio.to_thread(
                _db_save_item, job_id, idx, True, enhanced, None, duration,
                {"input_hash": input_hash, "pipeline_version": PIPELINE_VERSION,
                 "estimated_cost": COST_PER_IMAGE_USD},
            )
            logger.info("Job %s  [%d/%d] '%s' ✓  %.1fs", job_id, idx + 1, len(items), filename, duration)
        except Exception as exc:
            duration = time.monotonic() - t0
            error_msg = str(exc.detail) if isinstance(exc, HTTPException) else "Enhancement failed."
            await asyncio.to_thread(_db_save_item, job_id, idx, False, None, error_msg, duration)
            logger.warning("Job %s  [%d/%d] '%s' ✗  %s  %.1fs", job_id, idx + 1, len(items), filename, error_msg, duration)
        finally:
            _running_items.discard((job_id, idx))

    await asyncio.gather(*[process_one(item) for item in items])
    final_status = "cancelled" if job_id in _cancelled_jobs else "done"
    await asyncio.to_thread(_db_finish_job, job_id, final_status)
    _cancelled_jobs.discard(job_id)
    logger.info("Job %s %s", job_id, final_status)


@app.post("/enhance-batch")
async def enhance_batch(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
) -> Dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one image file.")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"You can upload up to {MAX_BATCH_FILES} images at once.")

    openai_api_key = _require_env("OPENAI_API_KEY")
    job_id = str(uuid.uuid4())
    job_dir = JOB_INPUTS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    items: List[Dict[str, Any]] = []

    for idx, file in enumerate(files):
        raw_name = file.filename or f"image-{idx + 1}"
        try:
            filename, content_type, file_bytes = await _read_upload(file)
            safe_name = Path(filename).name
            input_path = job_dir / f"{idx}_{safe_name}"
            input_path.write_bytes(file_bytes)  # persist for resume support
            items.append({
                "idx": idx, "filename": filename, "bytes": file_bytes,
                "content_type": content_type, "input_path": str(input_path),
            })
        except HTTPException as exc:
            items.append({"idx": idx, "filename": raw_name, "bytes": b"", "content_type": "", "pre_error": str(exc.detail)})

    await asyncio.to_thread(_db_create_job, job_id, len(items), items)

    # Mark pre-validation failures immediately
    pre_failed = [i for i in items if "pre_error" in i]
    for item in pre_failed:
        await asyncio.to_thread(_db_save_item, job_id, item["idx"], False, None, item["pre_error"], None)

    valid_items = [i for i in items if "pre_error" not in i]
    if valid_items:
        background_tasks.add_task(_run_batch_job, job_id, valid_items, openai_api_key)
    else:
        await asyncio.to_thread(_db_finish_job, job_id)

    return {"job_id": job_id, "total": len(items)}


@app.get("/status/{job_id}")
async def job_status(job_id: str) -> Dict[str, Any]:
    """Poll every 2–5 s to track progress and retrieve completed images."""
    running = sum(1 for (jid, _) in _running_items if jid == job_id)
    status = await asyncio.to_thread(_db_get_status, job_id, running)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return status


@app.post("/cancel/{job_id}")
async def cancel_job(job_id: str) -> Dict[str, str]:
    """Signal cancellation. In-flight images finish normally; queued images are skipped."""
    running = sum(1 for (jid, _) in _running_items if jid == job_id)
    status = await asyncio.to_thread(_db_get_status, job_id, running)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if status["status"] in ("done", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Job is already {status['status']}.")
    _cancelled_jobs.add(job_id)
    return {"job_id": job_id, "message": "Cancellation requested. In-flight images will still complete."}


@app.get("/download/{job_id}")
async def download_job(job_id: str) -> StreamingResponse:
    """Download all successfully enhanced images for a job as a single ZIP archive."""
    running = sum(1 for (jid, _) in _running_items if jid == job_id)
    status = await asyncio.to_thread(_db_get_status, job_id, running)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    successful = [r for r in status["results"] if r.get("success") and r.get("image")]
    if not successful:
        raise HTTPException(status_code=404, detail="No completed images available yet.")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        seen: Dict[str, int] = {}
        for result in successful:
            stem = Path(result["filename"]).stem
            count = seen.get(stem, 0)
            seen[stem] = count + 1
            name = f"{stem}.jpg" if count == 0 else f"{stem}_{count}.jpg"
            zf.writestr(name, base64.b64decode(result["image"]))

    zip_buffer.seek(0)
    short_id = job_id[:8]
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="maslool_{short_id}.zip"'},
    )


@app.get("/metrics")
async def get_metrics() -> Dict[str, Any]:
    """Operational metrics: throughput, cost, cache efficiency, and queue health."""
    return await asyncio.to_thread(_db_get_metrics)