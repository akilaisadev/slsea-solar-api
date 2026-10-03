import { ApiError } from '../lib/errors.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { findProvince, findDistrict, findGridSubstation } from '../repositories/hierarchy.js';
import { findInstallation } from '../repositories/installations.js';

// Every member route resolves its path id the same way: 404 if no such
// resource exists, then 403 if it lies outside the caller's jurisdiction.
// Doing it here keeps that order (and the error wording) identical everywhere.
async function loadInScope(req, { find, id, label, db = req.app.locals.db, forUpdate = false }) {
  const resource = await find(db, id, { forUpdate });
  if (!resource) throw new ApiError(40401, `${label} '${id}' was not found.`);
  assertInScope(scopeOf(req), resource, `${label} '${id}'`);
  return resource;
}

export const loadProvince = (req) =>
  loadInScope(req, { find: findProvince, id: req.params.provinceId, label: 'Province' });

export const loadDistrict = (req) =>
  loadInScope(req, { find: findDistrict, id: req.params.districtId, label: 'District' });

export const loadGridSubstation = (req) =>
  loadInScope(req, { find: findGridSubstation, id: req.params.substationId, label: 'Grid substation' });

// Inside a transaction, pass the transaction's client and forUpdate to lock
// the installation row for the rest of the transaction.
export const loadInstallation = (req, { db, forUpdate } = {}) =>
  loadInScope(req, { find: findInstallation, id: req.params.installationId, label: 'Installation', db, forUpdate });

// Device routes: a device token is bound to exactly one installation (its
// sub claim). Writing to any other installation is refused (403) before the
// database is even consulted, so a device cannot probe which ids exist.
export async function loadDeviceInstallation(req) {
  const { installationId } = req.params;
  if (req.auth.installationId !== installationId) {
    throw new ApiError(40303,
      `This device is authenticated as installation '${req.auth.installationId}' and cannot write readings for '${installationId}'.`);
  }
  const installation = await findInstallation(req.app.locals.db, installationId);
  if (!installation) throw new ApiError(40401, `Installation '${installationId}' was not found.`);
  return installation;
}
