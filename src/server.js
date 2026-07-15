const express = require('express');
const multer = require('multer');
const path = require('path');
const speech = require('@google-cloud/speech');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const { WebSocket, WebSocketServer } = require('ws');
const medicalPhrases = require('./medicalPhrases');
const { cleanTranscript } = require('./transcriptCleaner');
const form = require('../bot.json');
const { processAnswer, localProcess, detectCommand } = require('./answerProcessor');
const { validateChiefComplaintScope } = require('./scopeValidator');
const { createOpenAIRealtimeTranscriber } = require('./openaiRealtimeStt');
const { writeEhrPdf } = require('./pdfReport');
const {
  answerMap,
  completeIfReady,
  createSession,
  evaluateEscalation,
  evaluateImmediateDanger,
  findNextQuestion,
  getProgress,
  getQuestion,
  makePublicQuestion,
  markSkipped,
  now,
  requiredQuestionsMissing,
  saveAnswer,
  addClarification,
} = require('./questionnaireEngine');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/stream' });
const IS_VERCEL = Boolean(process.env.VERCEL);
const PORT = process.env.PORT || 3000;
const DEFAULT_SAMPLE_RATE_HERTZ = Number(process.env.SAMPLE_RATE_HERTZ) || 16000;
const OPUS_SAMPLE_RATE_HERTZ = Number(process.env.OPUS_SAMPLE_RATE_HERTZ) || 48000;
const MEDICAL_PHRASE_BOOST = Number(process.env.MEDICAL_PHRASE_BOOST) || 8;
const SPEECH_MODEL = process.env.SPEECH_MODEL || 'medical_conversation';
const INTAKE_SPEECH_MODEL = process.env.INTAKE_SPEECH_MODEL || 'latest_short';
const INTAKE_LANGUAGE_CODE = process.env.INTAKE_LANGUAGE_CODE || 'en-IN';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'marin';
const OPENAI_TTS_SPEED = Number(process.env.OPENAI_TTS_SPEED) || 1.08;
const requestedSttProvider = String(process.env.STT_PROVIDER || 'google').trim().toLowerCase();
const STT_PROVIDER = ['google', 'openai'].includes(requestedSttProvider) ? requestedSttProvider : 'google';
const OPENAI_REALTIME_STT_MODEL = process.env.OPENAI_REALTIME_STT_MODEL || 'gpt-realtime-whisper';
const OPENAI_REALTIME_SESSION_MODEL = process.env.OPENAI_REALTIME_SESSION_MODEL || 'gpt-realtime-mini';
const MIN_ANSWER_CONFIDENCE = Number(process.env.MIN_ANSWER_CONFIDENCE) || 0.55;
if (requestedSttProvider !== STT_PROVIDER) console.warn(`Invalid STT_PROVIDER "${requestedSttProvider}"; falling back to google.`);
const MAX_SPEECH_CONTEXT_PHRASES = Number(process.env.MAX_SPEECH_CONTEXT_PHRASES) || 200;
const requestedStorageDir = process.env.SESSION_STORAGE_DIR ? path.resolve(process.env.SESSION_STORAGE_DIR) : null;
const DATA_DIR = IS_VERCEL
  ? (requestedStorageDir?.startsWith('/tmp/') ? requestedStorageDir : path.join('/tmp', 'ai-voice-assistant-data'))
  : requestedStorageDir || path.join(__dirname, '..', 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const sessions = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });
for (const filename of fs.readdirSync(DATA_DIR).filter(name => name.startsWith('VISIT-') && name.endsWith('.json'))) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
    sessions.set(saved.visit_id, saved);
  } catch (error) {
    console.error(`Could not restore ${filename}:`, error.message);
  }
}

// Initialize Google Cloud Speech-to-Text client
function googleSpeechClientOptions() {
  if (process.env.GOOGLE_CLOUD_CREDENTIALS_JSON) {
    try {
      const raw = process.env.GOOGLE_CLOUD_CREDENTIALS_JSON.trim();
      const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      return { credentials: JSON.parse(json) };
    } catch (error) {
      throw new Error(`GOOGLE_CLOUD_CREDENTIALS_JSON is invalid: ${error.message}`);
    }
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS };
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn(`Ignoring unavailable GOOGLE_APPLICATION_CREDENTIALS path: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return undefined;
}

let speechClient = null;
function getSpeechClient() {
  if (!speechClient) {
    const options = googleSpeechClientOptions();
    if (IS_VERCEL && !options) {
      throw new Error('Google Speech credentials are not configured for Vercel. Set GOOGLE_CLOUD_CREDENTIALS_JSON, or set STT_PROVIDER=openai and provide OPENAI_API_KEY.');
    }
    speechClient = new speech.SpeechClient(options);
  }
  return speechClient;
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});
const photoUpload = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (req, file, callback) => callback(null, `${req.params.visitId}-${Date.now()}${path.extname(file.originalname || '') || '.jpg'}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

// Middleware
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: res => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'),
}));
app.use(express.json());

