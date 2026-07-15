let visitId = null;
let currentQuestion = null;
let mediaStream = null;
let audioContext = null;
let audioSource = null;
let audioProcessor = null;
let workletReady = false;
let recordingPreparation = null;
let streamSocket = null;
let finalTranscript = '';
let interimTranscript = '';
let recordingTimeout = null;
let silenceInterval = null;
let speechDetected = false;
let lastSpeechAt = 0;
let isStopping = false;
let recognitionAlternatives = [];
let speechSequence = 0;
let ttsAudioContext = null;
let ttsAudioSource = null;
let finalSubmitTimer = null;
let activeSttProvider = 'google';
let lastSpoken = '';

const $ = id => document.getElementById(id);
const welcome = $('welcome');
const interview = $('interview');
const complete = $('complete');
const status = $('status');
const recordBtn = $('recordBtn');
const stopBtn = $('stopBtn');
const botSpeaking = $('botSpeaking');

$('beginBtn').addEventListener('click', () => {
  unlockBrowserSpeech();
  startVisit();
});
$('newVisitBtn').addEventListener('click', startVisit);
$('recordBtn').addEventListener('click', startRecording);
$('stopBtn').addEventListener('click', stopRecording);
$('replayBtn').addEventListener('click', () => speak(lastSpoken || currentQuestion?.text, true));
$('submitTextBtn').addEventListener('click', submitTypedAnswer);
$('typedAnswer').addEventListener('keydown', event => { if (event.key === 'Enter') submitTypedAnswer(); });
$('optionHints').addEventListener('click', event => {
  const choice = event.target.closest('[data-option]');
  if (choice) submitAnswer(choice.dataset.option);
});
$('photoInput').addEventListener('change', previewPhoto);
$('uploadPhotoBtn').addEventListener('click', uploadPhoto);
$('correctLastBtn').addEventListener('click', reopenLast);
$('downloadPdfBtn').addEventListener('click', downloadPdfReport);
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => submitAnswer(button.dataset.command)));

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.details || 'The request failed.');
  return body;
}

async function startVisit() {
  try {
    setStatus('Creating a secure visit…', 'loading');
    const data = await api('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kiosk_id: 'KIOSK-DERM-01' }) });
    visitId = data.visit_id;
    document.body.classList.remove('landing-page');
    welcome.classList.add('hidden'); complete.classList.add('hidden'); interview.classList.remove('hidden');
    render(data);
  } catch (error) { setStatus(error.message, 'error'); }
}

function render(data) {
  if (data.visit_id) visitId = data.visit_id;
  if (data.escalation_flag) $('urgentBanner').classList.remove('hidden');
  if (data.escalation?.message) speak(data.escalation.message);
  if (data.status !== 'in_progress' || data.completed) return renderComplete(data);
  currentQuestion = data.question || data.current_question;
  if (!currentQuestion) return;
  interview.classList.remove('hidden'); complete.classList.add('hidden');
  $('sectionLabel').textContent = currentQuestion.section_title;
  $('progressLabel').textContent = `${data.progress.completed} of ${data.progress.total}`;
  $('progressBar').style.width = `${Math.max(3, data.progress.total ? data.progress.completed / data.progress.total * 100 : 0)}%`;
  $('questionNumber').textContent = `${currentQuestion.id}${currentQuestion.required ? ' · Required' : ' · Optional'}`;
  $('questionText').textContent = currentQuestion.text;
  $('optionHints').innerHTML = currentQuestion.options.map(option => `<button type="button" class="option-choice" data-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join('');
  if (currentQuestion.id === 'D01') $('optionHints').innerHTML = '<span>Tip: say your name, then spell it letter by letter if needed</span>';
  $('voicePanel').classList.toggle('hidden', currentQuestion.is_photo);
  $('photoPanel').classList.toggle('hidden', !currentQuestion.is_photo);
  $('typedAnswer').value = '';
  $('transcript').textContent = 'Press the microphone and speak your answer.';
  setStatus(data.needs_clarification ? data.clarification_question : (data.message || ''), data.needs_clarification ? 'attention' : '');
  const questionSpeech = `${currentQuestion.text}${currentQuestion.id === 'D01' ? ' You may spell it letter by letter.' : ''}`;
  const spoken = data.needs_clarification ? data.clarification_question : `${data.welcome_message ? `${data.welcome_message} ` : ''}${questionSpeech}`;
  speak(spoken, true);
  if (data.welcome_message) lastSpoken = questionSpeech;
}

function renderComplete(data) {
  cleanupRecorder(true);
  interview.classList.add('hidden'); complete.classList.remove('hidden'); welcome.classList.add('hidden');
  const finished = data.status === 'completed';
  const partial = data.ehr_report?.visit?.completion_reason === 'patient_ended_early_with_partial_report';
  $('completeTitle').textContent = finished ? 'Intake complete' : partial ? 'Partial intake report' : data.status === 'transferred_to_staff' ? 'Staff assistance requested' : 'Interview ended';
  $('completeMessage').textContent = data.message || (finished ? 'Thank you. Your answers are ready for the doctor.' : 'A staff member can help you continue.');
  $('correctLastBtn').classList.toggle('hidden', !finished);
  $('downloadPdfBtn').classList.toggle('hidden', !data.ehr_report);
  $('summary').innerHTML = data.ehr_report ? renderEhrReport(data.ehr_report) : (data.summary || []).map(item => `<div class="summary-item"><strong>${escapeHtml(item.question)}</strong><span>Patient said: ${escapeHtml(formatValue(item.patient_provided))}</span><span>Structured: ${escapeHtml(formatValue(item.structured_value))}</span></div>`).join('');
  speak($('completeMessage').textContent);
}

async function submitTypedAnswer() {
  const value = $('typedAnswer').value.trim();
  if (!value) return setStatus('Please type an answer first.', 'attention');
  await submitAnswer(value);
}

async function submitAnswer(raw) {
  if (!visitId || !currentQuestion) return;
  if (audioProcessor && !isStopping) cleanupRecorder();
  try {
    setBusy(true); setStatus('Checking your answer…', 'loading');
    const data = await api(`/api/sessions/${encodeURIComponent(visitId)}/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_transcript: raw, transcription_alternatives: recognitionAlternatives }),
    });
    render(data);
  } catch (error) { setStatus(error.message, 'error'); }
  finally { setBusy(false); }
}

