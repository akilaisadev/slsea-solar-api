import { Conditions } from '../lib/sql.js';
import { restrictToScope } from '../lib/jurisdiction.js';
import { fetchPage } from './page.js';

// Provinces, districts and grid substations: read-only reference data.

export function listProvinces(db, { scope, offset, limit }) {
  const conditions = new Conditions();
  restrictToScope(conditions, scope, { province: 'p.province_id' });
  return fetchPage(db, {
    select: 'p.province_id, p.name',
    from: 'province p',
    conditions,
    orderBy: 'p.province_id',
    offset,
    limit,
    lastModified: 'max(p.updated_at)',
  });
}

export async function findProvince(db, provinceId) {
  const { rows } = await db.query(
    'SELECT province_id, name, updated_at FROM province WHERE province_id = $1',
    [provinceId],
  );
  return rows[0] ?? null;
}

export function listDistricts(db, { scope, filters = {}, offset, limit }) {
  const conditions = new Conditions();
  restrictToScope(conditions, scope, { province: 'd.province_id', district: 'd.district_id' });
  if (filters.provinceId) conditions.add('d.province_id = ?', filters.provinceId);
  return fetchPage(db, {
    select: 'd.district_id, d.name, d.province_id',
    from: 'district d',
    conditions,
    orderBy: 'd.district_id',
    offset,
    limit,
    lastModified: 'max(d.updated_at)',
  });
}

export async function findDistrict(db, districtId) {
  const { rows } = await db.query(
    'SELECT district_id, name, province_id, updated_at FROM district WHERE district_id = $1',
    [districtId],
  );
  return rows[0] ?? null;
}

export function listGridSubstations(db, { scope, filters = {}, offset, limit }) {
  const conditions = new Conditions();
  restrictToScope(conditions, scope, { province: 'd.province_id', district: 's.district_id' });
  if (filters.provinceId) conditions.add('d.province_id = ?', filters.provinceId);
  if (filters.districtId) conditions.add('s.district_id = ?', filters.districtId);
  return fetchPage(db, {
    select: 's.substation_id, s.name, s.district_id',
    from: 'grid_substation s JOIN district d ON d.district_id = s.district_id',
    conditions,
    orderBy: 's.substation_id',
    offset,
    limit,
    lastModified: 'max(s.updated_at)',
  });
}

export async function findGridSubstation(db, substationId) {
  const { rows } = await db.query(
    `SELECT s.substation_id, s.name, s.district_id, d.province_id, s.updated_at
     FROM grid_substation s JOIN district d ON d.district_id = s.district_id
     WHERE s.substation_id = $1`,
    [substationId],
  );
  return rows[0] ?? null;
}