function persistSession(session) {
  fs.writeFileSync(path.join(DATA_DIR, `${session.visit_id}.json`), JSON.stringify(session, null, 2));
}

function sessionSigningSecret() {
  const secret = process.env.SESSION_SIGNING_SECRET
    || process.env.GOOGLE_CLOUD_CREDENTIALS_JSON
    || process.env.OPENAI_API_KEY;
  if (secret) return secret;
  if (!global.__localSessionSigningSecret) global.__localSessionSigningSecret = crypto.randomBytes(32).toString('hex');
  return global.__localSessionSigningSecret;
}

function encodeSessionToken(session) {
  const key = crypto.createHash('sha256').update(sessionSigningSecret()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(zlib.deflateRawSync(Buffer.from(JSON.stringify(session)))), cipher.final()]);
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

function decodeSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [ivValue, encryptedValue, tagValue, extra] = token.split('.');
  if (!ivValue || !encryptedValue || !tagValue || extra) throw new Error('The visit session token is invalid. Please start a new visit.');
  const key = crypto.createHash('sha256').update(sessionSigningSecret()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const compressed = Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]);
  return JSON.parse(zlib.inflateRawSync(compressed).toString('utf8'));
}

async function dispatchAlert(session, detail) {
  const alert = [...session.alerts].reverse().find(item => item.timestamp === detail.timestamp && item.action === detail.action);
  if (!process.env.FRONT_DESK_ALERT_URL) return;
  try {
    const response = await fetch(process.env.FRONT_DESK_ALERT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.FRONT_DESK_ALERT_TOKEN ? { Authorization: `Bearer ${process.env.FRONT_DESK_ALERT_TOKEN}` } : {}),
      },
      body: JSON.stringify(detail),
    });
    if (!response.ok) throw new Error(`Front-desk webhook returned ${response.status}.`);
    if (alert) { alert.delivery_status = 'delivered'; alert.delivered_at = now(); }
  } catch (error) {
    if (alert) { alert.delivery_status = 'failed'; alert.delivery_error = error.message; }
    console.error('Front-desk alert delivery failed:', error.message);
  }
  persistSession(session);
}

function getSessionOrRespond(req, res) {
  try {
    const token = req.body?.session_token;
    const restored = token ? decodeSessionToken(token) : null;
    if (restored) {
      if (restored.visit_id !== req.params.visitId) {
        res.status(400).json({ error: 'The visit session does not match this request.' });
        return null;
      }
      sessions.set(restored.visit_id, restored);
      return restored;
    }
    const session = sessions.get(req.params.visitId);
    if (!session) res.status(404).json({ error: 'Visit session not found. Please start a new visit.' });
    return session;
  } catch (error) {
    res.status(400).json({ error: error.message });
    return null;
  }
}

function buildSummary(session) {
  return session.answers.map(answer => ({
    question_id: answer.question_id,
    question: answer.question_text,
    patient_provided: answer.raw_transcript || (answer.status === 'skipped' ? 'Skipped' : 'Photo supplied'),
    structured_value: answer.structured_value,
    status: answer.status || 'answered',
    section_id: answer.section_id,
  }));
}

