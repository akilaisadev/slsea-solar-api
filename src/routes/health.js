import { Router } from 'express';
import { allowOnly } from '../middleware/allow.js';
import { config } from '../config.js';

// Operational probe used by Render's health check and the uptime monitor.
// Not a domain resource, so it lives outside the versioned base path.
export const healthRouter = Router();

healthRouter.route('/')
  .get(async (req, res) => {
    let database = 'ok';
    try {
      await req.app.locals.db.query('SELECT 1');
    } catch {
      database = 'unavailable';
    }
    res.set('Cache-Control', 'no-store');
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version: config.version,
      uptime_seconds: Math.round(process.uptime()),
    });
  })
  .all(allowOnly('GET'));
