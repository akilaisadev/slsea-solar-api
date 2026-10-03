import { readFileSync } from 'node:fs';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

// The OpenAPI document is written by hand (design-first) and served as-is:
// /openapi.json for tools, /docs for people (Swagger UI).
const spec = YAML.parse(readFileSync(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8'));

export const docsRouter = Router();

docsRouter.get('/openapi.json', (req, res) => {
  res.json(spec);
});

docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: 'SLSEA Solar Generation API',
  swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
}));
