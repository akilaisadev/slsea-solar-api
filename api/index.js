// Vercel entry point: Vercel runs the Express app as a serverless function.
// The same app, routes and database code as src/server.js; only the hosting
// differs (no app.listen, Vercel handles HTTPS and the port).
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { config, assertRequiredConfig } from '../src/config.js';

assertRequiredConfig();

export default createApp({ db: createPool(config.databaseUrl) });
