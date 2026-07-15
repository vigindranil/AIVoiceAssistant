const SYSTEM_PROMPT = `You are an English-language AI assistant for dermatology pre-consultation intake.

You are not a doctor and must not diagnose, prescribe treatment, or make unsupported medical conclusions.

You will receive the current question, question ID, expected answer type, available options, required status, raw speech-to-text response, previous questions and answers, and relevant conversation context.

Your tasks are:
1. Determine whether the response is relevant to the current question.
2. Determine whether the answer is complete enough to save.
3. Correct likely speech-to-text errors using the question and conversation context.
4. Reconstruct the response as a clear, grammatically correct English sentence.
5. Preserve the patient's intended meaning.
6. Do not add symptoms, medicines, dates, durations, severity, diagnoses, allergies, locations, or any information not stated by the patient.
7. Normalize the answer according to the expected question type.
8. For single-select questions, return only one allowed option when the answer is clear.
9. For multi-select questions, return only allowed options.
10. For boolean questions, return true or false only when the patient's intention is clear.
11. For consent questions, require explicit consent.
12. For unclear, incomplete, contradictory, or irrelevant responses, create one simple clarification question.
13. Ask only one clarification question at a time.
14. Use simple and patient-friendly English.
15. Do not select questions that are hidden by application conditions.
16. Do not determine final form completion.
17. Do not suppress or downgrade possible red-flag answers.
18. Treat transcription_alternatives only as speech-recognition hypotheses; use one only when it clearly fits what the patient said and the current question.
19. If a patient explicitly spells their name letter by letter, reconstruct the name from those stated letters.
20. Use the question context to resolve close speech errors when meaning is clear, such as "brush" or "rush" meaning "rash" in a skin-complaint answer, or "I problem" meaning "eye problem". Do not force a correction when multiple meanings remain plausible.
21. The patient may answer future questions early. Inspect candidate_questions and return any other clearly and explicitly stated values in additional_answers. Never infer an unstated value.
22. Do not put name, age/date of birth, phone, consent, image, boolean, or red-flag answers in additional_answers; those require their normal question and confirmation flow.
23. Each additional_answers item must contain only: question_id, corrected_answer, structured_value, confidence.
24. Return valid JSON only with: question_id, relevance_status, corrected_answer, structured_value, confidence, needs_clarification, clarification_question, possible_red_flag, detected_terms, additional_answers.`;

