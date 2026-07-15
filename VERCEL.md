# Vercel deployment

This project exports its Express handler through `api/index.js` and its Node HTTP/WebSocket server through `api/stream.js`.

## Required Vercel settings

1. Enable **Fluid Compute** in the Vercel project settings. Vercel WebSockets require it.
2. Add these Environment Variables for Production and Preview:
   - `SESSION_SIGNING_SECRET=...` using a long random value from `openssl rand -hex 32`.
   - `STT_PROVIDER=openai` and `OPENAI_API_KEY=...` for GPT Realtime Whisper; or
   - `STT_PROVIDER=google` and `GOOGLE_CLOUD_CREDENTIALS_JSON=...` with the complete Google service-account JSON.
   - Add `OPENAI_API_KEY` when using OpenAI question processing or voice generation even if Google is the STT provider.
3. Do not set `GOOGLE_APPLICATION_CREDENTIALS` to a path from your Mac. That path does not exist in Vercel.
4. Redeploy after saving environment variables.

### Fastest voice configuration

If `OPENAI_API_KEY` is already configured, set `STT_PROVIDER=openai` and delete `GOOGLE_APPLICATION_CREDENTIALS`. No Google key file is needed in this mode.

To keep Google STT, delete `GOOGLE_APPLICATION_CREDENTIALS` and add `GOOGLE_CLOUD_CREDENTIALS_JSON`. Paste the full contents of the service-account JSON file as the value; never commit that file to Git.

## Storage warning

Vercel's deployed application directory is read-only. This configuration uses `/tmp` as a local cache and sends an authenticated, encrypted session token with each browser request so an active interview can continue across Function instances. Before using this with real patients, replace visit persistence with an encrypted database/Redis service and photo persistence with private object storage. Do not treat the `/tmp` fallback or browser-carried session token as permanent clinical storage.