function buildEhrReport(session) {
  const byId = Object.fromEntries(session.answers.map(answer => [answer.question_id, answer]));
  const sections = form.sections.map(section => ({
    section_id: section.section_id,
    title: section.title,
    entries: section.questions.map(question => {
      const answer = byId[question.id];
      if (!answer) {
        return {
          question_id: question.id,
          label: question.text,
          patient_reported: null,
          structured_value: null,
          status: 'not_answered',
          recorded_at: null,
        };
      }
      return {
        question_id: question.id,
        label: question.text,
        patient_reported: answer.raw_transcript || (answer.status === 'skipped' ? 'Skipped by patient' : 'Captured separately'),
        structured_value: answer.structured_value,
        status: answer.status || 'answered',
        recorded_at: answer.answered_at,
      };
    }),
  }));
  return {
    document_type: 'Dermatology pre-consultation intake',
    clinical_status: session.escalation_flag ? 'Urgent staff review requested' : 'Pre-consultation intake',
    visit: {
      visit_id: session.visit_id, form_id: session.form_id, form_version: session.form_version,
      kiosk_id: session.kiosk_id, language: session.language_used,
      started_at: session.timestamp_start, ended_at: session.timestamp_end,
      completion_status: session.form_completion_status,
      completion_reason: session.completion_reason || null,
    },
    patient: {
      name: byId.D01?.structured_value || null,
      age_or_date_of_birth: byId.D02?.structured_value || null,
      sex_or_gender: byId.D03?.structured_value || null,
      contact_number: byId.D04?.structured_value || null,
      city_or_area: byId.D05?.structured_value || null,
    },
    triage: { escalation_flag: session.escalation_flag, details: session.escalation_details },
    sections,
    disclaimer: 'Patient-provided pre-consultation information. This report is not a diagnosis or treatment recommendation.',
  };
}

function requiresSensitiveConfirmation(question, result) {
  return ['D01', 'D02'].includes(question.id) || question.type === 'phone' || question.flag_if === true;
}

function confirmationMatchesPending(rawTranscript, pending) {
  const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const spoken = normalize(rawTranscript);
  const candidates = [pending.result?.corrected_answer, pending.result?.structured_value, JSON.stringify(pending.result?.structured_value)].map(normalize);
  return spoken.length >= 2 && candidates.some(value => value && (value === spoken || value.includes(spoken)));
}

function confirmationPrompt(question, result) {
  if (question.type === 'phone') return `I heard ${String(result.structured_value).split('').join(' ')}. Is that correct? Please say yes or no.`;
  const value = typeof result.structured_value === 'object' ? JSON.stringify(result.structured_value) : result.corrected_answer;
  return `I heard: ${value}. Is that correct? Please say yes or no.`;
}

function sessionResponse(session, extra = {}) {
  const next = findNextQuestion(form, session);
  const completed = !next && completeIfReady(form, session);
  const current = next || (session.current_question_id ? getQuestion(form, session.current_question_id) : null);
  persistSession(session);
  return {
    visit_id: session.visit_id,
    session_token: encodeSessionToken(session),
    form: { form_id: form.form_id, title: form.title, version: form.version, description: form.description },
    status: session.form_completion_status,
    escalation_flag: session.escalation_flag,
    question: next ? makePublicQuestion(next.section, next.question) : null,
    progress: getProgress(form, session),
    completed: completed || session.form_completion_status === 'completed',
    summary: session.form_completion_status !== 'in_progress' ? buildSummary(session) : null,
    ehr_report: session.form_completion_status !== 'in_progress' ? buildEhrReport(session) : null,
    current_question: current ? makePublicQuestion(current.section, current.question) : null,
    ...extra,
  };
}

app.get('/api/form', (req, res) => {
  res.json({ form_id: form.form_id, title: form.title, version: form.version, description: form.description });
});

app.post('/api/speak', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Speech text must contain between 1 and 1000 characters.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Server voice is not configured.' });
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
        input: text,
        instructions: 'Speak in warm, natural, patient-friendly Indian English. Sound conversational and reassuring, not mechanical. Use clear pronunciation and a moderately brisk pace.',
        response_format: 'mp3',
        speed: OPENAI_TTS_SPEED,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Voice API returned ${response.status}: ${details.slice(0, 240)}`);
    }
    const audio = Buffer.from(await response.arrayBuffer());
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
    res.send(audio);
  } catch (error) {
    console.error('Question speech generation failed:', error.message);
    res.status(502).json({ error: 'Question audio could not be generated.', details: error.message });
  }
});

app.post('/api/sessions', (req, res) => {
  const session = createSession(form, req.body?.kiosk_id || process.env.KIOSK_ID || 'KIOSK-DERM-01');
  sessions.set(session.visit_id, session);
  res.status(201).json(sessionResponse(session));
});

app.get('/api/sessions/:visitId', (req, res) => {
  const session = getSessionOrRespond(req, res);
  if (!session) return;
  res.json({ ...sessionResponse(session), session });
});

function sendPdfReport(req, res, next) {
  try {
    const session = getSessionOrRespond(req, res);
    if (!session) return;
    if (session.form_completion_status === 'in_progress') {
      return res.status(409).json({ error: 'Finish or end the intake before downloading its report.' });
    }
    const filename = `dermatology-intake-${session.visit_id.replace(/[^A-Z0-9-]/gi, '')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    writeEhrPdf(buildEhrReport(session), res);
  } catch (error) {
    next(error);
  }
}

