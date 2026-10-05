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
//
// Two steps: first resolve which installations the caller may see (at most a
// few hundred ids, a small join), then select readings by installation id.
// Counting the readings no longer joins every one of ~200k rows to three
// tables: measured locally after VACUUM ANALYZE, the national count with
// Last-Modified went from ~159 ms to ~98 ms.
export async function listRegionalReadings(db, { scope, filters, window, sort, order, offset, limit }) {
  const sites = new Conditions();
  restrictToScope(sites, scope, { province: 'd.province_id', district: 'd.district_id' });
  if (filters.provinceId) sites.add('d.province_id = ?', filters.provinceId);
  if (filters.districtId) sites.add('d.district_id = ?', filters.districtId);
  if (filters.substationId) sites.add('i.substation_id = ?', filters.substationId);
  const { rows } = await db.query(
    `SELECT i.installation_id FROM solar_installation i
     JOIN grid_substation s ON s.substation_id = i.substation_id
     JOIN district d ON d.district_id = s.district_id
     ${sites.where}`,
    sites.params,
  );
  if (rows.length === 0) return { count: 0, lastModified: null, rows: [] };

  const conditions = new Conditions();
  conditions.add('r.installation_id = ANY(?)', rows.map((row) => row.installation_id));
  applyTimeWindow(conditions, window);
  return fetchPage(db, {
    select: READING_COLUMNS,
    from: 'generation_reading r',
    conditions,
    orderBy: orderByOf(sort, order),
    offset,
    limit,
    lastModified: 'max(r.received_at)',
  });
}

// The reading immediately before an instant, used to check that the
// cumulative energy counter never runs backwards.
export async function findReadingBefore(db, installationId, instant) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS} FROM generation_reading r
     WHERE r.installation_id = $1 AND r.recorded_at < $2
     ORDER BY r.recorded_at DESC LIMIT 1`,
    [installationId, instant],
  );
  return rows[0] ?? null;
}

// The reading immediately after an instant: a back-filled reading must not
// carry a higher cumulative counter than the one that follows it.
export async function findReadingAfter(db, installationId, instant) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS} FROM generation_reading r
     WHERE r.installation_id = $1 AND r.recorded_at > $2
     ORDER BY r.recorded_at ASC LIMIT 1`,
    [installationId, instant],
  );
  return rows[0] ?? null;
}

// Serialises uploads for one installation until the transaction ends
// (a PostgreSQL advisory lock keyed on the installation id). Uploads for
// different installations still run in parallel.
export async function lockInstallationReadings(tx, installationId) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [installationId]);
}

// Appends one reading. received_at is set by the database clock, never by
// the client. Returns null if a reading already exists for that instant
// (the unique constraint makes a retried upload harmless).
export async function insertReading(db, installationId, reading) {
  const { rows } = await db.query(
    `INSERT INTO generation_reading (installation_id, recorded_at, power_kw, energy_kwh, voltage_v)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ON CONSTRAINT generation_reading_unique_instant DO NOTHING
     RETURNING reading_id, installation_id, recorded_at, power_kw, energy_kwh, voltage_v, received_at`,
    [installationId, reading.recorded_at, reading.power_kw, reading.energy_kwh, reading.voltage_v],
  );
  return rows[0] ?? null;
}

export async function findReadingAt(db, installationId, instant) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS} FROM generation_reading r
     WHERE r.installation_id = $1 AND r.recorded_at = $2`,
    [installationId, instant],
  );
  return rows[0] ?? null;
}

export async function findReading(db, installationId, readingId) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS} FROM generation_reading r
     WHERE r.installation_id = $1 AND r.reading_id = $2`,
    [installationId, readingId],
  );
  return rows[0] ?? null;
}
