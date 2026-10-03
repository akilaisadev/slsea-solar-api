import { Conditions } from '../lib/sql.js';
import { restrictToScope } from '../lib/jurisdiction.js';
import { fetchPage } from './page.js';

const READING_COLUMNS = 'r.reading_id, r.installation_id, r.recorded_at, r.power_kw, r.energy_kwh, r.voltage_v, r.received_at';

// Client sort keys map onto fixed SQL columns; anything else never reaches SQL.
const SORT_COLUMNS = { recorded_at: 'r.recorded_at', power_kw: 'r.power_kw' };

// reading_id is unique, so adding it as the last sort key gives a total
// order: rows with equal recorded_at (many sites report at the same instant)
// or equal power_kw (every site reads 0 overnight) cannot shift between
// pages, so offset pagination never skips or repeats a reading.
function orderByOf(sort, order) {
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  return `${SORT_COLUMNS[sort]} ${direction}, r.reading_id ${direction}`;
}

function applyTimeWindow(conditions, { from, to }) {
  if (from) conditions.add('r.recorded_at >= ?', from);
  if (to) conditions.add('r.recorded_at < ?', to);
}

// The most recent reading by measurement time. Served by the
// (installation_id, recorded_at) unique index scanned backwards, so it stays
// fast however long the history grows.
export async function findLastReading(db, installationId) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS} FROM generation_reading r
     WHERE r.installation_id = $1 ORDER BY r.recorded_at DESC LIMIT 1`,
    [installationId],
  );
  return rows[0] ?? null;
}

// History of one installation (the scoped sub-collection).
export function listInstallationReadings(db, { installationId, window, sort, order, offset, limit }) {
  const conditions = new Conditions();
  conditions.add('r.installation_id = ?', installationId);
  applyTimeWindow(conditions, window);
  return fetchPage(db, {
    select: READING_COLUMNS,
    from: 'generation_reading r',
    conditions,
    orderBy: orderByOf(sort, order),
    offset,
    limit,
    // Readings are append-only, so the newest arrival is the last change.
    lastModified: 'max(r.received_at)',
  });
}

// Regional analytical view across installations, always clipped to the
// caller's jurisdiction. History of decommissioned sites stays included:
// it is still generation that happened in the region.
export function listRegionalReadings(db, { scope, filters, window, sort, order, offset, limit }) {
  const conditions = new Conditions();
  restrictToScope(conditions, scope, { province: 'd.province_id', district: 'd.district_id' });
  if (filters.provinceId) conditions.add('d.province_id = ?', filters.provinceId);
  if (filters.districtId) conditions.add('d.district_id = ?', filters.districtId);
  if (filters.substationId) conditions.add('i.substation_id = ?', filters.substationId);
  applyTimeWindow(conditions, window);
  return fetchPage(db, {
    select: READING_COLUMNS,
    from: `generation_reading r
      JOIN solar_installation i ON i.installation_id = r.installation_id
      JOIN grid_substation s ON s.substation_id = i.substation_id
      JOIN district d ON d.district_id = s.district_id`,
    conditions,
    orderBy: orderByOf(sort, order),
    offset,
    limit,
    lastModified: 'max(r.received_at)',
  });
}

export async function findReading(db, installationId, readingId) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS} FROM generation_reading r
     WHERE r.installation_id = $1 AND r.reading_id = $2`,
    [installationId, readingId],
  );
  return rows[0] ?? null;
}
