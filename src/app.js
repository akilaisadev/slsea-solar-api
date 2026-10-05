import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { requireJsonAccept } from './middleware/negotiate.js';
import { requestId, accessLog } from './middleware/observability.js';
import { allowOnly } from './middleware/allow.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { errorsRouter } from './routes/errors.js';
import { docsRouter } from './routes/docs.js';
import { apiRouter } from './routes/api.js';
import { oauthRouter } from './routes/oauth.js';
import { absoluteUrl } from './lib/urls.js';

export function createApp({ db, logRequests = config.logRequests }) {
  const app = express();
  app.locals.db = db;

  app.disable('x-powered-by');
  // ETags are generated explicitly per resource (WSO2 §10.4), not by Express.
  app.set('etag', false);
  // Render terminates TLS at its proxy; trust X-Forwarded-Proto for https URLs.
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(accessLog({ enabled: logRequests }));
  app.use(helmet());
  app.use(express.json({ limit: '10kb', type: ['application/json', 'application/merge-patch+json'] }));

  // Swagger UI is HTML for people, so it is mounted before the JSON-only rule.
  app.use(docsRouter);

  app.use(requireJsonAccept);

  app.route('/')
    .get((req, res) => {
      res.json({
        name: 'SLSEA Real-Time Solar Generation Data API',
        version: config.version,
        base_path: absoluteUrl(req, config.basePath),
        documentation: absoluteUrl(req, '/docs'),
        openapi: absoluteUrl(req, '/openapi.json'),
        token_endpoint: absoluteUrl(req, '/oauth2/token'),
        health: absoluteUrl(req, '/health'),
      });
    })
    .all(allowOnly('GET'));

  app.use('/health', healthRouter);
  app.use('/errors', errorsRouter);
  app.use('/oauth2', oauthRouter);
  app.use(config.basePath, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
