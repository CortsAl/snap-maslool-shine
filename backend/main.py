"""FastAPI entry point for the Snap & Shine image enhancement service."""

import asyncio
import base64
import io
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

load_dotenv()

OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
MAX_BATCH_FILES = 100

# Output image constraints
MAX_OUTPUT_WIDTH = 1200
MAX_OUTPUT_HEIGHT = 1200
MAX_OUTPUT_KB = 1100  # max ~1.1MB

ENHANCEMENT_PROMPT = (
    "You are a professional product photographer retouching an existing photo. "
    "Your job is to ENHANCE this photo — not reinvent it, not recreate it, not illustrate it. "
    "The product in the output must look IDENTICAL to the product in the input photo: "
    "same shape, same color, same proportions, same text, same engravings, same materials, "
    "same angle, same orientation. Do NOT change or invent anything about the product itself. "
    "What you SHOULD improve: "
    "1. Replace the background with a clean pure white seamless studio background. "
    "2. Apply natural professional studio lighting — soft key light from upper-left, "
    "   gentle fill light from the right, subtle rim light for depth. "
    "   Lighting must look real, natural and human — not CGI or rendered. "
    "3. Add a very soft, barely visible ground shadow beneath the product so it looks grounded. "
    "4. Enhance surface clarity — make the product look crisp, sharp and well-lit "
    "   while preserving every real detail: scratches, texture, grain, patina, reflections. "
    "5. The final image must look like this exact product was photographed in a professional "
    "   studio by a skilled human photographer. Natural, real, trustworthy. "
    "   NOT AI-generated, NOT illustrated, NOT a 3D render. "
    "Suitable for premium e-commerce: Amazon, Shopify, luxury brand websites."
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Maslool Snap & Shine API")

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


def _ensure_image_file(file_bytes: bytes) -> None:
    try:
        with Image.open(io.BytesIO(file_bytes)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Please upload a valid image file.") from exc


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

        # Compress to JPEG within size limit
        quality = 92
        while quality >= 60:
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            size_kb = buffer.tell() / 1024
            if size_kb <= MAX_OUTPUT_KB:
                break
            quality -= 5

        return buffer.getvalue()


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
                "size": "1024x1024",
                "quality": "high",
            },
            timeout=180,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Image enhancement failed: could not reach OpenAI.") from exc

    if response.status_code != 200:
        message = response.text or "OpenAI could not enhance the image."
        raise HTTPException(status_code=502, detail=f"Image enhancement failed: {message}")

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


async def _read_upload(file: UploadFile) -> Tuple[str, str, bytes]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Please upload an image file.")
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    _ensure_image_file(file_bytes)
    return file.filename, file.content_type or "image/jpeg", file_bytes


def _batch_error_result(index: int, filename: str, error: str) -> Dict[str, Any]:
    return {"index": index, "filename": filename, "success": False, "error": error}


@app.get("/")
def read_root() -> Dict[str, str]:
    return {"status": "ok", "service": "Maslool Snap & Shine API"}


@app.post("/enhance")
async def enhance(file: UploadFile = File(...)) -> Dict[str, str]:
    filename, content_type, file_bytes = await _read_upload(file)
    openai_api_key = _require_env("OPENAI_API_KEY")
    enhanced_base64 = await asyncio.to_thread(
        _enhance_image, file_bytes, filename, content_type, openai_api_key
    )
    return {"image": enhanced_base64}


@app.post("/enhance-batch")
async def enhance_batch(files: List[UploadFile] = File(...)) -> Dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one image file.")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"You can upload up to {MAX_BATCH_FILES} images at once.")

    openai_api_key = _require_env("OPENAI_API_KEY")
    results: List[Optional[Dict[str, Any]]] = [None] * len(files)
    tasks = []
    task_indices = []

    for index, file in enumerate(files):
        filename = file.filename or f"image-{index + 1}"
        try:
            prepared_filename, content_type, file_bytes = await _read_upload(file)
        except HTTPException as exc:
            results[index] = _batch_error_result(index, filename, str(exc.detail))
            continue

        results[index] = {"index": index, "filename": prepared_filename, "success": False}
        task_indices.append(index)
        tasks.append(
            asyncio.to_thread(_enhance_image, file_bytes, prepared_filename, content_type, openai_api_key)
        )

    if tasks:
        task_results = await asyncio.gather(*tasks, return_exceptions=True)
        for index, task_result in zip(task_indices, task_results):
            current_result = results[index]
            filename = str(current_result["filename"]) if current_result else f"image-{index + 1}"
            if isinstance(task_result, Exception):
                error_msg = str(task_result.detail) if isinstance(task_result, HTTPException) else "We could not enhance this image."
                results[index] = _batch_error_result(index, filename, error_msg)
                continue
            results[index] = {"index": index, "filename": filename, "success": True, "image": task_result}

    finalized_results = [
        result if result is not None else _batch_error_result(index, f"image-{index + 1}", "Image processing did not start.")
        for index, result in enumerate(results)
    ]
    succeeded = sum(1 for r in finalized_results if r.get("success"))

    return {
        "total": len(finalized_results),
        "succeeded": succeeded,
        "failed": len(finalized_results) - succeeded,
        "results": finalized_results,
    }