app.get('/api/sessions/:visitId/report.pdf', sendPdfReport);
app.post('/api/sessions/:visitId/report.pdf', sendPdfReport);

app.post('/api/sessions/:visitId/answer', async (req, res, next) => {
  try {
    const session = getSessionOrRespond(req, res);
    if (!session) return;
    if (session.form_completion_status !== 'in_progress') return res.status(409).json({ error: 'This interview is no longer in progress.' });
    const current = getQuestion(form, session.current_question_id);
    if (!current) return res.status(409).json({ error: 'There is no active question.' });
    if (current.question.type === 'image_upload') return res.status(400).json({ error: 'Use the photo endpoint for this question.' });
    const rawTranscript = String(req.body?.raw_transcript || '').trim();
    const attempt = (session.clarification_history[current.question.id]?.length || 0) + 1;

    if (session.pending_confirmation?.question_id === current.question.id) {
      const confirmation = localProcess({ id: 'confirmation', text: 'Is that correct?', type: 'boolean' }, rawTranscript);
      if (confirmation.structured_value === true || confirmationMatchesPending(rawTranscript, session.pending_confirmation)) {
        const pending = session.pending_confirmation;
        session.pending_confirmation = null;
        const record = saveAnswer(form, session, current.section, current.question, pending.result, pending.raw_transcript, attempt);
        const schemaEscalation = evaluateEscalation(session, current.section, current.question, record);
        const dangerEscalation = evaluateImmediateDanger(session, current.section, current.question, pending.raw_transcript, record.corrected_answer);
        const escalation = schemaEscalation || dangerEscalation;
        if (schemaEscalation) await dispatchAlert(session, schemaEscalation);
        if (dangerEscalation && dangerEscalation !== schemaEscalation) await dispatchAlert(session, dangerEscalation);
        const patientName = current.question.id === 'D01'
          ? String(record.structured_value || record.corrected_answer || '').trim().slice(0, 100)
          : '';
        return res.json(sessionResponse(session, {
          saved_answer: record,
          message: 'Answer confirmed.',
          welcome_message: patientName ? `Welcome, ${patientName}. It is nice to meet you. Let us continue with your dermatology intake.` : null,
          escalation: escalation ? { action: escalation.action, message: 'Thank you. One of your answers may require prompt attention. A staff member has been notified to assist you.' } : null,
        }));
      }
      if (confirmation.structured_value === null) {
        const prompt = confirmationPrompt(current.question, session.pending_confirmation.result);
        addClarification(session, current.question, rawTranscript, { ...confirmation, clarification_question: prompt }, attempt);
        persistSession(session);
        return res.json(sessionResponse(session, { needs_clarification: true, retry_current: true, clarification_question: prompt }));
      }
      session.pending_confirmation = null;
      addClarification(session, current.question, rawTranscript, confirmation, attempt);
      persistSession(session);
      const retryPrompt = current.question.type === 'phone' ? 'Please repeat the complete phone number, one digit at a time.' : `Please give your answer again. ${current.question.text}`;
      return res.json(sessionResponse(session, { needs_clarification: true, retry_current: true, clarification_question: retryPrompt }));
    }

    const context = {
      form_id: form.form_id, visit_id: session.visit_id, current_section_id: current.section.section_id,
      current_question_id: current.question.id, current_question: current.question,
      question_text: current.question.text, question_type: current.question.type,
      available_options: current.question.options || [], required: Boolean(current.question.required),
      question_condition: current.question.condition || null, raw_speech_to_text_transcript: rawTranscript,
      transcription_alternatives: Array.isArray(req.body?.transcription_alternatives) ? req.body.transcription_alternatives.slice(0, 3) : [],
      previous_corrected_answers: session.answers.map(({ question_id, corrected_answer }) => ({ question_id, corrected_answer })),
      previous_structured_values: answerMap(session), previous_clarification_attempts: session.clarification_history[current.question.id] || [],
      current_red_flag_status: session.escalation_flag, completed_question_ids: session.completed_question_ids,
    };
    const result = await processAnswer(context);
    if (result.command) return handleCommand(res, session, current, result.command);
    if (current.question.id === 'C01' && !result.needs_clarification) {
      const correctedForScope = [result.corrected_answer, result.structured_value].filter(Boolean).join(' ');
      const scope = validateChiefComplaintScope(correctedForScope || rawTranscript);
      if (scope.in_scope !== true) {
        const clarification = scope.in_scope === false
          ? `This intake focuses only on skin problems. Your ${scope.reason} is outside this questionnaire and will not be saved as the skin complaint. Please describe a skin problem, or choose Finish early to create a partial report.`
          : 'I could not identify a skin problem in that answer. Please describe the rash, itching, patch, spot, wound, acne, mole, or other skin concern bringing you in.';
        addClarification(session, current.question, rawTranscript, {
          relevance_status: 'irrelevant', clarification_question: clarification,
        }, attempt);
        persistSession(session);
        return res.json(sessionResponse(session, { needs_clarification: true, retry_current: true, clarification_question: clarification, out_of_scope: true }));
      }
    }
    if (!result.needs_clarification && result.relevance_status === 'relevant_complete' && requiresSensitiveConfirmation(current.question, result)) {
      session.pending_confirmation = { question_id: current.question.id, result, raw_transcript: rawTranscript };
      const prompt = confirmationPrompt(current.question, result);
      addClarification(session, current.question, rawTranscript, { ...result, clarification_question: prompt }, attempt);
      persistSession(session);
      return res.json(sessionResponse(session, { needs_clarification: true, retry_current: true, clarification_question: prompt }));
    }
    const lowConfidence = result.relevance_status === 'relevant_complete' && Number(result.confidence) < MIN_ANSWER_CONFIDENCE;
    if (result.needs_clarification || result.relevance_status !== 'relevant_complete' || lowConfidence) {
      const clarificationQuestion = lowConfidence
        ? `I may not have heard that correctly. Please answer again. ${current.question.text}`
        : result.clarification_question || `I need a clearer answer. ${current.question.text}`;
      result.needs_clarification = true;
      result.clarification_question = clarificationQuestion;
      addClarification(session, current.question, rawTranscript, result, attempt);
      persistSession(session);
      return res.json(sessionResponse(session, { needs_clarification: true, retry_current: true, clarification_question: clarificationQuestion }));
    }
    const record = saveAnswer(form, session, current.section, current.question, result, rawTranscript, attempt);
    const schemaEscalation = evaluateEscalation(session, current.section, current.question, record);
    const dangerEscalation = evaluateImmediateDanger(session, current.section, current.question, rawTranscript, record.corrected_answer);
    const escalation = schemaEscalation || dangerEscalation;
    if (schemaEscalation) await dispatchAlert(session, schemaEscalation);
    if (dangerEscalation && dangerEscalation !== schemaEscalation) await dispatchAlert(session, dangerEscalation);
    res.json(sessionResponse(session, {
      saved_answer: record,
      escalation: escalation ? {
        action: escalation.action,
        message: 'Thank you. One of your answers may require prompt attention. A staff member has been notified to assist you.',
      } : null,
    }));
  } catch (error) {
    next(error);
  }
});

