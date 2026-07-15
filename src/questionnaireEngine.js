const crypto = require('crypto');

const TERMINAL_STATUSES = new Set(['completed', 'abandoned', 'transferred_to_staff']);

function now() {
  return new Date().toISOString();
}

function createVisitId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `VISIT-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function createSession(form, kioskId = 'KIOSK-DERM-01') {
  return {
    visit_id: createVisitId(),
    form_id: form.form_id,
    form_version: form.version,
    kiosk_id: kioskId,
    language_used: 'English',
    timestamp_start: now(),
    timestamp_end: null,
    current_section_id: null,
    current_question_id: null,
    completed_question_ids: [],
    skipped_question_ids: [],
    answers: [],
    clarification_history: {},
    pending_confirmation: null,
    escalation_flag: false,
    escalation_details: [],
    alerts: [],
    form_completion_status: 'in_progress',
  };
}

function answerMap(session) {
  return Object.fromEntries(session.answers.map(answer => [answer.question_id, answer.structured_value]));
}

function conditionMatches(condition, answers) {
  if (!condition) return true;
  const actual = answers[condition.if];
  if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return actual === condition.equals;
  if (Array.isArray(condition.in)) return condition.in.includes(actual);
  if (Object.prototype.hasOwnProperty.call(condition, 'not_equals')) return actual !== condition.not_equals;
  return false;
}

function getQuestion(form, questionId) {
  for (const section of form.sections) {
    const question = section.questions.find(item => item.id === questionId);
    if (question) return { section, question };
  }
  return null;
}

function getEligibleQuestions(form, session) {
  const answers = answerMap(session);
  return form.sections.flatMap(section => {
    if (!conditionMatches(section.condition, answers)) return [];
    return section.questions
      .filter(question => conditionMatches(question.condition, answers))
      .filter(question => !question.consent_ref || answers[question.consent_ref] === true)
      .map(question => ({ section, question }));
  });
}

function findNextQuestion(form, session) {
  if (TERMINAL_STATUSES.has(session.form_completion_status)) return null;
  const done = new Set([...session.completed_question_ids, ...session.skipped_question_ids]);
  const next = getEligibleQuestions(form, session).find(({ question }) => !done.has(question.id));
  if (!next) return null;
  session.current_section_id = next.section.section_id;
  session.current_question_id = next.question.id;
  return next;
}

function makePublicQuestion(section, question) {
  return {
    section_id: section.section_id,
    section_title: section.title,
    critical: Boolean(section.critical),
    id: question.id,
    text: question.text,
    type: question.type,
    options: question.options || [],
    required: Boolean(question.required),
    is_photo: question.type === 'image_upload',
  };
}

function getProgress(form, session) {
  const eligible = getEligibleQuestions(form, session);
  const done = new Set([...session.completed_question_ids, ...session.skipped_question_ids]);
  return {
    completed: eligible.filter(({ question }) => done.has(question.id)).length,
    total: eligible.length,
  };
}

function saveAnswer(form, session, section, question, result, rawTranscript, attemptNumber) {
  const record = {
    visit_id: session.visit_id,
    form_id: form.form_id,
    section_id: section.section_id,
    question_id: question.id,
    question_text: question.text,
    question_type: question.type,
    raw_transcript: rawTranscript,
    corrected_answer: result.corrected_answer,
    structured_value: result.structured_value,
    relevance_status: result.relevance_status,
    confidence: result.confidence,
    needs_clarification: false,
    clarification_question: null,
    clarification_history: session.clarification_history[question.id] || [],
    attempt_number: attemptNumber,
    provenance: result.provenance || 'asked',
    source_question_id: result.source_question_id || question.id,
    answered_at: now(),
  };
  session.answers = session.answers.filter(answer => answer.question_id !== question.id);
  session.answers.push(record);
  if (question.id === 'D07' && typeof result.structured_value === 'string') {
    session.language_used = result.structured_value;
  }
  if (!session.completed_question_ids.includes(question.id)) session.completed_question_ids.push(question.id);
  session.skipped_question_ids = session.skipped_question_ids.filter(id => id !== question.id);
  return record;
}

function addClarification(session, question, rawTranscript, result, attemptNumber) {
  const entry = {
    raw_transcript: rawTranscript,
    relevance_status: result.relevance_status,
    clarification_question: result.clarification_question,
    attempt_number: attemptNumber,
    timestamp: now(),
  };
  session.clarification_history[question.id] ||= [];
  session.clarification_history[question.id].push(entry);
  return entry;
}

function evaluateEscalation(session, section, question, answer) {
  if (!section.critical || question.flag_if !== true || answer.structured_value !== true) return null;
  const existing = session.escalation_details.find(item => item.triggering_question_id === question.id);
  if (existing) return existing;
  const detail = {
    action: section.escalation?.action || 'alert_front_desk_immediately',
    configured_message: section.escalation?.message || 'Urgent response requires staff attention.',
    visit_id: session.visit_id,
    patient_name: answerMap(session).D01 || null,
    triggering_question_id: question.id,
    triggering_question: question.text,
    corrected_answer: answer.corrected_answer,
    timestamp: now(),
    kiosk_id: session.kiosk_id,
    priority: 'urgent',
  };
  session.escalation_flag = true;
  session.escalation_details.push(detail);
  session.alerts.push({ ...detail, delivery_status: 'queued' });
  return detail;
}

function evaluateImmediateDanger(session, section, question, rawTranscript, correctedAnswer = null) {
  const text = String(rawTranscript || '').toLowerCase();
  const dangerous = /\b(difficulty|trouble|struggling) (?:with )?breathing\b|\b(can't|cannot|unable to) breathe\b|\bsevere (?:facial|face) swelling\b/.test(text);
  const negated = /\b(no|not|without|don't have|do not have)\b.{0,25}\b(difficulty|trouble|swelling|breath)/.test(text);
  if (!dangerous || negated) return null;
  const existing = session.escalation_details.find(item => item.immediate_danger && item.triggering_question_id === question.id);
  if (existing) return existing;
  const detail = {
    action: 'alert_front_desk_immediately', visit_id: session.visit_id, patient_name: answerMap(session).D01 || null,
    triggering_question_id: question.id, triggering_question: question.text,
    corrected_answer: correctedAnswer || rawTranscript, timestamp: now(), kiosk_id: session.kiosk_id,
    priority: 'high_priority', immediate_danger: true,
  };
  session.escalation_flag = true;
  session.escalation_details.push(detail);
  session.alerts.push({ ...detail, delivery_status: 'queued' });
  return detail;
}

function markSkipped(session, section, question, reason = 'patient_declined') {
  if (question.required) throw new Error('Required questions cannot be skipped.');
  if (!session.skipped_question_ids.includes(question.id)) session.skipped_question_ids.push(question.id);
  session.current_section_id = section.section_id;
  session.current_question_id = question.id;
  session.answers = session.answers.filter(answer => answer.question_id !== question.id);
  session.answers.push({
    visit_id: session.visit_id,
    section_id: section.section_id,
    question_id: question.id,
    question_text: question.text,
    question_type: question.type,
    status: 'skipped',
    reason,
    raw_transcript: '',
    corrected_answer: null,
    structured_value: null,
    answered_at: now(),
  });
}

function requiredQuestionsMissing(form, session) {
  const completed = new Set(session.completed_question_ids);
  return getEligibleQuestions(form, session)
    .filter(({ question }) => question.required && !completed.has(question.id))
    .map(({ question }) => question.id);
}

function completeIfReady(form, session) {
  if (session.form_completion_status !== 'in_progress') return false;
  if (findNextQuestion(form, session)) return false;
  if (requiredQuestionsMissing(form, session).length) return false;
  session.form_completion_status = 'completed';
  session.timestamp_end = now();
  session.current_section_id = null;
  session.current_question_id = null;
  session.alerts.push({ action: 'intake_complete', visit_id: session.visit_id, timestamp: now(), delivery_status: 'queued' });
  return true;
}

module.exports = {
  TERMINAL_STATUSES,
  answerMap,
  completeIfReady,
  conditionMatches,
  createSession,
  evaluateEscalation,
  evaluateImmediateDanger,
  findNextQuestion,
  getEligibleQuestions,
  getProgress,
  getQuestion,
  makePublicQuestion,
  markSkipped,
  now,
  requiredQuestionsMissing,
  saveAnswer,
  addClarification,
};
