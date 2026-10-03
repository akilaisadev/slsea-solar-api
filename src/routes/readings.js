import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { parseQuery } from '../lib/validate.js';
import { paginationParams } from '../lib/pagination.js';
import { scopeOf } from '../lib/jurisdiction.js';
import { sendPage } from '../lib/respond.js';
import { listRegionalReadings } from '../repositories/readings.js';
import { toReading } from '../representations.js';
import { jurisdictionParams, jurisdictionFiltersOf, timeWindowParams, timeWindowOf, order } from './queryParams.js';

// GET /readings: the regional analytical view ("how has generation behaved
// over time, by region"), filtered by jurisdiction and time window.
//
// Why this is not the "global /pings" trap from the lecture notes: there,
// no client ever needed pings across vehicles. Here, SLSEA analysts do need
// history across installations by region (the brief's analytical scope),
// so the client-need test (§4, "clients win over data") is met. It is read
// only: a reading can only be created through its installation's scoped
// collection, and results are always clipped to the caller's jurisdiction.
export const readingsRouter = Router();

const listQuery = z.strictObject({
  ...paginationParams,
  ...jurisdictionParams,
  ...timeWindowParams,
  sort: z.enum(['recorded_at', 'power_kw']).default('recorded_at'),
  order: order('desc'),
});

readingsRouter.route('/')
  .get(requireScope('readings:read'), async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const page = await listRegionalReadings(req.app.locals.db, {
      scope: scopeOf(req),
      filters: await jurisdictionFiltersOf(req, query),
      window: timeWindowOf(query),
      sort: query.sort,
      order: query.order,
      offset,
      limit,
    });
    sendPage(req, res, page, query, toReading);
  })
  .all(allowOnly('GET'));