function handleCommand(res, session, current, command) {
  if (command === 'repeat') return res.json(sessionResponse(session, { message: current.question.text, replay: true }));
  if (command === 'skip') {
    if (current.question.required) return res.json(sessionResponse(session, { needs_clarification: true, retry_current: true, clarification_question: `This answer is required. Please answer the question. ${current.question.text}` }));
    markSkipped(session, current.section, current.question);
    return res.json(sessionResponse(session, { message: 'Question skipped.' }));
  }
  if (command === 'go_back') {
    const previousId = session.completed_question_ids.pop();
    if (!previousId) return res.json(sessionResponse(session, { message: 'There is no previous answer to correct.' }));
    session.answers = session.answers.filter(answer => answer.question_id !== previousId);
    session.current_question_id = previousId;
    const previous = getQuestion(form, previousId);
    persistSession(session);
    return res.json({ ...sessionResponse(session), question: makePublicQuestion(previous.section, previous.question), message: 'Please give the corrected answer.' });
  }
  if (command === 'start_again') {
    const replacement = createSession(form, session.kiosk_id);
    sessions.set(replacement.visit_id, replacement);
    session.form_completion_status = 'abandoned'; session.timestamp_end = now(); persistSession(session);
    return res.status(201).json(sessionResponse(replacement, { message: 'A new interview has started.' }));
  }
  if (command === 'call_staff' || command === 'end_interview' || command === 'finish_early') {
    session.form_completion_status = command === 'end_interview' ? 'abandoned' : 'transferred_to_staff';
    session.completion_reason = command === 'finish_early' ? 'patient_ended_early_with_partial_report' : command;
    session.timestamp_end = now();
    if (command === 'call_staff' || command === 'finish_early') session.alerts.push({ action: command === 'call_staff' ? 'staff_assistance_requested' : 'partial_intake_ready', visit_id: session.visit_id, timestamp: now(), delivery_status: 'queued' });
    persistSession(session);
    const message = command === 'call_staff' ? 'A staff member has been requested.' : command === 'finish_early' ? 'The interview ended early. A partial intake report has been created for staff review.' : 'The interview has ended.';
    return res.json({ ...sessionResponse(session), message });
  }
  return res.status(400).json({ error: 'Unsupported command.' });
}

