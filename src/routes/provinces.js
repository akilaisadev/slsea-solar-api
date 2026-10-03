import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { sendRepresentation } from '../lib/respond.js';
import { listProvinces, findProvince } from '../repositories/hierarchy.js';
import { toProvince } from '../representations.js';

export const provincesRouter = Router();

const listQuery = z.strictObject({ ...paginationParams });

// GET /provinces: collection (§4.2), the top of the jurisdiction hierarchy.
provincesRouter.route('/')
  .get(requireScope('assets:read'), async (req, res) => {
    const { offset, limit } = parseQuery(listQuery, req);
    const page = await listProvinces(req.app.locals.db, { scope: scopeOf(req), offset, limit });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toProvince) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

// GET /provinces/{province-id}: atomic resource (§4.1).
provincesRouter.route('/:provinceId')
  .get(requireScope('assets:read'), async (req, res) => {
    const { provinceId } = req.params;
    const province = await findProvince(req.app.locals.db, provinceId);
    if (!province) throw new ApiError(40401, `Province '${provinceId}' was not found.`);
    assertInScope(scopeOf(req), { province_id: province.province_id }, `Province '${provinceId}'`);
    sendRepresentation(req, res, toProvince(province), { lastModified: province.updated_at });
  })
  .all(allowOnly('GET'));
