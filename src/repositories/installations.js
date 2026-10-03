import { Conditions } from '../lib/sql.js';
import { restrictToScope } from '../lib/jurisdiction.js';
import { fetchPage } from './page.js';

const INSTALLATION_COLUMNS = `i.installation_id, i.inverter_id, i.substation_id, i.capacity_kw, i.latitude,
  i.longitude, i.commissioned_on, i.status`;

const FROM_INSTALLATIONS = `solar_installation i
  JOIN grid_substation s ON s.substation_id = i.substation_id
  JOIN district d ON d.district_id = s.district_id`;

// Client sort keys map onto fixed SQL columns; installation_id is appended
// as a unique tie-breaker so equal capacities paginate deterministically.
const SORT_COLUMNS = { installation_id: 'i.installation_id', capacity_kw: 'i.capacity_kw', commissioned_on: 'i.commissioned_on' };

// Decommissioned installations have left the API (DELETE is a soft delete
// that keeps their readings), so every query excludes them.
export function listInstallations(db, { scope, filters = {}, sort = 'installation_id', order = 'asc', offset, limit }) {
  const direction = order === 'desc' ? 'DESC' : 'ASC';
  const conditions = new Conditions();
  conditions.addFixed(`i.status <> 'decommissioned'`);
  restrictToScope(conditions, scope, { province: 'd.province_id', district: 'd.district_id' });
  if (filters.provinceId) conditions.add('d.province_id = ?', filters.provinceId);
  if (filters.districtId) conditions.add('d.district_id = ?', filters.districtId);
  if (filters.substationId) conditions.add('i.substation_id = ?', filters.substationId);
  if (filters.status) conditions.add('i.status = ?', filters.status);
  return fetchPage(db, {
    select: INSTALLATION_COLUMNS,
    from: FROM_INSTALLATIONS,
    conditions,
    orderBy: `${SORT_COLUMNS[sort]} ${direction}, i.installation_id ${direction}`,
    offset,
    limit,
    // Any change to any installation (including a decommission, which
    // removes a member from the list) moves Last-Modified forward.
    lastModified: '(SELECT max(updated_at) FROM solar_installation)',
  });
}

// `forUpdate` locks the installation row until the surrounding transaction
// ends, so a precondition check (If-Match) and the write it guards cannot be
// interleaved with another writer's.
export async function findInstallation(db, installationId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${INSTALLATION_COLUMNS}, i.updated_at,
            s.name AS substation_name, d.district_id, d.name AS district_name,
            p.province_id, p.name AS province_name
     FROM ${FROM_INSTALLATIONS}
     JOIN province p ON p.province_id = d.province_id
     WHERE i.installation_id = $1 AND i.status <> 'decommissioned'
     ${forUpdate ? 'FOR UPDATE OF i' : ''}`,
    [installationId],
  );
  return rows[0] ?? null;
}

// Writable fields of an installation; the id, the secret hash and the
// audit timestamps are always set by the server.
const WRITABLE = ['inverter_id', 'substation_id', 'capacity_kw', 'latitude', 'longitude', 'commissioned_on', 'status'];

export async function insertInstallation(db, fields, deviceSecretHash) {
  const { rows } = await db.query(
    `INSERT INTO solar_installation (${WRITABLE.join(', ')}, device_secret_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING installation_id`,
    [...WRITABLE.map((column) => fields[column]), deviceSecretHash],
  );
  return rows[0].installation_id;
}

// PUT and PATCH both end here: `fields` holds every writable field for a
// replacement, or only the changed ones for a partial update. Column names
// come from the WRITABLE whitelist, never from the client.
export async function updateInstallation(db, installationId, fields) {
  const columns = WRITABLE.filter((column) => column in fields);
  const assignments = columns.map((column, i) => `${column} = $${i + 2}`);
  await db.query(
    `UPDATE solar_installation SET ${assignments.join(', ')} WHERE installation_id = $1`,
    [installationId, ...columns.map((column) => fields[column])],
  );
}

// DELETE is a soft delete: the installation leaves the API, but its
// readings remain as an audit record of generation that happened.
export async function decommissionInstallation(db, installationId) {
  const { rows } = await db.query(
    `UPDATE solar_installation SET status = 'decommissioned', decommissioned_at = now()
     WHERE installation_id = $1
     RETURNING installation_id, inverter_id, substation_id, capacity_kw, latitude, longitude,
               commissioned_on, status, decommissioned_at`,
    [installationId],
  );
  return rows[0];
}
