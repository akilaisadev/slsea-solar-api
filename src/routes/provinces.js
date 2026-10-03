import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { parseQuery } from '../lib/validate.js';
import { paginationParams } from '../lib/pagination.js';
import { scopeOf } from '../lib/jurisdiction.js';
import { sendRepresentation, sendPage } from '../lib/respond.js';
import { listProvinces } from '../repositories/hierarchy.js';
import { toProvince } from '../representations.js';
import { loadProvince } from './loaders.js';

export const provincesRouter = Router();

const listQuery = z.strictObject({ ...paginationParams });

// GET /provinces: collection (§4.2), the top of the jurisdiction hierarchy.
provincesRouter.route('/')
  .get(requireScope('assets:read'), async (req, res) => {
    const query = parseQuery(listQuery, req);
    const page = await listProvinces(req.app.locals.db, { scope: scopeOf(req), ...query });
    sendPage(req, res, page, query, toProvince);
  })
  .all(allowOnly('GET'));

// GET /provinces/{province-id}: atomic resource (§4.1).
provincesRouter.route('/:provinceId')
  .get(requireScope('assets:read'), async (req, res) => {
    const province = await loadProvince(req);
    sendRepresentation(req, res, toProvince(province), { lastModified: province.updated_at });
  })
  .all(allowOnly('GET'));
