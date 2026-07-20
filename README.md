# Maslool Snap & Shine

Maslool Snap & Shine is an AI-powered product photo enhancer. The web app lets you upload 1 to 100 raw product images, then the FastAPI backend sends them directly to OpenAI for natural, realistic white-background studio results.

## Monorepo layout

```text
snap-maslool-shine/
├── backend/   # FastAPI API for single and batch image enhancement
├── web/       # React + Vite web app for upload, processing, and results
└── README.md  # Setup and usage guide
```

## Architecture

```text
+--------------------------+
|  React + Vite web app    |
|  - multi-photo upload    |
|  - batch processing UI   |
|  - gallery + ZIP export  |
+------------+-------------+
             |
             | POST /enhance or /enhance-batch
             v
+------------+-------------+
|  FastAPI backend         |
|  - validates uploads     |
|  - calls OpenAI edits    |
|  - returns base64 images |
+------------+-------------+
             |
             +--> OpenAI GPT-image-1 API
```

## What it does

1. Accepts 1 to 100 product photos from the web app at once.
2. Sends all photos directly to OpenAI `gpt-image-1` with a natural, realistic studio-photo prompt.
3. Processes images in parallel through the batch API.
4. Shows results in a gallery with before/after toggles for each photo.
5. Lets the user download individual enhanced images or all successful results as a ZIP file.

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
- Field: `files` (repeat once per uploaded image)
- Maximum files: `100`
- Success response:

```json
{
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "results": [
    {
      "index": 0,
      "filename": "photo-1.jpg",
      "success": true,
      "image": "<base64>"
    },
    {
      "index": 1,
      "filename": "photo-2.jpg",
      "success": true,
      "image": "<base64>"
    }
  ]
}
```

## Cost estimate per image

Estimated costs vary by current OpenAI pricing, resolution, and your subscription tier, but a reasonable starting estimate is roughly **$0.03-$0.10 per image** depending on image size and pricing changes.

Always verify the latest pricing on the official provider page before launch.

## Notes

- The web UI uses a dark theme with gold accents for a premium feel.
- The backend loads environment variables with `python-dotenv`.
- The app is scaffolded for local development first; production deployment will require updating the backend URL and tightening CORS.
