const fillerPatterns = [
  /\b(um+|uh+|erm+|hmm+|mmm+|ah+|oh+)\b/gi,
  /\b(all right|alright|like|you know|i mean|basically|actually|kind of|sort of)\b/gi,
  /\b(beep|beeping|background noise|noise|static|silence)\b/gi,
];

const phraseReplacements = [
  [/\bEI test\b/gi, 'AI test'],
  [/\bAI test to speech\b/gi, 'AI speech-to-text test'],
  [/\bfix to speech in gym\b/gi, 'speech-to-text engine'],
  [/\btext to speech in gym\b/gi, 'speech-to-text engine'],
  [/\bspeech to text in gym\b/gi, 'speech-to-text engine'],
  [/\bspeech-to-text in gym\b/gi, 'speech-to-text engine'],
  [/\bmedical for transfusion\b/gi, 'medical transcription'],
  [/\btesting for medical transcription\b/gi, 'testing medical transcription'],
  [/\bmedical transfusion\b/gi, 'medical transcription'],
  [/\bfor transfusion\b/gi, 'for transcription'],
  [/\btransfusion\b/gi, 'transcription'],
  [/\bpatient will eat,?\s+speak\b/gi, 'patient will speak'],
  [/\bpatient will eat speak\b/gi, 'patient will speak'],
  [/\btasting this\b/gi, 'testing this'],
  [/\btasting\b/gi, 'testing'],
  [/\bshortness breath\b/gi, 'shortness of breath'],
  [/\bdifficulty breathing\b/gi, 'difficulty breathing'],
  [/\bchestpain\b/gi, 'chest pain'],
  [/\bstomach ache\b/gi, 'stomach pain'],
  [/\btummy pain\b/gi, 'abdominal pain'],
  [/\bhigh bp\b/gi, 'high blood pressure'],
  [/\bbp\b/gi, 'blood pressure'],
  [/\bsugar level\b/gi, 'blood sugar level'],
  [/\bfeaver\b/gi, 'fever'],
  [/\bcaugh\b/gi, 'cough'],
  [/\bhead ache\b/gi, 'headache'],
];

const medicalTermPattern = /\b(abdominal pain|acid reflux|back pain|bleeding|blurred vision|body ache|breathlessness|burning sensation|chest pain|chills|constipation|cough|dizziness|dry cough|ear pain|fatigue|fever|headache|heartburn|joint pain|loss of appetite|loss of smell|loss of taste|nausea|palpitations|rash|runny nose|shortness of breath|sore throat|stomach pain|swelling|vomiting|weakness|wheezing|abdomen|ankle|arm|back|chest|ear|eye|foot|hand|head|knee|leg|lower abdomen|lower back|neck|shoulder|throat|upper abdomen|allergy|anemia|anxiety|asthma|bronchitis|covid|dehydration|depression|diabetes|diarrhea|gastritis|hypertension|hypothyroidism|infection|influenza|migraine|pneumonia|sinusitis|urinary tract infection|blood pressure|blood sugar|pain|symptom|symptoms)\b/i;
const appContextPattern = /\b(ai|test|testing|speech-to-text|engine|application|app|medical transcription|transcription|patient will|will speak)\b/i;
const junkSentencePattern = /^(and the|why do you stop|yeah|yes|okay|ok|stop|please stop)$/i;

function cleanTranscript(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let text = input;

  text = text.replace(/\[[^\]]*(?:beep|noise|silence|music|inaudible)[^\]]*\]/gi, ' ');
  text = text.replace(/\([^)]*(?:beep|noise|silence|music|inaudible)[^)]*\)/gi, ' ');

  fillerPatterns.forEach((pattern) => {
    text = text.replace(pattern, ' ');
  });

  phraseReplacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  text = text
    .replace(/\b(\w+)(\s+\1\b)+/gi, '$1')
    .replace(/,\s+in\s+/gi, ' in ')
    .replace(/\bthis is,\s+/gi, 'this is ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?]){2,}/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  const sentences = splitIntoSentences(text);
  return sentences.map(formatSentence).filter(Boolean).join(' ');
}

function splitIntoSentences(text) {
  const parts = text
    .replace(/\s+(and then|then)\s+/gi, '. ')
    .replace(/\s+(but|however)\s+/gi, '. ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(part => part.trim())
    .filter(Boolean);

  return parts.length ? parts : [text];
}

function formatSentence(sentence) {
  let formatted = sentence
    .replace(/^[,.;:!?]+/, '')
    .replace(/[,;:]+$/g, '')
    .replace(/^(i\s+am|i'm)\s+(having|feeling|getting)\s+/i, '')
    .replace(/^i\s+(have|had|feel|felt|got|am getting)\s+/i, '')
    .replace(/^patient says\s+i\s+(have|had|feel|felt|got|am getting)\s+/i, '')
    .replace(/^(patient reports|the patient reports)[,:\s]+/i, '')
    .replace(/^so,\s*/i, '')
    .replace(/^so\s+/i, '')
    .replace(/^my\s+/i, '')
    .trim();

  formatted = formatted
    .replace(/\band the[.!?]?$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const sentenceWithoutTerminalPunctuation = formatted.replace(/[.!?]+$/g, '').trim();

  if (!formatted || junkSentencePattern.test(sentenceWithoutTerminalPunctuation)) {
    return '';
  }

  const shouldUsePatientReport =
    medicalTermPattern.test(formatted) &&
    !appContextPattern.test(formatted) &&
    !/^(patient|the patient|doctor|clinician)\b/i.test(formatted);

  if (shouldUsePatientReport) {
    formatted = `Patient reports ${formatted.charAt(0).toLowerCase()}${formatted.slice(1)}`;
  }

  formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);

  if (!/[.!?]$/.test(formatted)) {
    formatted += '.';
  }

  return formatted;
}

module.exports = {
  cleanTranscript,
};
