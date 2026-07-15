const test = require('node:test');
const assert = require('node:assert/strict');
const form = require('../bot.json');
const { extractVolunteeredAnswers, localProcess, validateAdditionalAnswers, validateLlmResult } = require('../src/answerProcessor');
const { isHairOnlyConcern, validateChiefComplaintScope } = require('../src/scopeValidator');
const {
  answerMap, createSession, evaluateEscalation, evaluateImmediateDanger, findNextQuestion, getEligibleQuestions,
  getQuestion, markSkipped, requiredQuestionsMissing, saveAnswer,
} = require('../src/questionnaireEngine');

function result(value, corrected = String(value)) {
  return { corrected_answer: corrected, structured_value: value, relevance_status: 'relevant_complete', confidence: 0.9 };
}

function answer(session, id, value) {
  const found = getQuestion(form, id);
  return saveAnswer(form, session, found.section, found.question, result(value), String(value), 1);
}

test('starts at the first schema-defined question', () => {
  const session = createSession(form);
  assert.equal(findNextQuestion(form, session).question.id, 'D07');
});

test('selected consultation language is stored in the session', () => {
  const session = createSession(form);
  answer(session, 'D07', 'Bengali');
  assert.equal(session.language_used, 'Bengali');
  assert.equal(findNextQuestion(form, session).question.id, 'D01');
});

test('question and section conditions are deterministic', () => {
  const session = createSession(form);
  answer(session, 'D03', 'Male');
  answer(session, 'A03', false);
  const ids = getEligibleQuestions(form, session).map(({ question }) => question.id);
  assert.equal(ids.includes('W01'), false);
  assert.equal(ids.includes('A04'), false);
  answer(session, 'D03', 'Female');
  answer(session, 'A03', true);
  const updated = getEligibleQuestions(form, session).map(({ question }) => question.id);
  assert.equal(updated.includes('W01'), true);
  assert.equal(updated.includes('A04'), true);
});

test('photo is hidden without explicit consent', () => {
  const session = createSession(form);
  answer(session, 'PH01', false);
  assert.equal(getEligibleQuestions(form, session).some(({ question }) => question.id === 'PH02'), false);
  answer(session, 'PH01', true);
  assert.equal(getEligibleQuestions(form, session).some(({ question }) => question.id === 'PH02'), true);
});

test('required questions cannot be skipped', () => {
  const session = createSession(form);
  const required = getQuestion(form, 'D01');
  assert.throws(() => markSkipped(session, required.section, required.question), /Required/);
  const optional = getQuestion(form, 'D06');
  markSkipped(session, optional.section, optional.question);
  assert.equal(session.skipped_question_ids.includes('D06'), true);
});

test('critical true answer creates one urgent alert', () => {
  const session = createSession(form);
  const found = getQuestion(form, 'R03');
  const record = answer(session, 'R03', true);
  const detail = evaluateEscalation(session, found.section, found.question, record);
  assert.equal(session.escalation_flag, true);
  assert.equal(detail.action, 'alert_front_desk_immediately');
  evaluateEscalation(session, found.section, found.question, record);
  assert.equal(session.escalation_details.length, 1);
});

test('immediately dangerous symptoms trigger independently without false negation', () => {
  const session = createSession(form);
  const found = getQuestion(form, 'C01');
  assert.equal(evaluateImmediateDanger(session, found.section, found.question, 'I have difficulty breathing').priority, 'high_priority');
  const safeSession = createSession(form);
  assert.equal(evaluateImmediateDanger(safeSession, found.section, found.question, 'I have no difficulty breathing'), null);
});

test('local answer processor requires clear booleans and explicit consent', () => {
  assert.equal(localProcess({ id: 'B', text: 'Question?', type: 'boolean' }, 'I am not sure').needs_clarification, true);
  assert.equal(localProcess({ id: 'C', text: 'Allow?', type: 'consent_boolean' }, 'maybe okay').needs_clarification, true);
  assert.equal(localProcess({ id: 'C', text: 'Allow?', type: 'consent_boolean' }, 'Yes, I agree').structured_value, true);
});

