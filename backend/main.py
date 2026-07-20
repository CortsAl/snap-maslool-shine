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

load_dotenv()

OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
MAX_BATCH_SIZE = 100

ENHANCEMENT_PROMPT = (
    "You are a professional product photographer. Transform this product photo into a premium "
    "studio-quality image that looks like it was shot by an experienced photographer in a "
    "professional photography studio. "
    "Requirements: "
    "- Place the product on a pure white seamless studio background. "
    "- Apply natural, professional studio lighting: soft key light from upper-left, gentle fill "
    "light from the right, subtle rim light to give depth. Lighting must look real and natural. "
    "- Add a very soft, barely visible natural shadow or ground reflection beneath the product "
    "to make it look grounded, not floating. "
    "- Keep ALL product details exactly as they are: every scratch, texture, engraving, logo, "
    "text, color, and material must remain 100% faithful to the original. "
    "- Do NOT over-process, over-sharpen, or make it look like an AI rendering or CGI. "
    "- The result must look like a real photograph taken by a skilled human photographer — "
    "natural, detailed, tactile, and trustworthy. "
    "- Suitable for premium e-commerce listings on Amazon, Shopify, or luxury brand websites. "
    "- No artificial glow, no unrealistic reflections, no plastic or rendered look."
)

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


async def _read_upload(file: UploadFile) -> Tuple[bytes, str, str]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"File {file.filename} is empty.")

    _ensure_image_file(file_bytes)
    content_type = file.content_type if file.content_type and file.content_type.startswith("image/") else "image/png"
    return file_bytes, file.filename, content_type


def _enhance_image(file_bytes: bytes, filename: str, content_type: str, api_key: str) -> str:
    """Send the original photo directly to OpenAI gpt-image-1 for professional enhancement."""
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


@app.get("/")
def read_root() -> Dict[str, str]:
    return {"status": "ok", "service": "Maslool Snap & Shine API"}


@app.post("/enhance")
async def enhance(file: UploadFile = File(...)) -> Dict[str, str]:
    """Enhance a single product image."""
    file_bytes, filename, content_type = await _read_upload(file)
    openai_api_key = _require_env("OPENAI_API_KEY")
    enhanced_base64 = _enhance_image(file_bytes, filename, content_type, openai_api_key)
    return {"image": enhanced_base64}


@app.post("/enhance-batch")
async def enhance_batch(files: List[UploadFile] = File(...)) -> Dict[str, Any]:
    """Enhance up to the configured maximum number of product images in parallel."""
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one image file.")
    if len(files) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_SIZE} images per batch.")

    openai_api_key = _require_env("OPENAI_API_KEY")
    file_data = []

    for upload in files:
        file_bytes, filename, content_type = await _read_upload(upload)
        file_data.append((file_bytes, filename, content_type))

    async def process_one(file_bytes: bytes, filename: str, content_type: str, index: int) -> Dict[str, Any]:
        try:
            enhanced = await asyncio.to_thread(_enhance_image, file_bytes, filename, content_type, openai_api_key)
            return {"index": index, "filename": filename, "success": True, "image": enhanced}
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Image enhancement failed."
            return {"index": index, "filename": filename, "success": False, "error": detail}
        except Exception:  # pragma: no cover - defensive fallback for unexpected runtime errors
            return {"index": index, "filename": filename, "success": False, "error": "An unexpected error occurred during image enhancement."}

    tasks = [process_one(file_bytes, filename, content_type, index) for index, (file_bytes, filename, content_type) in enumerate(file_data)]
    results = await asyncio.gather(*tasks)

    return {
        "total": len(results),
        "succeeded": sum(1 for result in results if result["success"]),
        "failed": sum(1 for result in results if not result["success"]),
        "results": results,
    }
