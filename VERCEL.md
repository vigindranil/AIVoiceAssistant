# Vercel deployment

This project exports its Express HTTP server through `api/index.js`. The same server handles the `/api/stream` WebSocket endpoint.

## Required Vercel settings

1. Enable **Fluid Compute** in the Vercel project settings. Vercel WebSockets require it.
2. Add these Environment Variables for Production and Preview:
   - `STT_PROVIDER=openai` and `OPENAI_API_KEY=...` for GPT Realtime Whisper; or
   - `STT_PROVIDER=google` and `GOOGLE_CLOUD_CREDENTIALS_JSON=...` with the complete Google service-account JSON.
   - Add `OPENAI_API_KEY` when using OpenAI question processing or voice generation even if Google is the STT provider.
3. Do not set `GOOGLE_APPLICATION_CREDENTIALS` to a path from your Mac. That path does not exist in Vercel.
4. Redeploy after saving environment variables.

## Storage warning

Vercel's deployed application directory is read-only. This configuration uses `/tmp` to prevent startup failures, but `/tmp` and the in-memory session map are ephemeral and may disappear when a Function instance is recycled. Before using this with real patients, replace visit persistence with an encrypted database/Redis service and photo persistence with private object storage. Do not treat the `/tmp` fallback as clinical storage.