const SKIP_PATTERN = /^(skip|next question|prefer not to answer|i (?:do not|don't) (?:know|want to answer))\.?$/i;
const YES_PATTERN = /\b(yes|yeah|yep|i do|i have|that happened|correct|affirmative|give permission|you may|i agree|allow)\b/i;
const NO_PATTERN = /\b(no|nope|never|none|i have not|i haven't|do not|don't|not at all)\b/i;

function clampConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function baseResult(question, overrides = {}) {
  return {
    question_id: question.id,
    relevance_status: 'unclear',
    corrected_answer: null,
    structured_value: null,
    confidence: 0,
    needs_clarification: true,
    clarification_question: `Please answer this question: ${question.text}`,
    possible_red_flag: false,
    detected_terms: [],
    additional_answers: [],
    ...overrides,
  };
}

function mergeAdditionalAnswers(...groups) {
  const merged = new Map();
  for (const item of groups.flat()) {
    if (!item?.question_id) continue;
    const existing = merged.get(item.question_id);
    if (!existing || Number(item.confidence) > Number(existing.confidence)) merged.set(item.question_id, item);
  }
  return [...merged.values()];
}

function extractVolunteeredAnswers(raw, candidateQuestions = []) {
  const text = String(raw || '').trim();
  const lower = text.toLowerCase();
  const candidates = new Map(candidateQuestions.map(question => [question.id, question]));
  const answers = [];
  const add = (questionId, correctedAnswer, structuredValue, confidence = 0.9) => {
    if (!candidates.has(questionId)) return;
    answers.push({ question_id: questionId, corrected_answer: correctedAnswer, structured_value: structuredValue, confidence, provenance: 'volunteered' });
  };

  if (candidates.has('D03')) {
    if (/\b(female|woman)\b/i.test(text)) add('D03', 'Female', 'Female', 0.96);
    else if (/\b(male|man)\b/i.test(text)) add('D03', 'Male', 'Male', 0.96);
    else if (/\bprefer not to say\b/i.test(text)) add('D03', 'Prefer not to say', 'Prefer not to say', 0.96);
  }

  if (candidates.has('D05')) {
    const explicitCity = text.match(/\b(?:from|live in|living in|city is|area is)\s+([a-z][a-z .'-]{1,60}?)(?=\s*(?:,|;|\.|$))/i);
    const compactDemographics = text.match(/\b(?:male|man|female|woman|prefer not to say)\b[\s,;-]+([a-z][a-z .'-]{1,60})$/i);
    const city = (explicitCity?.[1] || compactDemographics?.[1] || '').trim().replace(/[.,;]+$/, '');
    if (city && !/^(?:years?|old)$/i.test(city)) {
      const formattedCity = city.replace(/\b\w/g, char => char.toUpperCase());
      add('D05', formattedCity, formattedCity, 0.9);
    }
  }

  if (candidates.has('D06')) {
    const occupation = text.match(/\b(?:i work as|my occupation is|i am an?|i'm an?)\s+([a-z][a-z .'-]{1,60}?)(?=\s*(?:,|;|\.|$))/i)?.[1]?.trim();
    if (occupation && !/^(?:male|female|man|woman|years? old)$/i.test(occupation)) add('D06', occupation.replace(/\b\w/g, char => char.toUpperCase()), occupation, 0.86);
  }

  // Capture schema options only when the utterance explicitly names a unique
  // option for one future question. This avoids applying words such as
  // "severe" to both itch and pain questions.
  const optionClaims = [];
  for (const question of candidateQuestions) {
    if (!['single_select', 'multi_select'].includes(question.type) || question.id === 'D03') continue;
    const matches = optionMatches(lower, question.options || []);
    if (matches.length) optionClaims.push({ question, matches });
  }
  const optionUsage = new Map();
  for (const claim of optionClaims) {
    for (const option of claim.matches) optionUsage.set(option.toLowerCase(), (optionUsage.get(option.toLowerCase()) || 0) + 1);
  }
  for (const { question, matches } of optionClaims) {
    const unique = matches.filter(option => optionUsage.get(option.toLowerCase()) === 1);
    if (!unique.length || (question.type === 'single_select' && unique.length !== 1)) continue;
    const value = question.type === 'single_select' ? unique[0] : unique;
    add(question.id, Array.isArray(value) ? value.join(', ') : value, value, 0.88);
  }

  return mergeAdditionalAnswers(answers);
}

function explicitBoolean(text, consent = false) {
  const no = NO_PATTERN.test(text);
  if (no) return false;
  const yes = YES_PATTERN.test(text);
  if (!yes) return null;
  if (consent && yes && !/\b(agree|permission|allow|may|yes)\b/i.test(text)) return null;
  return yes;
}

function optionMatches(text, options) {
  const lower = text.toLowerCase();
  const normalizedWords = lower.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const normalizedWordSet = new Set(normalizedWords);
  const matches = options.filter(option => {
    const aliases = option.toLowerCase().split(/[\/()]/).map(value => value.trim()).filter(Boolean);
    return aliases.some(alias => {
      if (lower.includes(alias) || lower === option.toLowerCase()) return true;

      // Accept natural spoken variants of time choices. For example, "month",
      // "a month", and "one month ago" should all select "Months ago".
      const meaningfulWords = alias
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(word => word && word !== 'ago');
      if (meaningfulWords.length !== 1) return false;
      const word = meaningfulWords[0];
      const singular = word.endsWith('s') && word.length > 1 ? word.slice(0, -1) : word;
      return normalizedWordSet.has(word) || normalizedWordSet.has(singular);
    });
  });
  return [...new Set(matches)];
}

function parsePhone(text) {
  const wordDigits = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  const normalized = text.toLowerCase().replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, word => wordDigits[word]);
  const plus = normalized.trim().startsWith('+') ? '+' : '';
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? plus + digits : null;
}

function correctContextualTranscript(question, text) {
  if (question.id !== 'C01') return text;
  const normalized = text.trim();
  if (/^(?:i (?:have|got) (?:a )?)?(?:brush|rush)(?: problem)?[.!]?$/i.test(normalized)) return 'rash';
  if (/^(?:i (?:have|got) (?:an? )?)?(?:i|high) problem[.!]?$/i.test(normalized)) return 'eye problem';
  return normalized;
}

function localProcess(question, raw) {
  const text = String(raw || '').trim();
  if (!text) return baseResult(question, { relevance_status: 'no_response', clarification_question: `I did not hear an answer. ${question.text}` });
  if (SKIP_PATTERN.test(text)) return { command: 'skip' };

  if (question.type === 'boolean' || question.type === 'consent_boolean') {
    const value = explicitBoolean(text, question.type === 'consent_boolean');
    if (value === null) return baseResult(question, { clarification_question: question.type === 'consent_boolean' ? 'Please say clearly whether you give permission: yes, I agree, or no.' : 'Please answer yes or no.' });
    return baseResult(question, {
      relevance_status: 'relevant_complete', corrected_answer: value ? 'Yes.' : 'No.', structured_value: value,
      confidence: 0.9, needs_clarification: false, clarification_question: null, possible_red_flag: question.flag_if === true && value,
    });
  }

  if (question.type === 'single_select' || question.type === 'multi_select') {
    const matches = optionMatches(text, question.options || []);
    if (!matches.length) return baseResult(question, { clarification_question: `Please choose from: ${(question.options || []).join(', ')}.` });
    if (question.type === 'single_select' && matches.length !== 1) return baseResult(question, { clarification_question: `Please choose one: ${question.options.join(', ')}.` });
    const value = question.type === 'single_select' ? matches[0] : matches;
    return baseResult(question, { relevance_status: 'relevant_complete', corrected_answer: Array.isArray(value) ? value.join(', ') : value, structured_value: value, confidence: 0.88, needs_clarification: false, clarification_question: null });
  }

  if (question.type === 'phone') {
    const phone = parsePhone(text);
    if (!phone) return baseResult(question, { relevance_status: 'relevant_incomplete', clarification_question: 'Please repeat the complete phone number, one digit at a time.' });
    return baseResult(question, { relevance_status: 'relevant_complete', corrected_answer: phone, structured_value: phone, confidence: 0.86, needs_clarification: false, clarification_question: null, requires_confirmation: true });
  }

  if (question.type === 'date_or_number') {
    const age = text.match(/\b(\d{1,3})\b/);
    const date = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    let value = date ? { date_of_birth: date[0] } : age ? { age: Number(age[1]) } : null;
    if (value?.age > 120) value = null;
    if (!value) return baseResult(question, { relevance_status: 'relevant_incomplete', clarification_question: 'Please say your age in years, or your full date of birth.' });
    return baseResult(question, { relevance_status: 'relevant_complete', corrected_answer: text, structured_value: value, confidence: 0.86, needs_clarification: false, clarification_question: null });
  }

  if (question.type === 'text') {
    if (text.length < 2) return baseResult(question, { clarification_question: 'Please give a little more detail.' });
    const correctedText = correctContextualTranscript(question, text);
    return baseResult(question, { relevance_status: 'relevant_complete', corrected_answer: correctedText.replace(/^\w/, char => char.toUpperCase()), structured_value: correctedText, confidence: correctedText === text ? 0.72 : 0.82, needs_clarification: false, clarification_question: null });
  }

  return baseResult(question);
}

function validateLlmResult(question, result) {
  if (!result || result.question_id !== question.id) throw new Error('LLM returned the wrong question ID.');
  const statuses = ['relevant_complete', 'relevant_incomplete', 'irrelevant', 'unclear', 'no_response'];
  if (!statuses.includes(result.relevance_status)) throw new Error('LLM returned an invalid relevance status.');
  result.confidence = clampConfidence(result.confidence);
  result.needs_clarification = result.relevance_status !== 'relevant_complete' || Boolean(result.needs_clarification);
  if (question.type === 'single_select' && result.structured_value != null && !question.options.includes(result.structured_value)) throw new Error('LLM selected an unavailable option.');
  if (question.type === 'multi_select' && result.structured_value != null && (!Array.isArray(result.structured_value) || result.structured_value.some(value => !question.options.includes(value)))) throw new Error('LLM selected an unavailable option.');
  if (['boolean', 'consent_boolean'].includes(question.type) && result.structured_value != null && typeof result.structured_value !== 'boolean') throw new Error('LLM returned an invalid boolean.');
  if (question.type === 'consent_boolean' && result.structured_value === true && explicitBoolean(result.corrected_answer || '', true) !== true) throw new Error('Consent was not explicit.');
  if (question.type === 'phone' && result.structured_value != null) {
    const phone = parsePhone(String(result.structured_value));
    if (!phone) throw new Error('LLM returned an invalid phone number.');
    result.structured_value = phone;
    result.requires_confirmation = true;
  }
  return result;
}

function validateAdditionalAnswers(context, result) {
  const candidates = new Map((context.candidate_questions || []).map(question => [question.id, question]));
  const accepted = [];
  for (const additional of Array.isArray(result.additional_answers) ? result.additional_answers : []) {
    const question = candidates.get(additional?.question_id);
    if (!question || ['D01', 'D02', 'D04'].includes(question.id)) continue;
    if (['boolean', 'consent_boolean', 'image_upload'].includes(question.type) || question.flag_if === true || question.critical === true) continue;
    try {
      const normalized = validateLlmResult(question, {
        ...additional,
        relevance_status: 'relevant_complete',
        needs_clarification: false,
      });
      if (normalized.structured_value == null || Number(normalized.confidence) < 0.75) continue;
      accepted.push({
        question_id: question.id,
        corrected_answer: normalized.corrected_answer,
        structured_value: normalized.structured_value,
        confidence: normalized.confidence,
        provenance: 'volunteered',
      });
    } catch {}
  }
  return accepted;
}

async function processWithLlm(context) {
  const endpoint = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'gpt-4.1-mini', temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(context) }],
    }),
  });
  if (!response.ok) throw new Error(`LLM request failed (${response.status}).`);
  const body = await response.json();
  return JSON.parse(body.choices?.[0]?.message?.content || '{}');
}

