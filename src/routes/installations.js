import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { requireBodyType } from '../middleware/negotiate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery, parseBody } from '../lib/validate.js';
import { paginationParams } from '../lib/pagination.js';
import { scopeOf } from '../lib/jurisdiction.js';
import { sendRepresentation, sendPage } from '../lib/respond.js';
import { etagOf, preconditionFails } from '../lib/conditional.js';
import { absoluteUrl } from '../lib/urls.js';
import { generateDeviceSecret, hashDeviceSecret } from '../lib/credentials.js';
import { colomboToday } from '../lib/time.js';
import { withTransaction } from '../db/transaction.js';
import {
  listInstallations, findInstallation, insertInstallation, updateInstallation, decommissionInstallation,
} from '../repositories/installations.js';
import { findGridSubstation } from '../repositories/hierarchy.js';
import { findLastReading } from '../repositories/readings.js';
import { toInstallation, toInstallationComposite, toReading, toDecommissionedInstallation } from '../representations.js';
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

// Writable fields. installation_id, the device secret and the timestamps
// are server-owned, so a body that sends them is rejected (strict schemas).
const fields = {
  inverter_id: z.string().regex(/^[A-Z0-9][A-Z0-9-]{3,39}$/, 'must be 4-40 uppercase letters, digits or hyphens'),
  substation_id: z.string().regex(/^gss-[0-9]{3}$/, 'must look like gss-001'),
  capacity_kw: z.number().positive().max(500),
  latitude: z.number().min(5.8).max(10),
  longitude: z.number().min(79.4).max(82),
  commissioned_on: z.iso.date().refine((d) => d <= colomboToday(), 'cannot be in the future'),
  status: z.enum(['active', 'maintenance']),
};
// POST: everything except status is required (a new site defaults to active).
const createBody = z.strictObject({ ...fields, status: fields.status.default('active') });
// PUT replaces the whole resource, so every writable field is required:
// a missing field is an error, never "keep the old value" (that is PATCH).
const replaceBody = z.strictObject(fields);
// PATCH (JSON Merge Patch, RFC 7396): any subset, but at least one field.
const patchBody = z.strictObject(fields).partial()
  .refine((body) => Object.keys(body).length > 0, 'must change at least one field');

// The later of two change times: the composite changes when either the
// installation or its latest reading changes.
function latest(...dates) {
  return dates.filter(Boolean).reduce((a, b) => (a > b ? a : b), null);
}

// The installation's GET representation (the composite) and its validators.
async function compositeOf(db, installation) {
  const lastReading = await findLastReading(db, installation.installation_id);
  const body = toInstallationComposite(installation, lastReading);
  return { body, etag: etagOf(JSON.stringify(body)), lastModified: latest(installation.updated_at, lastReading?.received_at) };
}

// Optimistic concurrency (WSO2 §10.5): if the client says which version it
// edited (If-Match / If-Unmodified-Since) and that is no longer current,
// nothing is changed and the answer is 412.
function assertPrecondition(req, current) {
  if (preconditionFails(req, current.etag, current.lastModified)) {
    throw new ApiError(41201,
      `Installation '${req.params.installationId}' has changed since your copy was retrieved (current ETag ${current.etag}).`);
  }
}

async function assertSubstationExists(db, substationId) {
  if (substationId && !(await findGridSubstation(db, substationId))) {
    throw new ApiError(40002, 'The request body is invalid.', {
      errors: [{ code: 40002, field: 'substation_id', message: `no grid substation '${substationId}' exists` }],
    });
  }
}

// The database's unique constraint is the final word on duplicates, so two
// simultaneous registrations of one inverter cannot both succeed.
async function rethrowDuplicateInverter(promise, inverterId) {
  try {
    return await promise;
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'solar_installation_inverter_id_key') {
      throw new ApiError(40902, `inverter_id '${inverterId}' is already registered to another installation.`);
    }
    throw err;
  }
}

