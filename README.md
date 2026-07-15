# Dermatology AI Voice Intake

English-only kiosk assistant for dermatology pre-consultation intake. The question flow is read dynamically from `bot.json`; the application does not hard-code the questionnaire.

## Run

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Google Cloud Speech-to-Text credentials are required for microphone transcription. Typed answers can be used to exercise the intake workflow without audio.

## Configuration

- `GOOGLE_APPLICATION_CREDENTIALS`: Google Cloud service-account JSON path.
- `INTAKE_LANGUAGE_CODE`: speech dialect; defaults to `en-IN` for Indian English.
- `INTAKE_SPEECH_MODEL`: defaults to `latest_short`, appropriate for one short answer at a time.
- `STT_PROVIDER`: choose `google` or `openai`; defaults to `google`.
- `OPENAI_REALTIME_STT_MODEL`: defaults to `gpt-realtime-whisper` when the OpenAI provider is selected.
- `OPENAI_REALTIME_SESSION_MODEL`: transport session model, defaulting to `gpt-realtime-mini`.
- `MIN_ANSWER_CONFIDENCE`: answers below this confidence are re-asked; defaults to `0.55`.
- `OPENAI_API_KEY`: enables contextual LLM correction and normalization. Without it, a conservative deterministic processor is used and asks for clarification rather than guessing.
- `LLM_MODEL`: chat-completions-compatible model; defaults to `gpt-4.1-mini`.
- `LLM_API_URL`: optional compatible chat completions endpoint.
- `OPENAI_TTS_MODEL`: natural question voice; defaults to `gpt-4o-mini-tts`.
- `OPENAI_TTS_VOICE`: defaults to `marin`.
- `OPENAI_TTS_SPEED`: defaults to `1.08` for a moderately brisk pace.
- `FRONT_DESK_ALERT_URL`: HTTPS webhook for urgent and red-flag alerts. Alerts remain visibly queued in the visit record when no webhook is configured.
- `FRONT_DESK_ALERT_TOKEN`: optional bearer token for that webhook.
- `KIOSK_ID`: kiosk identifier included in visits and alerts.

Visit JSON is stored under `data/`; consented images are stored separately under `data/photos/` with consent, retention, and access-control metadata. Production deployments should replace local storage with encrypted clinical storage and enforce authentication, authorization, retention, audit logging, and applicable privacy requirements.

## Test

```bash
npm test
```

The tests cover schema ordering, section/question conditions, required fields, explicit consent, photo gating, option constraints, red-flag triage, immediate-danger detection, and LLM output validation.