app.post('/api/sessions/:visitId/photo', photoUpload.single('photo'), (req, res, next) => {
  try {
    const session = getSessionOrRespond(req, res);
    if (!session) return;
    const current = getQuestion(form, session.current_question_id);
    if (!current || current.question.type !== 'image_upload') throw new Error('Photo capture is not currently eligible.');
    if (answerMap(session)[current.question.consent_ref] !== true) throw new Error('Explicit photo consent is required.');
    if (!req.file) return res.status(400).json({ error: 'A JPEG, PNG, or WebP photo is required.' });
    const metadata = {
      image_id: path.parse(req.file.filename).name, visit_id: session.visit_id, kiosk_id: session.kiosk_id,
      consent_question_id: current.question.consent_ref, consent_timestamp: session.answers.find(a => a.question_id === current.question.consent_ref)?.answered_at,
      capture_timestamp: now(), retention_category: current.question.retention_note || 'clinical_intake_photo',
      access_control: 'clinical_staff_only', storage_path: path.relative(DATA_DIR, req.file.path),
    };
    const result = { corrected_answer: 'Photo captured with explicit consent.', structured_value: metadata, relevance_status: 'relevant_complete', confidence: 1 };
    const record = saveAnswer(form, session, current.section, current.question, result, '', 1);
    res.json(sessionResponse(session, { saved_answer: record, message: 'Photo saved securely for the consultation.' }));
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    next(error);
  }
});

app.post('/api/sessions/:visitId/reopen-last', (req, res) => {
  const session = getSessionOrRespond(req, res);
  if (!session) return;
  const previousId = session.completed_question_ids.pop();
  if (!previousId) return res.status(409).json({ error: 'There is no answer to correct.' });
  session.answers = session.answers.filter(answer => answer.question_id !== previousId);
  session.form_completion_status = 'in_progress'; session.timestamp_end = null; session.current_question_id = previousId;
  const previous = getQuestion(form, previousId);
  persistSession(session);
  res.json({ ...sessionResponse(session), question: makePublicQuestion(previous.section, previous.question), message: 'Please give the corrected answer.' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    googleCredentialsConfigured: Boolean(
      process.env.GOOGLE_CLOUD_CREDENTIALS_JSON
      || (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS))
    ),
    sttProvider: STT_PROVIDER,
    sttModel: STT_PROVIDER === 'openai' ? OPENAI_REALTIME_STT_MODEL : INTAKE_SPEECH_MODEL,
    realtimeStreaming: true,
    deployment: IS_VERCEL ? 'vercel' : 'node-server',
    storageMode: IS_VERCEL ? 'ephemeral-/tmp' : 'local-filesystem',
    loadedMedicalPhraseHints: medicalPhrases.length,
    activeMedicalPhraseHints: getActiveMedicalPhrases().length,
  });
});

app.post('/api/clean-transcript', (req, res) => {
  const rawTranscript = req.body?.transcription || '';
  const cleanedTranscript = cleanTranscript(rawTranscript);

  res.json({
    success: true,
    rawTranscription: rawTranscript,
    transcription: cleanedTranscript,
  });
});

app.post('/api/translate-transcript', (req, res) => {
  res.status(410).json({ error: 'Translation is disabled. This intake operates in English only.' });
});

