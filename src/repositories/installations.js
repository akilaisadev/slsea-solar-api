import { Conditions } from '../lib/sql.js';
import { restrictToScope } from '../lib/jurisdiction.js';
import { fetchPage } from './page.js';

const INSTALLATION_COLUMNS = `i.installation_id, i.inverter_id, i.substation_id, i.capacity_kw, i.latitude,
  i.longitude, i.commissioned_on, i.status`;

const FROM_INSTALLATIONS = `solar_installation i
  JOIN grid_substation s ON s.substation_id = i.substation_id
  JOIN district d ON d.district_id = s.district_id`;

// Decommissioned installations have left the API (DELETE is a soft delete
// that keeps their readings), so every query excludes them.
export function listInstallations(db, { scope, filters = {}, offset, limit }) {
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
    orderBy: 'i.installation_id',
    offset,
    limit,
    // Any change to any installation (including a decommission, which
    // removes a member from the list) moves Last-Modified forward.
    lastModified: '(SELECT max(updated_at) FROM solar_installation)',
  });
}

export async function findInstallation(db, installationId) {
  const { rows } = await db.query(
    `SELECT ${INSTALLATION_COLUMNS}, i.updated_at,
            s.name AS substation_name, d.district_id, d.name AS district_name,
            p.province_id, p.name AS province_name
     FROM ${FROM_INSTALLATIONS}
     JOIN province p ON p.province_id = d.province_id
     WHERE i.installation_id = $1 AND i.status <> 'decommissioned'`,
    [installationId],
  );
  return rows[0] ?? null;
}
