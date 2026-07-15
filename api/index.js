// Standard HTTP requests use the Express handler. Keeping this separate from
// the WebSocket export prevents a socket configuration error from crashing /.
module.exports = require('../src/server').app;
