import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { scopeOf } from '../lib/jurisdiction.js';
import { sendRepresentation } from '../lib/respond.js';
import { listInstallations } from '../repositories/installations.js';
import { findLastReading } from '../repositories/readings.js';
import { toInstallation, toInstallationComposite, toReading } from '../representations.js';
import { installationReadingsRouter } from './installationReadings.js';
import { loadInstallation } from './loaders.js';
import { jurisdictionParams, jurisdictionFiltersOf, order } from './queryParams.js';

export const installationsRouter = Router();

const listQuery = z.strictObject({
  ...paginationParams,
  ...jurisdictionParams,
  status: z.enum(['active', 'maintenance']).optional(),
  sort: z.enum(['installation_id', 'capacity_kw', 'commissioned_on']).default('installation_id'),
  order: order('asc'),
});

// The later of two change times: the composite changes when either the
// installation or its latest reading changes.
function latest(...dates) {
  return dates.filter(Boolean).reduce((a, b) => (a > b ? a : b), null);
}

installationsRouter.route('/')
  .get(requireScope('assets:read'), async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const filters = { ...await jurisdictionFiltersOf(req, query), status: query.status };
    const page = await listInstallations(req.app.locals.db, {
      scope: scopeOf(req), filters, sort: query.sort, order: query.order, offset, limit,
    });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toInstallation) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

// GET /installations/{installation-id}: composite (§4.3).
installationsRouter.route('/:installationId')
  // The composite embeds a reading, so it needs both read scopes.
  .get(requireScope('assets:read'), requireScope('readings:read'), async (req, res) => {
    const installation = await loadInstallation(req);
    const lastReading = await findLastReading(req.app.locals.db, installation.installation_id);
    sendRepresentation(req, res, toInstallationComposite(installation, lastReading), {
      lastModified: latest(installation.updated_at, lastReading?.received_at),
    });
  })
  .all(allowOnly('GET'));

// GET /installations/{installation-id}/last-reading: processing-function
// resource (§4.5). Derived from the time series on every request; nothing
// like "last_power" is stored on the installation. Named with a noun
// (§5.1), as the lecture notes do for /last-position.
installationsRouter.route('/:installationId/last-reading')
  .get(requireScope('readings:read'), async (req, res) => {
    const installation = await loadInstallation(req);
    const lastReading = await findLastReading(req.app.locals.db, installation.installation_id);
    if (!lastReading) {
      throw new ApiError(40401, `Installation '${installation.installation_id}' has not reported any readings yet.`);
    }
    sendRepresentation(req, res, toReading(lastReading), { lastModified: lastReading.received_at });
  })
  .all(allowOnly('GET'));

installationsRouter.use('/:installationId/readings', installationReadingsRouter);
