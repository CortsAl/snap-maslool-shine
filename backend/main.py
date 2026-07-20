"""FastAPI entry point for the Snap & Shine image enhancement service."""

import asyncio
import base64
import io
import os
from typing import Any, Dict, List, Tuple

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

# Load local environment variables from a .env file during development.
load_dotenv()

OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
MAX_BATCH_FILES = 100
ENHANCEMENT_PROMPT = (
    "You are a professional product photographer. Transform this product photo into a premium "
    "studio-quality image that looks like it was shot by an experienced photographer in a professional "
    "photography studio. Place the product on a pure white seamless studio background. Apply natural, "
    "professional studio lighting: soft key light from upper-left, gentle fill light from the right, "
    "subtle rim light to give depth. Lighting must look real and natural. Add a very soft, barely "
    "visible natural shadow or ground reflection beneath the product to make it look grounded, not "
    "floating. Keep ALL product details exactly as they are: every scratch, texture, engraving, logo, "
    "text, color, and material must remain 100% faithful to the original. Do NOT over-process, "
    "over-sharpen, or make it look like an AI rendering or CGI. The result must look like a real "
    "photograph taken by a skilled human photographer — natural, detailed, tactile, and trustworthy. "
    "Suitable for premium e-commerce listings on Amazon, Shopify, or luxury brand websites. "
    "No artificial glow, no unrealistic reflections, no plastic or rendered look."
)

app = FastAPI(title="Maslool Snap & Shine API")

# Allow the web app to call the API during local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_env(name: str) -> str:
    """Fail fast with a clear server error when a required API key is missing."""
    value = os.getenv(name)
    if not value:
        raise HTTPException(status_code=500, detail=f"Missing required environment variable: {name}")
    return value


def _ensure_image_file(file_bytes: bytes) -> None:
    """Validate that the uploaded bytes are a readable image before calling external APIs."""
    try:
        with Image.open(io.BytesIO(file_bytes)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Please upload a valid image file.") from exc


def _enhance_image(file_bytes: bytes, filename: str, content_type: str, api_key: str) -> str:
    """Send the raw upload to the OpenAI gpt-image-1 edit API at highest quality and return base64 PNG."""
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
            # High-quality gpt-image-1 edits can take longer than the default timeout.
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
    base64_image = first_result.get("b64_json")
    if base64_image:
        return base64_image

    image_url = first_result.get("url")
    if not image_url:
        raise HTTPException(status_code=502, detail="OpenAI response did not include image data.")

    try:
        download_response = requests.get(image_url, timeout=120)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Failed to download the enhanced image from OpenAI.") from exc
    if download_response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to download the enhanced image from OpenAI.")

    return base64.b64encode(download_response.content).decode("utf-8")


async def _read_upload(file: UploadFile) -> Tuple[str, str, bytes]:
    """Read and validate a single uploaded image."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    _ensure_image_file(file_bytes)

    return file.filename, file.content_type or "application/octet-stream", file_bytes


def _batch_error_result(index: int, filename: str, error: str) -> Dict[str, Any]:
    """Create a consistent failed batch result payload."""
    return {
        "index": index,
        "filename": filename,
        "success": False,
        "error": error,
    }


@app.get("/")
def read_root() -> Dict[str, str]:
    """Expose a tiny health-style route so local setup is easy to verify."""
    return {"status": "ok", "service": "Maslool Snap & Shine API"}


@app.post("/enhance")
async def enhance(file: UploadFile = File(...)) -> Dict[str, str]:
    """Enhance a single product image at highest quality and return base64 JSON."""
    filename, content_type, file_bytes = await _read_upload(file)
    openai_api_key = _require_env("OPENAI_API_KEY")
    enhanced_base64 = await asyncio.to_thread(_enhance_image, file_bytes, filename, content_type, openai_api_key)
    return {"image": enhanced_base64}


@app.post("/enhance-batch")
async def enhance_batch(files: List[UploadFile] = File(...)) -> Dict[str, Any]:
    """Enhance up to 100 product images in parallel and return per-file results."""
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one image file.")

    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"You can upload up to {MAX_BATCH_FILES} images at once.")

    openai_api_key = _require_env("OPENAI_API_KEY")
    results: List[Dict[str, Any]] = [_batch_error_result(index, "", "Image processing did not start.") for index in range(len(files))]
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
        tasks.append(asyncio.to_thread(_enhance_image, file_bytes, prepared_filename, content_type, openai_api_key))

    if tasks:
        task_results = await asyncio.gather(*tasks, return_exceptions=True)
        for index, task_result in zip(task_indices, task_results):
            filename = str(results[index]["filename"])
            if isinstance(task_result, Exception):
                if isinstance(task_result, HTTPException):
                    results[index] = _batch_error_result(index, filename, str(task_result.detail))
                else:
                    results[index] = _batch_error_result(index, filename, "We could not enhance this image right now.")
                continue

            results[index] = {
                "index": index,
                "filename": filename,
                "success": True,
                "image": task_result,
            }

    succeeded = sum(1 for result in results if result.get("success"))
    failed = len(results) - succeeded

    return {
        "total": len(results),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
    }
