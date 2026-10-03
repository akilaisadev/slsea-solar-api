import { Router } from 'express';
import { allowOnly } from '../middleware/allow.js';
import { config } from '../config.js';
import { pingDatabase } from '../db/pool.js';

// Operational probes, outside the versioned base path (not domain resources).
//
// GET /health is liveness only and never touches the database: Render polls
// it every few seconds and an uptime monitor every few minutes, and a query
// on each poll would keep the serverless database (Neon) awake around the
// clock, using up its free compute allowance. GET /health/database checks
// the database explicitly, for people and the smoke test.
export const healthRouter = Router();

healthRouter.route('/')
  .get((req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', version: config.version, uptime_seconds: Math.round(process.uptime()) });
  })
  .all(allowOnly('GET'));

healthRouter.route('/database')
  .get(async (req, res) => {
    const started = Date.now();
    let database = 'ok';
    try {
      await pingDatabase(req.app.locals.db);
    } catch {
      database = 'unavailable';
    }
    res.set('Cache-Control', 'no-store');
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      latency_ms: Date.now() - started,
    });
  })
  .all(allowOnly('GET'));