test('single and multi select never create new options', () => {
  const single = { id: 'S', text: 'Severity?', type: 'single_select', options: ['Mild', 'Moderate', 'Severe'] };
  assert.equal(localProcess(single, 'extreme').needs_clarification, true);
  assert.equal(localProcess(single, 'moderate').structured_value, 'Moderate');
  const multi = { id: 'M', text: 'Where?', type: 'multi_select', options: ['Hands', 'Neck', 'Back'] };
  assert.deepEqual(localProcess(multi, 'hands and back').structured_value, ['Hands', 'Back']);
});

test('time selections accept natural singular and plural speech', () => {
  const question = {
    id: 'C03',
    text: 'When did you first notice it?',
    type: 'single_select',
    options: ['Days ago', 'Weeks ago', 'Months ago', 'Years ago'],
  };
  assert.equal(localProcess(question, 'day').structured_value, 'Days ago');
  assert.equal(localProcess(question, 'weeks').structured_value, 'Weeks ago');
  assert.equal(localProcess(question, 'month').structured_value, 'Months ago');
  assert.equal(localProcess(question, 'one month ago').structured_value, 'Months ago');
  assert.equal(localProcess(question, 'months age').structured_value, 'Months ago');
  assert.equal(localProcess(question, 'year').structured_value, 'Years ago');
});

test('advanced demographic reply extracts clearly volunteered future answers', () => {
  const candidates = ['D03', 'D05', 'D06'].map(id => getQuestion(form, id).question);
  const extracted = extractVolunteeredAnswers('25 years, male, Kolkata', candidates);
  assert.deepEqual(extracted.map(item => [item.question_id, item.structured_value]), [
    ['D03', 'Male'],
    ['D05', 'Kolkata'],
  ]);
});

test('additional answer validation rejects sensitive and ambiguous fields', () => {
  const candidates = ['D03', 'D04', 'D05'].map(id => getQuestion(form, id).question);
  const accepted = validateAdditionalAnswers({ candidate_questions: candidates }, {
    additional_answers: [
      { question_id: 'D03', corrected_answer: 'Male', structured_value: 'Male', confidence: 0.95 },
      { question_id: 'D04', corrected_answer: '9999999999', structured_value: '9999999999', confidence: 0.99 },
      { question_id: 'D05', corrected_answer: 'Kolkata', structured_value: 'Kolkata', confidence: 0.91 },
    ],
  });
  assert.deepEqual(accepted.map(item => item.question_id), ['D03', 'D05']);
});

test('LLM output validator rejects out-of-schema values', () => {
  const question = { id: 'S', type: 'single_select', options: ['Mild'] };
  assert.throws(() => validateLlmResult(question, { question_id: 'S', relevance_status: 'relevant_complete', structured_value: 'Extreme', confidence: 1 }), /unavailable/);
});

test('answer map and missing required list reflect saved answers', () => {
  const session = createSession(form);
  answer(session, 'D01', 'Alex Doe');
  assert.equal(answerMap(session).D01, 'Alex Doe');
  assert.equal(requiredQuestionsMissing(form, session).includes('D01'), false);
  assert.equal(requiredQuestionsMissing(form, session).includes('D02'), true);
});

test('hair-only complaints are out of scope but skin complaints are not', () => {
  assert.equal(isHairOnlyConcern('I have hair fall'), true);
  assert.equal(isHairOnlyConcern('alopecia'), true);
  assert.equal(isHairOnlyConcern('I have hair loss and an itchy scalp rash'), false);
  assert.equal(isHairOnlyConcern('I have acne'), false);
});

test('chief complaint accepts skin problems and rejects other clinical scopes', () => {
  assert.equal(validateChiefComplaintScope('I have a dark itchy patch').in_scope, true);
  assert.equal(validateChiefComplaintScope('rash with fever').in_scope, true);
  assert.equal(validateChiefComplaintScope('my toenail is broken').in_scope, false);
  assert.equal(validateChiefComplaintScope('I have a headache').in_scope, false);
  assert.equal(validateChiefComplaintScope('I do not feel well').in_scope, null);
});

test('chief complaint fallback corrects clear contextual speech errors', () => {
  const question = { id: 'C01', text: 'What is your main skin concern?', type: 'text' };
  assert.equal(localProcess(question, 'brush').structured_value, 'rash');
  assert.equal(localProcess(question, 'rush').structured_value, 'rash');
  assert.equal(localProcess(question, 'I problem').structured_value, 'eye problem');
  assert.equal(localProcess(question, 'brush burn').structured_value, 'brush burn');
});
