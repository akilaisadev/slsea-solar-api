import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { config, assertRequiredConfig } from './config.js';

assertRequiredConfig();

const db = createPool(config.databaseUrl);
const app = createApp({ db });

// Render injects PORT; a hard-coded port fails on deploy (S2 notes).
const server = app.listen(config.port, () => {
  console.log(`SLSEA Solar API listening on port ${config.port}`);
});

// Render sends SIGTERM on redeploy: stop accepting requests, then close the pool.
process.on('SIGTERM', () => {
  server.close(() => db.end().then(() => process.exit(0)));
});