installationsRouter.route('/')
  .get(requireScope('assets:read'), async (req, res) => {
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const filters = { ...await jurisdictionFiltersOf(req, query), status: query.status };
    const page = await listInstallations(req.app.locals.db, {
      scope: scopeOf(req), filters, sort: query.sort, order: query.order, offset, limit,
    });
    sendPage(req, res, page, query, toInstallation);
  })
  // POST /installations: the collection is the factory for its members
  // (WSO2 §7.3). The server assigns the id and the device secret, and
  // answers 201 with the new resource's URI in Location.
  .post(requireScope('installations:write'), requireBodyType('application/json'), async (req, res) => {
    const db = req.app.locals.db;
    const body = parseBody(createBody, req);
    await assertSubstationExists(db, body.substation_id);
    const secret = generateDeviceSecret();
    const id = await rethrowDuplicateInverter(insertInstallation(db, body, hashDeviceSecret(secret)), body.inverter_id);
    const current = await compositeOf(db, await findInstallation(db, id));
    res.set('Location', absoluteUrl(req, `${config.basePath}/installations/${id}`));
    // The secret is returned exactly once, here; only its hash is stored.
    // ETag/Last-Modified describe the resource itself (what GET returns).
    sendRepresentation(req, res, { ...current.body, device_secret: secret }, {
      status: 201, etag: current.etag, lastModified: current.lastModified,
    });
  })
  .all(allowOnly('GET', 'POST'));

installationsRouter.route('/:installationId')
  // GET: composite (§4.3). It embeds a reading, so it needs both read scopes.
  .get(requireScope('assets:read'), requireScope('readings:read'), async (req, res) => {
    const current = await compositeOf(req.app.locals.db, await loadInstallation(req));
    sendRepresentation(req, res, current.body, { lastModified: current.lastModified });
  })
  // PUT: whole-resource replacement (§7.2), idempotent.
  .put(requireScope('installations:write'), requireBodyType('application/json'), async (req, res) => {
    const db = req.app.locals.db;
    const body = parseBody(replaceBody, req);
    await assertSubstationExists(db, body.substation_id);
    await withTransaction(db, async (tx) => {
      assertPrecondition(req, await compositeOf(tx, await loadInstallation(req, { db: tx, forUpdate: true })));
      await rethrowDuplicateInverter(updateInstallation(tx, req.params.installationId, body), body.inverter_id);
    });
    const current = await compositeOf(db, await loadInstallation(req));
    sendRepresentation(req, res, current.body, { lastModified: current.lastModified });
  })
  // PATCH: partial update as a JSON Merge Patch (RFC 7396).
  .patch(requireScope('installations:write'), requireBodyType('application/merge-patch+json', 'application/json'), async (req, res) => {
    const db = req.app.locals.db;
    const body = parseBody(patchBody, req);
    await assertSubstationExists(db, body.substation_id);
    await withTransaction(db, async (tx) => {
      assertPrecondition(req, await compositeOf(tx, await loadInstallation(req, { db: tx, forUpdate: true })));
      await rethrowDuplicateInverter(updateInstallation(tx, req.params.installationId, body), body.inverter_id);
    });
    const current = await compositeOf(db, await loadInstallation(req));
    sendRepresentation(req, res, current.body, { lastModified: current.lastModified });
  })
  // DELETE: decommission (§7.4). Idempotent in effect: the first call
  // returns 200, later calls 404 because the resource no longer exists.
  // Readings are kept; generation history is an audit record.
  .delete(requireScope('installations:write'), async (req, res) => {
    const removed = await withTransaction(req.app.locals.db, async (tx) => {
      assertPrecondition(req, await compositeOf(tx, await loadInstallation(req, { db: tx, forUpdate: true })));
      return decommissionInstallation(tx, req.params.installationId);
    });
    res.set('Cache-Control', 'no-store');
    res.json(toDecommissionedInstallation(removed));
  })
  .all(allowOnly('GET', 'PUT', 'PATCH', 'DELETE'));

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
