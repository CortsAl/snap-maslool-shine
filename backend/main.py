"""FastAPI entry point for the Snap & Shine image enhancement service."""

import base64
import io
import os
from typing import Any, Dict

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

# Load local environment variables from a .env file during development.
load_dotenv()

REMOVE_BG_URL = "https://api.remove.bg/v1.0/removebg"
OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
ENHANCEMENT_PROMPT = (
    "Professional e-commerce product photography. The product has already had its background removed. "
    "Place the product on a perfectly clean, pure white seamless studio background (#FFFFFF). "
    "Apply professional three-point studio lighting: a bright soft-box key light from the upper-left, "
    "a fill light from the right to eliminate harsh shadows, and a subtle rim/back light to separate "
    "the product from the background. "
    "Add a very soft, natural ground shadow or reflection directly beneath the product to anchor it. "
    "Enhance the product's surface details — make metals look polished and reflective, "
    "wood grain look rich and tactile, leather look supple, and plastics look clean. "
    "Keep the product 100% photorealistic — do NOT illustrate, cartoon, render, or alter the product "
    "shape, text, logos, or proportions in any way. "
    "The final result must look like a high-end professional studio photograph suitable for "
    "Amazon, Shopify, or luxury brand product listings. "
    "Output at the highest possible quality and sharpness."
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


def _remove_background(file_bytes: bytes, filename: str, api_key: str) -> bytes:
    """Send the original upload to Remove.bg and return the highest-quality cutout PNG bytes."""
    response = requests.post(
        REMOVE_BG_URL,
        headers={"X-Api-Key": api_key},
        files={"image_file": (filename, file_bytes, "application/octet-stream")},
        data={
            "size": "auto",
            "type": "product",
            "type_level": "latest",
            "format": "png",
            "crop": "false",
        },
        timeout=90,
    )

    if response.status_code != 200:
        message = response.text or "Remove.bg could not process the image."
        raise HTTPException(status_code=502, detail=f"Background removal failed: {message}")

    return response.content


def _edit_image(cutout_bytes: bytes, api_key: str) -> str:
    """Send the cutout image to the OpenAI gpt-image-1 edit API at highest quality and return base64 PNG."""
    response = requests.post(
        OPENAI_IMAGE_EDIT_URL,
        headers={"Authorization": "Bearer " + api_key},
        files={"image": ("product-cutout.png", cutout_bytes, "image/png")},
        data={
            "model": "gpt-image-1",
            "prompt": ENHANCEMENT_PROMPT,
            "size": "1024x1024",
            "quality": "high",
        },
        # High-quality gpt-image-1 edits can take longer than the default timeout.
        timeout=180,
    )

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

    download_response = requests.get(image_url, timeout=120)
    if download_response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to download the enhanced image from OpenAI.")

    return base64.b64encode(download_response.content).decode("utf-8")


@app.get("/")
def read_root() -> Dict[str, str]:
    """Expose a tiny health-style route so local setup is easy to verify."""
    return {"status": "ok", "service": "Maslool Snap & Shine API"}


@app.post("/enhance")
async def enhance(file: UploadFile = File(...)) -> Dict[str, str]:
    """Remove the background and enhance the product image at highest quality, then return base64 JSON."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    _ensure_image_file(file_bytes)

    remove_bg_api_key = _require_env("REMOVE_BG_API_KEY")
    openai_api_key = _require_env("OPENAI_API_KEY")

    cutout_bytes = _remove_background(file_bytes, file.filename, remove_bg_api_key)
    enhanced_base64 = _edit_image(cutout_bytes, openai_api_key)

    return {"image": enhanced_base64}
