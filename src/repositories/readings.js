import { Conditions } from '../lib/sql.js';
import { fetchPage } from './page.js';

const READING_COLUMNS = 'r.reading_id, r.installation_id, r.recorded_at, r.power_kw, r.energy_kwh, r.voltage_v, r.received_at';

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
export function listInstallationReadings(db, { installationId, offset, limit }) {
  const conditions = new Conditions();
  conditions.add('r.installation_id = ?', installationId);
  return fetchPage(db, {
    select: READING_COLUMNS,
    from: 'generation_reading r',
    conditions,
    orderBy: 'r.recorded_at DESC',
    offset,
    limit,
    // Readings are append-only, so the newest arrival is the last change.
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
