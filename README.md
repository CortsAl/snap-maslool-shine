# Maslool Snap & Shine

Maslool Snap & Shine is an AI-powered product photo enhancer. The mobile app lets you capture or upload a raw product image, then the FastAPI backend removes the background with Remove.bg and sends the cutout to OpenAI for a polished white-background studio result.

## Monorepo layout

```text
snap-maslool-shine/
├── backend/   # FastAPI API for image enhancement
├── mobile/    # Expo React Native app
└── README.md  # Setup and usage guide
```

## Architecture

```text
+-----------------------+
|  Expo mobile app      |
|  - camera/gallery     |
|  - processing UI      |
|  - save/share result  |
+-----------+-----------+
            |
            | POST /enhance (multipart image)
            v
+-----------+-----------+
|  FastAPI backend      |
|  - validates upload   |
|  - calls Remove.bg    |
|  - calls OpenAI edit  |
+-----------+-----------+
            |
            +--> Remove.bg API
            |
            +--> OpenAI GPT-image-1 API
```

## What it does

1. Accepts a product photo from the mobile app.
2. Removes the background with Remove.bg.
3. Sends the cutout to OpenAI `gpt-image-1` with a photorealistic studio-photo prompt.
4. Returns the final enhanced image to the app as a base64 string.
5. Lets the user save or share the final result from the device.

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

Set these values in `backend/.env`:

```env
OPENAI_API_KEY=your_openai_key_here
REMOVE_BG_API_KEY=your_removebg_key_here
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

## Mobile setup (`/mobile`)

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Point the app at your backend

The default API URL is defined in `/home/runner/work/snap-maslool-shine/snap-maslool-shine/mobile/src/constants/api.ts`:

```ts
export const API_BASE_URL = 'http://localhost:8000';
```

If you are using a physical device, replace `localhost` with your computer's LAN IP or deployed backend URL.

### 3. Start Expo

```bash
npx expo start
```

Then open the project in Expo Go or an emulator.

## API keys

- Remove.bg API key: https://www.remove.bg/api
- OpenAI API key: https://platform.openai.com/api-keys

## Environment variable reference

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Used by the backend to call OpenAI image edit APIs. |
| `REMOVE_BG_API_KEY` | Yes | Used by the backend to remove the original background before enhancement. |

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

## Cost estimate per image

Estimated costs vary by current vendor pricing, resolution, and your subscription tier, but a reasonable starting estimate is:

- Remove.bg: about **$0.02-$0.20** per image depending on plan volume
- OpenAI GPT-image-1 edit: roughly **$0.03-$0.10** per image depending on image size and pricing changes
- Combined estimate: **~$0.05-$0.30 per enhanced image**

Always verify the latest pricing on the official provider pages before launch.

## Notes

- The mobile UI uses a dark theme with gold accents for a premium feel.
- The backend loads environment variables with `python-dotenv`.
- The app is scaffolded for local development first; production deployment will require updating the backend URL and tightening CORS.