async function processAnswer(context) {
  const commandResult = detectCommand(context.raw_speech_to_text_transcript);
  if (commandResult) return { command: commandResult };
  // Resolve exact option wording and safe singular/plural variants locally.
  // This prevents an LLM from rejecting clear replies such as "month".
  if (['single_select', 'multi_select'].includes(context.current_question.type)) {
    const deterministicResult = localProcess(context.current_question, context.raw_speech_to_text_transcript);
    if (deterministicResult.relevance_status === 'relevant_complete') {
      deterministicResult.additional_answers = extractVolunteeredAnswers(context.raw_speech_to_text_transcript, context.candidate_questions);
      return deterministicResult;
    }
  }
  if (!process.env.OPENAI_API_KEY) {
    const result = localProcess(context.current_question, context.raw_speech_to_text_transcript);
    result.additional_answers = extractVolunteeredAnswers(context.raw_speech_to_text_transcript, context.candidate_questions);
    return result;
  }
  try {
    const result = validateLlmResult(context.current_question, await processWithLlm(context));
    result.additional_answers = mergeAdditionalAnswers(
      validateAdditionalAnswers(context, result),
      extractVolunteeredAnswers(context.raw_speech_to_text_transcript, context.candidate_questions),
    );
    if (context.current_question.type === 'consent_boolean' && result.structured_value === true && explicitBoolean(context.raw_speech_to_text_transcript, true) !== true) {
      return baseResult(context.current_question, { clarification_question: 'Please say clearly whether you give permission: yes, I agree, or no.' });
    }
    return result;
  } catch (error) {
    console.error('Constrained LLM processing failed; using deterministic fallback:', error.message);
    return localProcess(context.current_question, context.raw_speech_to_text_transcript);
  }
}

function detectCommand(raw) {
  const text = String(raw || '').trim().toLowerCase().replace(/[.!?]/g, '');
  const commands = new Map([
    ['repeat the question', 'repeat'], ['repeat', 'repeat'], ['go back', 'go_back'], ['correct my answer', 'go_back'],
    ['skip', 'skip'], ['next question', 'skip'], ['start again', 'start_again'], ['call staff', 'call_staff'],
    ['end interview', 'end_interview'],
    ['finish early', 'finish_early'], ['finish interview', 'finish_early'], ['finish now', 'finish_early'],
  ]);
  return commands.get(text) || null;
}

module.exports = { SYSTEM_PROMPT, correctContextualTranscript, detectCommand, extractVolunteeredAnswers, localProcess, processAnswer, validateAdditionalAnswers, validateLlmResult };
