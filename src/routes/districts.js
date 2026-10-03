import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { sendRepresentation } from '../lib/respond.js';
import { listDistricts, findDistrict } from '../repositories/hierarchy.js';
import { toDistrict } from '../representations.js';
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
  .get(async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const filters = await jurisdictionFiltersOf(req, query);
    const page = await listDistricts(req.app.locals.db, { scope: scopeOf(req), filters, offset, limit });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toDistrict) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

districtsRouter.route('/:districtId')
  .get(async (req, res) => {
    const { districtId } = req.params;
    const district = await findDistrict(req.app.locals.db, districtId);
    if (!district) throw new ApiError(40401, `District '${districtId}' was not found.`);
    assertInScope(scopeOf(req), district, `District '${districtId}'`);
    sendRepresentation(req, res, toDistrict(district), { lastModified: district.updated_at });
  })
  .all(allowOnly('GET'));
