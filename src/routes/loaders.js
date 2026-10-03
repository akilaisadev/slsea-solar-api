import { ApiError } from '../lib/errors.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { findInstallation } from '../repositories/installations.js';

// Loads the installation named in the path for SLSEA-user routes below
// /installations/{installation-id}: 404 if it does not exist (or was
// decommissioned), 403 if it lies outside the caller's jurisdiction.
// Inside a transaction, pass the transaction's client and forUpdate to lock
// the row for the rest of the transaction.
export async function loadInstallation(req, { db = req.app.locals.db, forUpdate = false } = {}) {
  const { installationId } = req.params;
  const installation = await findInstallation(db, installationId, { forUpdate });
  if (!installation) throw new ApiError(40401, `Installation '${installationId}' was not found.`);
  assertInScope(scopeOf(req), installation, `Installation '${installationId}'`);
  return installation;
}

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
