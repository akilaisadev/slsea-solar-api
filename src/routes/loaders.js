import { ApiError } from '../lib/errors.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { findInstallation } from '../repositories/installations.js';

// Loads the installation named in the path for every route below
// /installations/{installation-id}: 404 if it does not exist (or was
// decommissioned), 403 if it lies outside the caller's jurisdiction.
export async function loadInstallation(req) {
  const { installationId } = req.params;
  const installation = await findInstallation(req.app.locals.db, installationId);
  if (!installation) throw new ApiError(40401, `Installation '${installationId}' was not found.`);
  assertInScope(scopeOf(req), installation, `Installation '${installationId}'`);
  return installation;
}