// Real-time Speech-to-Text endpoint.
wss.on('connection', (ws) => {
  let recognizeStream = null;
  let streamStarted = false;

  const sendJson = (payload) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const startGoogleStream = (options = {}) => {
    const encoding = options.encoding || getAudioEncoding(options.mimeType, options.filename) || 'WEBM_OPUS';
    const config = buildRecognitionConfig(encoding, options.sampleRateHertz, INTAKE_LANGUAGE_CODE, options);

    recognizeStream = getSpeechClient()
      .streamingRecognize({
        config,
        interimResults: true,
        singleUtterance: false,
      })
      .on('error', (error) => {
        console.error('Streaming transcription error:', error);
        sendJson({
          type: 'error',
          message: error.message,
          setupHint: 'Check GOOGLE_APPLICATION_CREDENTIALS and make sure Cloud Speech-to-Text is enabled.',
        });
      })
      .on('data', (data) => {
        const result = data.results?.[0];
        const alternative = result?.alternatives?.[0];

        if (!alternative?.transcript) {
          return;
        }

        sendJson({
          type: 'transcript',
          transcript: alternative.transcript,
          alternatives: (result.alternatives || []).map(item => item.transcript).filter(Boolean),
          isFinal: Boolean(result.isFinal),
          confidence: typeof alternative.confidence === 'number'
            ? (alternative.confidence * 100).toFixed(2)
            : null,
        });
      });

    streamStarted = true;
    console.log(`Streaming ${encoding} English audio to Google Cloud Speech-to-Text...`);
    sendJson({ type: 'ready', encoding, sampleRateHertz: config.sampleRateHertz || 24000, provider: 'google', model: config.model });
  };

  const startOpenAIStream = () => {
    try {
      recognizeStream = createOpenAIRealtimeTranscriber({
        apiKey: process.env.OPENAI_API_KEY,
        model: OPENAI_REALTIME_STT_MODEL,
        sessionModel: OPENAI_REALTIME_SESSION_MODEL,
        onReady: () => sendJson({ type: 'ready', encoding: 'LINEAR16', sampleRateHertz: 24000, provider: 'openai', model: OPENAI_REALTIME_STT_MODEL }),
        onTranscript: transcript => sendJson({ type: 'transcript', ...transcript }),
        onError: error => {
          console.error('OpenAI realtime transcription error:', error.message);
          sendJson({ type: 'error', message: error.message, setupHint: 'Check OPENAI_API_KEY and OpenAI realtime model access.' });
        },
      });
      streamStarted = true;
      console.log(`Streaming LINEAR16 English audio to OpenAI ${OPENAI_REALTIME_STT_MODEL}...`);
    } catch (error) {
      sendJson({ type: 'error', message: error.message });
    }
  };

  const startConfiguredStream = options => {
    if (STT_PROVIDER === 'openai') startOpenAIStream(options);
    else startGoogleStream(options);
  };

  ws.on('message', (message, isBinary) => {
    if (!isBinary) {
      try {
        const payload = JSON.parse(message.toString());

        if (payload.type === 'start') {
          startConfiguredStream(payload);
        }

        if (payload.type === 'stop' && recognizeStream) {
          console.log('Finishing live transcription stream.');
          recognizeStream.end();
          recognizeStream = null;
        }
      } catch (error) {
        sendJson({ type: 'error', message: error.message || 'Invalid streaming control message.' });
      }

      return;
    }

    if (!streamStarted) {
      startConfiguredStream();
    }

    if (recognizeStream?.writable) {
      recognizeStream.write(message);
    }
  });

  ws.on('close', () => {
    if (recognizeStream) {
      if (STT_PROVIDER === 'openai') recognizeStream.close();
      else recognizeStream.end();
      recognizeStream = null;
    }
  });
});

// Speech-to-Text endpoint using medical model
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (req.get('X-Allow-Legacy-Upload') !== 'true') {
      return res.status(410).json({
        error: 'The recorded-audio upload flow has been replaced by live streaming.',
        details: 'Close this browser tab, reopen http://localhost:3000, and use Speak answer.',
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const audioBuffer = req.file.buffer;
    const encoding = getAudioEncoding(req.file.mimetype, req.file.originalname);

    if (!encoding) {
      return res.status(400).json({
        error: 'Unsupported audio format',
        details: `Received MIME type "${req.file.mimetype || 'unknown'}". Please upload MP3, WAV, WebM/Opus, or OGG/Opus audio.`,
      });
    }

    const languageCode = 'en-US';
    const translateToEnglish = false;
    const config = buildRecognitionConfig(encoding, null, languageCode);

    const request = {
      config,
      audio: {
        content: audioBuffer.toString('base64'),
      },
    };

    console.log(`Sending ${encoding} audio to Google Cloud Speech-to-Text API...`);
    
    // Call the asynchronous recognize method
    const [response] = await getSpeechClient().recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    const cleanedTranscription = cleanTranscript(transcription);
    const outputTranscription = cleanedTranscription;

    // Calculate confidence score
    const confidences = response.results
      .map(result => result.alternatives[0].confidence)
      .filter(confidence => typeof confidence === 'number');
    const confidence = confidences.length
      ? confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length
      : 0;

    res.json({
      success: true,
      rawTranscription: transcription,
      transcription: outputTranscription,
      sourceTranscription: cleanedTranscription,
      translatedToEnglish: false,
      languageCode,
      confidence: (confidence * 100).toFixed(2),
      encoding,
      resultCount: response.results.length,
    });
  } catch (error) {
    console.error('Error during transcription:', error);
    res.status(500).json({
      error: 'Transcription failed',
      details: error.message,
      setupHint: 'Check that GOOGLE_APPLICATION_CREDENTIALS points to a valid service account JSON key and that Cloud Speech-to-Text is enabled for the project.',
    });
  }
});

