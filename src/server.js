'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
// Seed sample contacts unless SEED=false, so a fresh deploy is not an empty page.
const seed = process.env.SEED !== 'false';

const server = createApp({ seed, logRequests: true }).listen(port, () => {
  console.log(`Address Book API listening on port ${port} - Swagger UI at /api-docs`);
});

// Hosting platforms stop a service with SIGTERM; finish in-flight requests first.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
