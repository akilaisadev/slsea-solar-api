import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { sendRepresentation } from '../lib/respond.js';
import { listDistricts, findDistrict } from '../repositories/hierarchy.js';
import { toDistrict, toGenerationSummary } from '../representations.js';
import { districtGenerationSummary, REPORTING_WINDOW_MINUTES } from '../repositories/summaries.js';
import { colomboToday, TIMEZONE } from '../lib/time.js';
import { jurisdictionParams, jurisdictionFiltersOf } from './queryParams.js';

export const districtsRouter = Router();

const listQuery = z.strictObject({
  ...paginationParams,
  'province-id': jurisdictionParams['province-id'],
});

// GET /districts: first-class collection. District is the mid-level
// jurisdiction scope, and analysts browse districts nationally, so it is
// not nested under /provinces (S3 scoping test: the global set is meaningful).
districtsRouter.route('/')
  .get(requireScope('assets:read'), async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const filters = await jurisdictionFiltersOf(req, query);
    const page = await listDistricts(req.app.locals.db, { scope: scopeOf(req), filters, offset, limit });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toDistrict) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

async function loadDistrict(req) {
  const { districtId } = req.params;
  const district = await findDistrict(req.app.locals.db, districtId);
  if (!district) throw new ApiError(40401, `District '${districtId}' was not found.`);
  assertInScope(scopeOf(req), district, `District '${districtId}'`);
  return district;
}

districtsRouter.route('/:districtId')
  .get(requireScope('assets:read'), async (req, res) => {
    const district = await loadDistrict(req);
    sendRepresentation(req, res, toDistrict(district), { lastModified: district.updated_at });
  })
  .all(allowOnly('GET'));

const summaryQuery = z.strictObject({
  date: z.iso.date({ error: 'must be a date such as 2026-10-03' })
    .refine((d) => d <= colomboToday(), 'cannot be in the future')
    .optional(),
});

// GET /districts/{district-id}/generation-summary: processing-function
// resource (§4.5), the operational dashboard's view of a district: current
// total power and the day's total energy across every installation in it.
// Named with a noun phrase like /last-reading; computed on every request.
districtsRouter.route('/:districtId/generation-summary')
  .get(requireScope('readings:read'), async (req, res) => {
    const { date = colomboToday() } = parseQuery(summaryQuery, req);
    const district = await loadDistrict(req);
    const summary = await districtGenerationSummary(req.app.locals.db, district.district_id, date);
    sendRepresentation(req, res, toGenerationSummary(district, date, TIMEZONE, REPORTING_WINDOW_MINUTES, summary), {
      lastModified: summary.last_modified ?? district.updated_at,
    });
  })
  .all(allowOnly('GET'));