function buildRecognitionConfig(encoding, sampleRateHertz, languageCode = INTAKE_LANGUAGE_CODE, questionContext = {}) {
  const resolvedSampleRateHertz = Number(sampleRateHertz) || null;
  const speechLanguages = resolveSpeechLanguages(languageCode);
  const config = {
    encoding,
    languageCode: speechLanguages.primaryLanguageCode,
    profanityFilter: false,
    enableAutomaticPunctuation: true,
    enableWordConfidence: true,
    maxAlternatives: 3,
    model: INTAKE_SPEECH_MODEL,
    useEnhanced: false,
  };

  if (speechLanguages.alternativeLanguageCodes.length) {
    config.alternativeLanguageCodes = speechLanguages.alternativeLanguageCodes;
  }

  const optionPhrases = Array.isArray(questionContext.options)
    ? questionContext.options.filter(value => typeof value === 'string').slice(0, 30)
    : [];
  const skinComplaintPhrases = questionContext.questionId === 'C01'
    ? ['rash', 'skin rash', 'itching', 'itchy skin', 'acne', 'pimple', 'eczema', 'psoriasis', 'mole', 'skin lesion', 'wound', 'pigmentation', 'skin patch', 'blister', 'dry skin']
    : [];
  const contextPhrases = [...new Set([...optionPhrases, ...skinComplaintPhrases])];
  if (contextPhrases.length) {
    config.speechContexts = [{ phrases: contextPhrases, boost: questionContext.questionId === 'C01' ? 8 : 5 }];
  }

  if (encoding === 'LINEAR16') {
    config.sampleRateHertz = resolvedSampleRateHertz || DEFAULT_SAMPLE_RATE_HERTZ;
  }

  if (encoding === 'WEBM_OPUS' || encoding === 'OGG_OPUS') {
    config.sampleRateHertz = resolvedSampleRateHertz || OPUS_SAMPLE_RATE_HERTZ;
  }

  return config;
}

function resolveSpeechLanguages(languageCode) {
  return { primaryLanguageCode: languageCode.startsWith('en') ? languageCode : INTAKE_LANGUAGE_CODE, alternativeLanguageCodes: [] };
}

function getActiveMedicalPhrases() {
  return medicalPhrases.slice(0, MAX_SPEECH_CONTEXT_PHRASES);
}

// Utility function to determine audio encoding
function getAudioEncoding(mimetype = '', filename = '') {
  const normalizedMimeType = mimetype.toLowerCase().split(';')[0];
  const extension = path.extname(filename).toLowerCase();

  switch (normalizedMimeType) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'MP3';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'LINEAR16';
    case 'audio/webm':
      return 'WEBM_OPUS';
    case 'audio/ogg':
      return 'OGG_OPUS';
    default:
      switch (extension) {
        case '.mp3':
          return 'MP3';
        case '.wav':
          return 'LINEAR16';
        case '.webm':
          return 'WEBM_OPUS';
        case '.ogg':
        case '.oga':
          return 'OGG_OPUS';
        default:
          return null;
      }
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing server before running npm start again.`);
    process.exit(1);
  }
  throw error;
});
wss.on('error', error => {
  if (error.code !== 'EADDRINUSE') console.error('WebSocket server error:', error.message);
});
if (!IS_VERCEL) {
  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Google Cloud Speech-to-Text integrated (${INTAKE_SPEECH_MODEL}, ${INTAKE_LANGUAGE_CODE})`);
    console.log(`Active speech-to-text provider: ${STT_PROVIDER === 'openai' ? `OpenAI ${OPENAI_REALTIME_STT_MODEL}` : `Google ${INTAKE_SPEECH_MODEL}`}`);
    console.log('Real-time streaming endpoint ready at ws://localhost:%s/api/stream', PORT);
  });
}

module.exports = server;
module.exports.app = app;