async function startRecording() {
  if (audioProcessor) return;
  recordBtn.classList.add('hidden');
  stopBtn.classList.add('hidden');
  setStatus('Activating the microphone. Please wait…', 'loading');
  try {
    await ensureMicrophonePrepared();
    finalTranscript = ''; interimTranscript = ''; recognitionAlternatives = [];
    speechDetected = false; lastSpeechAt = 0; isStopping = false;
    audioSource = audioContext.createMediaStreamSource(mediaStream);
    audioProcessor = new AudioWorkletNode(audioContext, 'pcm-processor', { processorOptions: { targetSampleRate: 24000 } });
    audioProcessor.port.onmessage = event => {
      if (streamSocket?.readyState === WebSocket.OPEN) streamSocket.send(event.data);
      const samples = new Int16Array(event.data);
      let energy = 0;
      for (let index = 0; index < samples.length; index += 8) energy += (samples[index] / 32768) ** 2;
      const rms = Math.sqrt(energy / Math.max(1, Math.ceil(samples.length / 8)));
      if (rms > 0.018) { speechDetected = true; lastSpeechAt = Date.now(); }
    };
    audioSource.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
    recordingTimeout = setTimeout(() => {
      setStatus('Maximum answer time reached. Submitting what I heard…', 'attention');
      stopRecording();
    }, 15000);
    silenceInterval = setInterval(() => {
      if (speechDetected && lastSpeechAt && Date.now() - lastSpeechAt > 1400) {
        setStatus('Speech finished. Submitting your answer…', 'loading');
        stopRecording();
      }
    }, 250);
    recordBtn.classList.add('hidden'); stopBtn.classList.remove('hidden');
    $('voicePanel').classList.add('is-listening');
    $('transcript').textContent = 'Listening now — please speak.';
    setStatus('Microphone ready — speak now.', 'recording');
  } catch (error) {
    cleanupRecorder();
    setStatus(`Voice input unavailable: ${error.message}. You can type your answer below.`, 'error');
  }
}

