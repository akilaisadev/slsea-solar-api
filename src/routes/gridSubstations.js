import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { parseQuery } from '../lib/validate.js';
import { paginationParams } from '../lib/pagination.js';
import { scopeOf } from '../lib/jurisdiction.js';
import { sendRepresentation, sendPage } from '../lib/respond.js';
import { listGridSubstations } from '../repositories/hierarchy.js';
import { toGridSubstation } from '../representations.js';
import { loadGridSubstation } from './loaders.js';
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
    const filters = await jurisdictionFiltersOf(req, query);
    const page = await listGridSubstations(req.app.locals.db, {
      scope: scopeOf(req), filters, offset: query.offset, limit: query.limit,
    });
    sendPage(req, res, page, query, toGridSubstation);
  })
  .all(allowOnly('GET'));

gridSubstationsRouter.route('/:substationId')
  .get(requireScope('assets:read'), async (req, res) => {
    const substation = await loadGridSubstation(req);
    sendRepresentation(req, res, toGridSubstation(substation), { lastModified: substation.updated_at });
  })
  .all(allowOnly('GET'));
