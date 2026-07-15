const PDFDocument = require('pdfkit');

const COLORS = {
  ink: '#17332D',
  green: '#176B55',
  greenDark: '#0E4E3D',
  mint: '#EAF6F1',
  pale: '#F7FAF8',
  line: '#D8E4DF',
  muted: '#64766F',
  red: '#A83434',
  redPale: '#FFF0F0',
  amber: '#8A5A11',
  amberPale: '#FFF6DF',
  white: '#FFFFFF',
};

function text(value) {
  return value == null ? '' : String(value);
}

function formatValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    if (value.age != null) return `${value.age} years`;
    if (value.date_of_birth) return value.date_of_birth;
    return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${formatValue(item)}`).join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  });
}

function completionLabel(visit = {}) {
  if (visit.completion_reason === 'patient_ended_early_with_partial_report') return 'Partial intake';
  const labels = { completed: 'Complete', transferred_to_staff: 'Staff review', abandoned: 'Ended' };
  return labels[visit.completion_status] || text(visit.completion_status).replaceAll('_', ' ');
}

function writeEhrPdf(report, output) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 46, right: 44, bottom: 54, left: 44 },
    bufferPages: true,
    info: {
      Title: `Dermatology Intake Report - ${text(report.visit?.visit_id)}`,
      Author: 'Dermatology AI Voice Assistant',
      Subject: 'Patient-provided pre-consultation intake',
    },
  });
  doc.pipe(output);

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 10;

  function pageContinuationHeader() {
    doc.save();
    doc.rect(0, 0, pageWidth, 8).fill(COLORS.green);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.greenDark)
      .text('DERMATOLOGY PRE-CONSULTATION INTAKE', left, 25, { continued: false });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(text(report.visit?.visit_id), pageWidth - 230, 25, { width: 186, align: 'right' });
    doc.moveTo(left, 40).lineTo(pageWidth - 44, 40).strokeColor(COLORS.line).lineWidth(0.7).stroke();
    doc.restore();
    doc.y = 53;
  }

  doc.on('pageAdded', pageContinuationHeader);

  function ensureSpace(height) {
    if (doc.y + height > bottomLimit()) doc.addPage();
  }

  function field(label, value, x, y, width) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted)
      .text(label.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
    const formatted = formatValue(value);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.ink)
      .text(formatted, x, y + 14, { width, height: 26, ellipsis: true });
    if (!formatted) doc.moveTo(x, y + 29).lineTo(x + width - 8, y + 29).strokeColor(COLORS.line).lineWidth(0.7).stroke();
  }

  // Clinical document masthead.
  doc.roundedRect(left, 38, contentWidth, 100, 14).fill(COLORS.ink);
  doc.roundedRect(left + 18, 56, 48, 48, 13).fill(COLORS.green);
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.white).text('+', left + 18, 63, { width: 48, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#A9D5C7').text('DERMATOLOGY OUTPATIENT DEPARTMENT', left + 82, 57);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.white).text('Pre-Consultation Intake Report', left + 82, 72);
  doc.font('Helvetica').fontSize(8.5).fillColor('#C8D8D3').text('AI-assisted patient interview · For clinician review', left + 82, 102);
  const urgent = Boolean(report.triage?.escalation_flag);
  const statusText = urgent ? 'URGENT REVIEW' : 'INTAKE REPORT';
  const statusColor = urgent ? '#D85858' : '#2A8A6C';
  doc.roundedRect(pageWidth - 151, 111, 89, 17, 8).fill(statusColor);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.white).text(statusText, pageWidth - 151, 116, { width: 89, align: 'center' });

  doc.y = 153;
  doc.roundedRect(left, doc.y, contentWidth, 54, 10).fill(COLORS.pale).strokeColor(COLORS.line).lineWidth(0.7).stroke();
  const metaY = doc.y + 11;
  field('Visit ID', report.visit?.visit_id, left + 13, metaY, 172);
  field('Interview language', report.visit?.language, left + 195, metaY, 122);
  field('Report generated', formatDate(report.visit?.ended_at || new Date().toISOString()), left + 327, metaY, 165);
  doc.y = 225;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text('Patient overview', left, doc.y);
  doc.y += 18;
  const patientY = doc.y;
  doc.roundedRect(left, patientY, contentWidth, 105, 11).fill(COLORS.white).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  const patient = report.patient || {};
  const colWidth = (contentWidth - 38) / 3;
  field('Patient name', patient.name, left + 13, patientY + 13, colWidth);
  field('Age / date of birth', patient.age_or_date_of_birth, left + 19 + colWidth, patientY + 13, colWidth);
  field('Sex / gender', patient.sex_or_gender, left + 25 + colWidth * 2, patientY + 13, colWidth);
  field('Contact number', patient.contact_number, left + 13, patientY + 59, colWidth);
  field('City / area', patient.city_or_area, left + 19 + colWidth, patientY + 59, colWidth);
  field('Completion status', completionLabel(report.visit), left + 25 + colWidth * 2, patientY + 59, colWidth);
  doc.y = patientY + 121;

  const triageY = doc.y;
  doc.roundedRect(left, triageY, contentWidth, 42, 9).fill(urgent ? COLORS.redPale : COLORS.mint);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(urgent ? COLORS.red : COLORS.greenDark)
    .text(urgent ? 'Possible urgent response recorded — staff review requested' : 'No automated escalation flag recorded during this intake', left + 14, triageY + 10, { width: contentWidth - 28 });
  doc.font('Helvetica').fontSize(7.5).fillColor(urgent ? '#774141' : COLORS.muted)
    .text('This indicator supports workflow prioritization and is not a clinical assessment.', left + 14, triageY + 25, { width: contentWidth - 28 });
  doc.y = triageY + 58;

  for (const [sectionIndex, section] of (report.sections || []).entries()) {
    ensureSpace(70);
    const titleY = doc.y;
    doc.roundedRect(left, titleY, contentWidth, 30, 8).fill(COLORS.greenDark);
    doc.roundedRect(left + 8, titleY + 7, 28, 16, 7).fill('#2B896D');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.white)
      .text(String(sectionIndex + 1).padStart(2, '0'), left + 8, titleY + 12, { width: 28, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.white).text(text(section.title), left + 45, titleY + 9, { width: contentWidth - 55 });
    doc.y = titleY + 37;

    // Column labels.
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(COLORS.muted);
    doc.text('QUESTION', left + 8, doc.y, { width: 220 });
    doc.text('PATIENT REPORTED', left + 239, doc.y, { width: 126 });
    doc.text('STRUCTURED VALUE', left + 378, doc.y, { width: 121 });
    doc.y += 13;

    for (const [entryIndex, entry] of (section.entries || []).entries()) {
      const reported = formatValue(entry.patient_reported);
      const structured = formatValue(entry.structured_value);
      doc.font('Helvetica').fontSize(8.5);
      const questionHeight = doc.heightOfString(text(entry.label), { width: 218, lineGap: 1 });
      const reportedHeight = doc.heightOfString(reported, { width: 126, lineGap: 1 });
      const structuredHeight = doc.heightOfString(structured, { width: 121, lineGap: 1 });
      const rowHeight = Math.max(34, questionHeight + 18, reportedHeight + 18, structuredHeight + 18);
      ensureSpace(rowHeight + 4);
      const rowY = doc.y;
      doc.rect(left, rowY, contentWidth, rowHeight).fill(entryIndex % 2 ? COLORS.white : COLORS.pale);
      doc.moveTo(left, rowY + rowHeight).lineTo(left + contentWidth, rowY + rowHeight).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(entry.status === 'not_answered' ? '#71877F' : COLORS.ink)
        .text(text(entry.label), left + 8, rowY + 9, { width: 218, lineGap: 1 });
      doc.font('Helvetica').fontSize(8.3).fillColor(reported ? COLORS.ink : COLORS.muted)
        .text(reported, left + 239, rowY + 9, { width: 126, lineGap: 1 });
      doc.font('Helvetica').fontSize(8.3).fillColor(structured ? COLORS.greenDark : COLORS.muted)
        .text(structured, left + 378, rowY + 9, { width: 121, lineGap: 1 });
      if (!reported) doc.moveTo(left + 239, rowY + 22).lineTo(left + 354, rowY + 22).strokeColor(COLORS.line).lineWidth(0.6).stroke();
      if (!structured) doc.moveTo(left + 378, rowY + 22).lineTo(left + 491, rowY + 22).strokeColor(COLORS.line).lineWidth(0.6).stroke();
      doc.y = rowY + rowHeight;
    }
    doc.y += 16;
  }

  ensureSpace(60);
  doc.roundedRect(left, doc.y, contentWidth, 43, 8).fill(COLORS.amberPale);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.amber).text('CLINICAL DISCLAIMER', left + 13, doc.y + 9);
  doc.font('Helvetica').fontSize(7.5).fillColor('#755D32').text(text(report.disclaimer), left + 13, doc.y + 22, { width: contentWidth - 26 });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - 34;
    doc.moveTo(left, footerY - 7).lineTo(pageWidth - 44, footerY - 7).strokeColor(COLORS.line).lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text('Confidential patient intake · Generated by Dermatology AI Voice Assistant', left, footerY, { width: 360, lineBreak: false });
    doc.text(`Page ${index - range.start + 1} of ${range.count}`, pageWidth - 144, footerY, { width: 100, align: 'right', lineBreak: false });
    doc.page.margins.bottom = originalBottomMargin;
  }

  doc.end();
}

module.exports = { formatValue, writeEhrPdf };