async function stopRecording() {
  if (isStopping) return;
  isStopping = true;
  stopBtn.disabled = true;
  if (streamSocket?.readyState === WebSocket.OPEN) streamSocket.send(JSON.stringify({ type: 'stop' }));
  await new Promise(resolve => setTimeout(resolve, activeSttProvider === 'openai' ? 2400 : 900));
  const raw = [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim();
  if (streamSocket?.readyState === WebSocket.OPEN) streamSocket.close();
  cleanupRecorder();
  recordBtn.classList.remove('hidden'); stopBtn.classList.add('hidden');
  stopBtn.disabled = false;
  if (raw) {
    $('transcript').textContent = raw;
    await submitAnswer(raw);
  } else {
    $('transcript').textContent = 'No speech was detected.';
    const retryMessage = `I did not hear an answer. Let me ask again. ${currentQuestion?.text || ''}`;
    setStatus('No speech was detected. The question will repeat automatically.', 'attention');
    setTimeout(() => {
      if (currentQuestion && !interview.classList.contains('hidden')) speak(retryMessage, true);
    }, 500);
  }
}

function cleanupRecorder(releaseMedia = false) {
  clearTimeout(recordingTimeout); recordingTimeout = null;
  clearTimeout(finalSubmitTimer); finalSubmitTimer = null;
  clearInterval(silenceInterval); silenceInterval = null;
  if (audioProcessor) { audioProcessor.disconnect(); audioProcessor.port.onmessage = null; audioProcessor = null; }
  if (audioSource) { audioSource.disconnect(); audioSource = null; }
  if (releaseMedia) {
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null; workletReady = false;
    mediaStream?.getTracks().forEach(track => track.stop()); mediaStream = null;
  }
  if (streamSocket && streamSocket.readyState <= WebSocket.OPEN) {
    try { streamSocket.close(); } catch {}
  }
  streamSocket = null; isStopping = false;
  $('voicePanel').classList.remove('is-listening');
  recordBtn.classList.remove('hidden'); stopBtn.classList.add('hidden');
}

function hasLiveMicrophone() {
  return mediaStream?.getAudioTracks().some(track => track.readyState === 'live');
}

async function ensureMicrophonePrepared() {
  if (recordingPreparation) return recordingPreparation;
  recordingPreparation = (async () => {
    if (!hasLiveMicrophone()) {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    }
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContext();
      workletReady = false;
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (!workletReady) {
      await audioContext.audioWorklet.addModule('pcm-processor.js');
      workletReady = true;
    }
    if (!streamSocket || streamSocket.readyState > WebSocket.OPEN) {
      streamSocket = createStreamSocket();
      await waitForSocketOpen(streamSocket);
      await streamSocket.speechReady;
    }
  })();
  try { await recordingPreparation; }
  finally { recordingPreparation = null; }
}

function createStreamSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/api/stream`);
  socket.binaryType = 'arraybuffer';
  let resolveSpeechReady;
  let rejectSpeechReady;
  socket.speechReady = new Promise((resolve, reject) => { resolveSpeechReady = resolve; rejectSpeechReady = reject; });
  socket.speechReady.catch(() => {});
  socket.addEventListener('open', () => socket.send(JSON.stringify({
    type: 'start', encoding: 'LINEAR16', sampleRateHertz: 24000, languageCode: 'en-IN',
    questionId: currentQuestion?.id, questionType: currentQuestion?.type, options: currentQuestion?.options || [],
  })));
  socket.addEventListener('message', event => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'ready') {
      activeSttProvider = payload.provider || 'google';
      resolveSpeechReady();
      if (audioProcessor) setStatus('Microphone ready — speak now.', 'recording');
      return;
    }
    if (payload.type === 'transcript') {
      if (Array.isArray(payload.alternatives)) recognitionAlternatives = [...new Set([...recognitionAlternatives, ...payload.alternatives])].slice(0, 3);
      if (payload.isFinal) {
        finalTranscript = `${finalTranscript} ${payload.transcript}`.trim(); interimTranscript = '';
        clearTimeout(finalSubmitTimer);
        finalSubmitTimer = setTimeout(() => {
          setStatus('Answer recognized. Submitting…', 'loading');
          stopRecording();
        }, 550);
      }
      else interimTranscript = payload.transcript;
      $('transcript').textContent = [finalTranscript, interimTranscript].filter(Boolean).join(' ') || 'Listening…';
      return;
    }
    if (payload.type === 'error') {
      setStatus(`Speech service error: ${payload.message}. You can type your answer below.`, 'error');
      cleanupRecorder();
    }
  });
  socket.addEventListener('error', () => {
    rejectSpeechReady(new Error('Speech connection failed'));
    setStatus('Could not connect to live speech recognition. You can type your answer below.', 'error');
    cleanupRecorder();
  });
  return socket;
}

function waitForSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Speech connection failed')), { once: true });
  });
}

function previewPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  $('photoPreview').src = URL.createObjectURL(file); $('photoPreview').classList.remove('hidden'); $('uploadPhotoBtn').disabled = false;
}

async function uploadPhoto() {
  const file = $('photoInput').files[0]; if (!file) return;
  try {
    setBusy(true); setStatus('Saving the photo…', 'loading');
    const body = new FormData(); body.append('photo', file);
    render(await api(`/api/sessions/${encodeURIComponent(visitId)}/photo`, { method: 'POST', body }));
  } catch (error) { setStatus(error.message, 'error'); }
  finally { setBusy(false); }
}

async function reopenLast() {
  try { render(await api(`/api/sessions/${encodeURIComponent(visitId)}/reopen-last`, { method: 'POST' })); }
  catch (error) { setStatus(error.message, 'error'); }
}

async function speak(text, autoListen = false) {
  if (!text) return;
  const sequence = ++speechSequence;
  if (autoListen) {
    recordBtn.classList.add('hidden');
    ensureMicrophonePrepared().catch(error => console.warn('Microphone prewarm failed:', error.message));
  }
  setBotSpeaking(false);
  let completed = false;
  const finishSpeech = () => {
    if (completed || sequence !== speechSequence) return;
    completed = true;
    setBotSpeaking(false);
    if (autoListen && currentQuestion && !currentQuestion.is_photo && !interview.classList.contains('hidden')) {
      setStatus('Question finished. Activating microphone…', 'loading');
      startRecording();
    }
  };
  if (ttsAudioSource) { try { ttsAudioSource.stop(); } catch {} ttsAudioSource = null; }
  if (!status.textContent) setStatus('Speaking the question…', '');
  lastSpoken = text;
  try {
    if (!ttsAudioContext) throw new Error('Audio playback is not unlocked.');
    if (ttsAudioContext.state === 'suspended') await ttsAudioContext.resume();
    const response = await fetch('/api/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).details || 'Server voice request failed.');
    const buffer = await ttsAudioContext.decodeAudioData(await response.arrayBuffer());
    if (sequence !== speechSequence) return;
    const source = ttsAudioContext.createBufferSource();
    source.buffer = buffer; source.connect(ttsAudioContext.destination);
    source.onended = finishSpeech; ttsAudioSource = source; source.start(0);
    setBotSpeaking(true);
    setTimeout(finishSpeech, Math.max(12000, buffer.duration * 1000 + 2500));
  } catch (error) {
    console.warn('Server question audio failed; using browser voice:', error.message);
    speakWithBrowserVoice(text, sequence, finishSpeech);
  }
}

function unlockBrowserSpeech() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass && !ttsAudioContext) {
    ttsAudioContext = new AudioContextClass();
    ttsAudioContext.resume().catch(() => {});
  }
  if ('speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.resume(); }
}

function speakWithBrowserVoice(text, sequence, finishSpeech) {
  if (!('speechSynthesis' in window)) {
    setStatus('Question audio is unavailable. Starting the microphone now.', 'attention');
    finishSpeech();
    return;
  }
  speechSynthesis.cancel(); speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-IN'; utterance.rate = 0.88; utterance.volume = 1;
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(voice => voice.lang === 'en-IN') || voices.find(voice => voice.lang.startsWith('en-')) || null;
  utterance.onstart = () => { if (sequence === speechSequence) setBotSpeaking(true); };
  utterance.onend = finishSpeech;
  utterance.onerror = finishSpeech;
  setTimeout(() => { if (sequence === speechSequence) speechSynthesis.speak(utterance); }, 80);
  setTimeout(finishSpeech, Math.max(8000, text.length * 110));
}

function setBotSpeaking(isSpeaking) {
  if (!botSpeaking) return;
  botSpeaking.classList.toggle('hidden', !isSpeaking);
}

async function downloadPdfReport() {
  if (!visitId) return;
  const button = $('downloadPdfBtn');
  const original = button.innerHTML;
  try {
    button.disabled = true;
    button.textContent = 'Preparing PDF…';
    const response = await fetch(`/api/sessions/${encodeURIComponent(visitId)}/report.pdf`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'The PDF could not be generated.');
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `dermatology-intake-${visitId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function renderEhrReport(report) {
  const patient = report.patient || {};
  const patientRows = [
    ['Name', patient.name], ['Age / date of birth', patient.age_or_date_of_birth],
    ['Sex / gender', patient.sex_or_gender], ['Contact number', patient.contact_number], ['City / area', patient.city_or_area],
    ['Consultation language', report.visit?.language],
  ].map(([label, value]) => `<div class="ehr-field"><span>${escapeHtml(label)}</span><strong class="${value == null ? 'blank-answer' : ''}">${escapeHtml(formatEhrValue(value))}</strong></div>`).join('');
  const urgent = Boolean(report.triage?.escalation_flag);
  const triage = `<div class="ehr-triage ${urgent ? 'urgent' : ''}"><div class="triage-icon">${urgent ? '!' : '✓'}</div><div><strong>${urgent ? 'Possible urgent response recorded' : 'No automated escalation flag recorded'}</strong><span>${urgent ? 'Staff review has been requested.' : 'This indicator is workflow support and not a clinical assessment.'}</span></div></div>`;
  const sections = (report.sections || []).map((section, index) => `<section class="ehr-section"><header><span>${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(section.title)}</h3></header><div class="ehr-table-head"><span>Question</span><span>Patient reported</span><span>Structured value</span></div>${section.entries.map(entry => `<div class="ehr-entry ${entry.status === 'not_answered' ? 'unanswered' : ''}"><strong>${escapeHtml(entry.label)}</strong><div data-label="Patient reported"><p>${escapeHtml(formatEhrValue(entry.patient_reported))}</p></div><div data-label="Structured value"><p>${escapeHtml(formatEhrValue(entry.structured_value))}</p></div></div>`).join('')}</section>`).join('');
  return `<article class="ehr-document"><header class="ehr-header"><div class="ehr-brand"><div class="ehr-logo">+</div><div><p>Dermatology outpatient department</p><h2>Pre-Consultation Intake Report</h2><span>AI-assisted patient interview · For clinician review</span></div></div><div class="ehr-status ${urgent ? 'urgent' : ''}">${urgent ? 'Urgent review' : 'Intake report'}</div></header><div class="ehr-meta"><div><span>Visit ID</span><strong>${escapeHtml(report.visit.visit_id)}</strong></div><div><span>Completion</span><strong>${escapeHtml(formatCompletionStatus(report.visit))}</strong></div><div><span>Report time</span><strong>${escapeHtml(formatReportDate(report.visit.ended_at))}</strong></div></div><section class="ehr-patient"><div class="ehr-section-title"><span>Patient overview</span></div><div class="ehr-grid">${patientRows}</div></section>${triage}${sections}<footer class="ehr-disclaimer"><strong>Clinical disclaimer</strong><span>${escapeHtml(report.disclaimer)}</span></footer></article>`;
}

function setBusy(busy) { document.querySelectorAll('button').forEach(button => { if (!button.matches('#uploadPhotoBtn')) button.disabled = busy; }); }
function setStatus(message, type = '') { status.textContent = message || ''; status.className = `status ${type}`; }
function formatValue(value) { return value == null ? 'Not provided' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function formatEhrValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    if (value.age != null) return `${value.age} years`;
    if (value.date_of_birth) return value.date_of_birth;
    return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${formatEhrValue(item)}`).join(', ');
  }
  return String(value);
}
function formatReportDate(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
function formatCompletionStatus(visit = {}) { if (visit.completion_reason === 'patient_ended_early_with_partial_report') return 'Partial intake'; return ({ completed: 'Complete', transferred_to_staff: 'Staff review', abandoned: 'Ended' })[visit.completion_status] || String(visit.completion_status || '').replaceAll('_', ' '); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
