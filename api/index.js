// Load the full application inside the request handler so a configuration or
// packaging error is returned as useful JSON instead of Vercel's generic
// FUNCTION_INVOCATION_FAILED page.
let app;

module.exports = (req, res) => {
  try {
    app ||= require('../src/server').app;
    return app(req, res);
  } catch (error) {
    const diagnosticId = `BOOT-${Date.now().toString(36).toUpperCase()}`;
    console.error(`[${diagnosticId}] Application bootstrap failed:`, error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({
      error: 'Application bootstrap failed.',
      diagnostic_id: diagnosticId,
      details: error?.message || String(error),
      node: process.version,
    }));
  }
};
