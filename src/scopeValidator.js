function validateChiefComplaintScope(rawTranscript) {
  const text = String(rawTranscript || '').toLowerCase();
  const mentionsHair = /\b(hair\s*(?:fall|loss|shedding)|bald(?:ing|ness)?|alopecia)\b/.test(text);
  const mentionsNail = /\b(nail|toenail|fingernail)\b/.test(text);
  const mentionsSkin = /\b(rash|itch|itching|itchy|acne|pimple|eczema|psoriasis|mole|lesion|wound|sore|skin|pigment|pigmentation|patch|spot|blister|scaling|flaking|dryness|swelling|redness|boil|wart|hives|ringworm|fungal|crusting|oozing|bleeding)\b/.test(text);
  const mentionsOtherProblem = /\b(headache|migraine|cough|cold|sore throat|breathlessness|stomach|abdominal|chest pain|back pain|joint pain|tooth|dental|eye|vision|ear pain|diabetes|blood pressure|hypertension|vomit|vomiting|diarrhea|constipation|urine|urinary|fracture)\b/.test(text);

  if (mentionsSkin) return { in_scope: true, reason: null };
  if (mentionsHair) return { in_scope: false, reason: 'hair concern' };
  if (mentionsNail) return { in_scope: false, reason: 'nail concern' };
  if (mentionsOtherProblem) return { in_scope: false, reason: 'non-skin health concern' };
  return { in_scope: null, reason: 'no clear skin concern was identified' };
}

function isHairOnlyConcern(rawTranscript) {
  const result = validateChiefComplaintScope(rawTranscript);
  return result.in_scope === false && result.reason === 'hair concern';
}

module.exports = { isHairOnlyConcern, validateChiefComplaintScope };
