import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { sendRepresentation } from '../lib/respond.js';
import { listGridSubstations, findGridSubstation } from '../repositories/hierarchy.js';
import { toGridSubstation } from '../representations.js';
import { jurisdictionParams, jurisdictionFiltersOf } from './queryParams.js';

export const gridSubstationsRouter = Router();

const listQuery = z.strictObject({
  ...paginationParams,
  'province-id': jurisdictionParams['province-id'],
  'district-id': jurisdictionParams['district-id'],
});

// GET /grid-substations: "grid-substations" is two words, so it is joined
// with a hyphen (§5.1), never an underscore or camelCase.
gridSubstationsRouter.route('/')
  .get(requireScope('assets:read'), async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const filters = await jurisdictionFiltersOf(req, query);
    const page = await listGridSubstations(req.app.locals.db, { scope: scopeOf(req), filters, offset, limit });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toGridSubstation) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

gridSubstationsRouter.route('/:substationId')
  .get(requireScope('assets:read'), async (req, res) => {
    const { substationId } = req.params;
    const substation = await findGridSubstation(req.app.locals.db, substationId);
    if (!substation) throw new ApiError(40401, `Grid substation '${substationId}' was not found.`);
    assertInScope(scopeOf(req), substation, `Grid substation '${substationId}'`);
    sendRepresentation(req, res, toGridSubstation(substation), { lastModified: substation.updated_at });
  })
  .all(allowOnly('GET'));
