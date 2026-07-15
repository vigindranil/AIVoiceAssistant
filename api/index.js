// Vercel Functions accepts a Node HTTP server export. Exporting the same
// server used locally also preserves the /api/stream WebSocket upgrade route.
module.exports = require('../src/server');
