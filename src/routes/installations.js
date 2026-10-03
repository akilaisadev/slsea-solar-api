import { Router } from 'express';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { sendRepresentation } from '../lib/respond.js';
import { listInstallations, findInstallation } from '../repositories/installations.js';
import { toInstallation } from '../representations.js';

export const installationsRouter = Router();

const listQuery = z.strictObject({ ...paginationParams });

installationsRouter.route('/')
  .get(async (req, res) => {
    const { offset, limit } = parseQuery(listQuery, req);
    const page = await listInstallations(req.app.locals.db, { scope: scopeOf(req), offset, limit });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toInstallation) }), {
      lastModified: page.lastModified,
    });
  })
  .all(allowOnly('GET'));

installationsRouter.route('/:installationId')
  .get(async (req, res) => {
    const { installationId } = req.params;
    const installation = await findInstallation(req.app.locals.db, installationId);
    if (!installation) throw new ApiError(40401, `Installation '${installationId}' was not found.`);
    assertInScope(scopeOf(req), installation, `Installation '${installationId}'`);
    sendRepresentation(req, res, toInstallation(installation), { lastModified: installation.updated_at });
  })
  .all(allowOnly('GET'));
