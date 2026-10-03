import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { sendRepresentation } from '../lib/respond.js';
import { listInstallationReadings, findReading } from '../repositories/readings.js';
import { toReading } from '../representations.js';
import { loadInstallation } from './loaders.js';
import { timeWindowParams, timeWindowOf, order } from './queryParams.js';

// /installations/{installation-id}/readings: a scoped collection (§4.6,
// §5.6). A reading has no meaning without its installation, so the parent
// is part of the path rather than a query-string filter.
export const installationReadingsRouter = Router({ mergeParams: true });

const listQuery = z.strictObject({
  ...paginationParams,
  ...timeWindowParams,
  sort: z.enum(['recorded_at', 'power_kw']).default('recorded_at'),
  order: order('desc'),
});

installationReadingsRouter.route('/')
  .get(requireScope('readings:read'), async (req, res) => {
    const installation = await loadInstallation(req);
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const page = await listInstallationReadings(req.app.locals.db, {
      installationId: installation.installation_id,
      window: timeWindowOf(query),
      sort: query.sort,
      order: query.order,
      offset,
      limit,
    });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toReading) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

// One reading: the URI a 201 Location header points to after ingestion.
installationReadingsRouter.route('/:readingId')
  .get(requireScope('readings:read'), async (req, res) => {
    const installation = await loadInstallation(req);
    const { readingId } = req.params;
    // A non-numeric id cannot name a reading; answer 404 rather than let
    // PostgreSQL reject the bigint cast as a 500.
    const reading = /^[0-9]{1,15}$/.test(readingId)
      ? await findReading(req.app.locals.db, installation.installation_id, Number(readingId))
      : null;
    if (!reading) {
      throw new ApiError(40401, `Reading '${readingId}' was not found for installation '${installation.installation_id}'.`);
    }
    sendRepresentation(req, res, toReading(reading), { lastModified: reading.received_at });
  })
  .all(allowOnly('GET'));
