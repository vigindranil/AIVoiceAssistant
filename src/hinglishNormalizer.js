const replacements = [
  [/^hi,?\s+this is (?:a\s+)?(?:text to speech|speech to text|speech-to-text)\s+conversation\s+/gi, ''],
  [/\btext to speech\b/gi, 'speech-to-text'],
  [/\bagar\b/gi, 'if'],
  [/\bmujhe\b/gi, 'I have'],
  [/\bmera\b/gi, 'my'],
  [/\bmere\b/gi, 'my'],
  [/\bmeri\b/gi, 'my'],
  [/\bachcha lagta hai\b/gi, 'feel okay'],
  [/\baccha lagta hai\b/gi, 'feel okay'],
  [/\bachcha nahin lagta\b/gi, 'do not feel well'],
  [/\baccha nahi lagta\b/gi, 'do not feel well'],
  [/\btheek nahi lag raha\b/gi, 'do not feel well'],
  [/\btheek nahin lag raha\b/gi, 'do not feel well'],
  [/\bdard\b/gi, 'pain'],
  [/\bpet\b/gi, 'stomach'],
  [/\bpet mein\b/gi, 'in the stomach'],
  [/\bstomach pain\b/gi, 'stomach pain'],
  [/\bjor se\b/gi, 'severe'],
  [/\bzor se\b/gi, 'severe'],
  [/\bbahut\b/gi, 'very'],
  [/\bjyada\b/gi, 'severe'],
  [/\bzyada\b/gi, 'severe'],
  [/\bbajaai\b/gi, 'is happening'],
  [/\bbaj raha hai\b/gi, 'is happening'],
  [/\bho raha hai\b/gi, 'is happening'],
  [/\bho rahi hai\b/gi, 'is happening'],
  [/\blag raha hai\b/gi, 'feeling'],
  [/\blag rahi hai\b/gi, 'feeling'],
  [/\bbukhar\b/gi, 'fever'],
  [/\bkhansi\b/gi, 'cough'],
  [/\bsardi\b/gi, 'cold'],
  [/\bulti\b/gi, 'vomiting'],
  [/\bchakkar\b/gi, 'dizziness'],
  [/\bsaans\b/gi, 'breathing'],
  [/\bsaans lene mein dikkat\b/gi, 'difficulty breathing'],
  [/\bseene mein dard\b/gi, 'chest pain'],
  [/\bsar dard\b/gi, 'headache'],
];

function normalizeHinglish(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let text = input;

  replacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  text = text
    .replace(/\bI have\s+my\b/gi, 'I have')
    .replace(/\bif my\b/gi, 'if I have')
    .replace(/\bI have\s+feel\b/gi, 'I feel')
    .replace(/\bI have\s+feeling\b/gi, 'I am feeling')
    .replace(/\bstomach pain severe is happening\b/gi, 'severe stomach pain')
    .replace(/\bsevere stomach pain is happening\b/gi, 'severe stomach pain')
    .replace(/\bI feel okay if I have\b/gi, 'I have')
    .replace(/\bI feel okay if\b/gi, 'I have')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text;
}

module.exports = {
  normalizeHinglish,
};
