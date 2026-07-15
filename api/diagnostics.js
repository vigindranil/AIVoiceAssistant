const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  const probe = path.join('/tmp', `voice-assistant-${process.pid}.probe`);
  let temporaryStorage = 'available';
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (error) {
    temporaryStorage = `${error.code || 'error'}: ${error.message}`;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    status: 'diagnostics-ok',
    node: process.version,
    vercel: Boolean(process.env.VERCEL),
    region: process.env.VERCEL_REGION || null,
    temporary_storage: temporaryStorage,
  }));
};
