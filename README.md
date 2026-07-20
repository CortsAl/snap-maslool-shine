# Maslool Snap & Shine

Maslool Snap & Shine is an AI-powered product photo enhancer. The web app lets you upload up to 100 raw product images at once, then the FastAPI backend sends them directly to OpenAI for polished, natural-looking white-background studio results.

## Monorepo layout

```text
snap-maslool-shine/
├── backend/   # FastAPI API for single and batch image enhancement
├── web/       # React + Vite web app for upload, processing, and results
└── README.md  # Setup and usage guide
```

## Architecture

```text
+-----------------------+
|  React + Vite web app |
|  - multi-photo upload |
|  - batch progress UI  |
|  - result gallery     |
+-----------+-----------+
            |
            | POST /enhance or /enhance-batch
            v
+-----------+-----------+
|  FastAPI backend      |
|  - validates upload   |
|  - calls OpenAI edit  |
|  - runs batch tasks   |
+-----------+-----------+
            |
            +--> OpenAI GPT-image-1 API
```

## What it does

1. Accepts one or more product photos from the web app.
2. Sends each original upload directly to OpenAI `gpt-image-1` with a natural, photorealistic studio-photo prompt.
3. Processes batches of up to 100 images in parallel on the backend.
4. Returns the final enhanced images to the app as base64 strings.
5. Lets the user review before/after comparisons and download individual PNGs or a ZIP of all successful results.

## Backend setup (`/backend`)

### 1. Create a virtual environment

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Set this value in `backend/.env`:

```env
OPENAI_API_KEY=your_openai_key_here
```

### 4. Run the FastAPI server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`.

### 5. Optional: run with Docker

```bash
docker build -t snap-shine-backend ./backend
docker run --rm -p 8000:8000 --env-file ./backend/.env snap-shine-backend
```

## Web setup (`/web`)

### 1. Install dependencies

```bash
cd web
npm install
```

### 2. Point the app at your backend

Set the API URL in `web/src/constants/api.ts` if needed:

```ts
export const API_BASE_URL = 'http://localhost:8000';
```

### 3. Start the web app

```bash
npm run dev
```

The app will run at `http://localhost:3000`.

## API keys

- OpenAI API key: https://platform.openai.com/api-keys

## Environment variable reference

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Used by the backend to call OpenAI image edit APIs. |

## API contract

### `POST /enhance`

- Content type: `multipart/form-data`
- Field: `file`
- Success response:

```json
{
  "image": "<base64>"
}
```

### `POST /enhance-batch`

- Content type: `multipart/form-data`
- Field: `files` (repeat the field for each image)
- Maximum files: `100`
- Success response:

```json
{
  "total": 2,
  "succeeded": 1,
  "failed": 1,
  "results": [
    {
      "index": 0,
      "filename": "knife-1.jpg",
      "success": true,
      "image": "<base64>"
    },
    {
      "index": 1,
      "filename": "knife-2.jpg",
      "success": false,
      "error": "Please upload a valid image file."
    }
  ]
}
```

## Cost estimate per image

## Cost estimate per image

- OpenAI GPT-image-1 edit: roughly **$0.03-$0.10** per image depending on image size and pricing changes
- Multiply by the number of images in a batch to estimate total run cost.

Always verify the latest pricing on the official provider page before launch.

## Notes

- The web UI uses a dark theme with gold accents for a premium feel.
- The web flow supports drag-and-drop multi-select, per-photo status badges, and ZIP downloads.
- The backend loads environment variables with `python-dotenv`.
- The app is scaffolded for local development first; production deployment will require updating the backend URL and tightening CORS.
