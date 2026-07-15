const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { writeEhrPdf } = require('../src/pdfReport');

test('professional EHR PDF generator creates a downloadable PDF document', async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on('data', chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    output.on('end', resolve);
    output.on('error', reject);
  });
  writeEhrPdf({
    document_type: 'Dermatology pre-consultation intake',
    visit: { visit_id: 'VISIT-TEST', language: 'English', completion_status: 'completed', ended_at: new Date().toISOString() },
    patient: { name: 'Test Patient', age_or_date_of_birth: { age: 30 } },
    triage: { escalation_flag: false, details: [] },
    sections: [{ title: 'Chief Complaint', entries: [{ label: 'What is the concern?', patient_reported: 'Rash', structured_value: 'rash', status: 'answered' }] }],
    disclaimer: 'Patient-provided pre-consultation information.',
  }, output);
  await finished;
  const pdf = Buffer.concat(chunks);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 2000);
});
