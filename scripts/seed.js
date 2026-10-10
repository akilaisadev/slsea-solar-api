// Replaces all data with a deterministic, foreign-key-consistent dataset:
//   9 provinces, 25 districts, 32 grid substations, 240 installations,
//   5 demo users and 9 days of 15-minute readings ending now (9 days so the
//   sites that stopped reporting two days ago still have a full week).
// Usage: node scripts/seed.js [--small]
//   --small  every 6th installation plus the edge cases, 2 days (for tests)
import bcrypt from 'bcryptjs';
import { createPool } from '../src/db/pool.js';
import { hashDeviceSecret } from '../src/lib/credentials.js';
import { PROVINCES, DISTRICTS, SUBSTATIONS, USERS, INSTALLATION_COUNT, buildInstallations } from './lib/seed-data.js';
import { readingsBetween, floorToSlot, hashToUnit } from './lib/solar-model.js';
import { deriveDeviceSecret } from './lib/device-secrets.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_ROWS = 20_000;

const small = process.argv.includes('--small');
const days = small ? 2 : 9;
const { DATABASE_URL, DEVICE_SECRET_SEED, DEMO_PASSWORD } = process.env;
if (!DEVICE_SECRET_SEED || !DEMO_PASSWORD) {
  throw new Error('DEVICE_SECRET_SEED and DEMO_PASSWORD must be set (see .env.example).');
}

const now = Date.now();
const end = floorToSlot(now);
const start = end - days * DAY_MS;
const todayInColombo = new Date(now + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

let installations = buildInstallations({ today: todayInColombo, includeEmptyHistory: small });
if (small) {
  installations = installations.filter((inst, i) => i % 6 === 0 || inst.reporting !== 'normal');
}

const db = createPool(DATABASE_URL);
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query(`TRUNCATE generation_reading, app_user, solar_installation,
                               grid_substation, district, province RESTART IDENTITY CASCADE`);

  await client.query(
    `INSERT INTO province (province_id, name) SELECT * FROM unnest($1::text[], $2::text[])`,
    [PROVINCES.map((p) => p.province_id), PROVINCES.map((p) => p.name)],
  );
  await client.query(
    `INSERT INTO district (district_id, name, province_id) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])`,
    [DISTRICTS.map((d) => d.district_id), DISTRICTS.map((d) => d.name), DISTRICTS.map((d) => d.province_id)],
  );
  await client.query(
    `INSERT INTO grid_substation (substation_id, name, district_id) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])`,
    [SUBSTATIONS.map((s) => s.substation_id), SUBSTATIONS.map((s) => s.name), SUBSTATIONS.map((s) => s.district_id)],
  );

  for (const inst of installations) {
    const secretHash = hashDeviceSecret(deriveDeviceSecret(DEVICE_SECRET_SEED, inst.installation_id));
    await client.query(
      `INSERT INTO solar_installation (installation_id, inverter_id, substation_id, capacity_kw, latitude,
         longitude, commissioned_on, status, decommissioned_at, device_secret_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)`,
      [inst.installation_id, inst.inverter_id, inst.substation_id, inst.capacity_kw, inst.latitude,
        inst.longitude, inst.commissioned_on, inst.status, secretHash],
    );
  }
  // New installations created through the API continue after ins-0240
  // (also in --small mode, so test-created IDs never clash with seed IDs).
  await client.query(`SELECT setval('installation_number_seq', $1)`, [INSTALLATION_COUNT]);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const user of USERS) {
    await client.query(
      `INSERT INTO app_user (user_id, username, display_name, password_hash, role, jurisdiction_level, province_id, district_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.user_id, user.username, user.display_name, passwordHash, user.role,
        user.jurisdiction_level, user.province_id, user.district_id],
    );
  }

  let batch = emptyBatch();
  let total = 0;
  for (const inst of installations) {
    if (inst.reporting === 'none') continue;
    const lastSlot = inst.reporting === 'stopped-2-days-ago' ? end - 2 * DAY_MS : end;
    for (const r of readingsBetween(inst, start, lastSlot)) {
      batch.installation_id.push(inst.installation_id);
      batch.recorded_at.push(new Date(r.recorded_at));
      batch.power_kw.push(r.power_kw);
      batch.energy_kwh.push(r.energy_kwh);
      batch.voltage_v.push(r.voltage_v);
      // Devices upload a few seconds after measuring.
      batch.received_at.push(new Date(r.recorded_at + 2000 + hashToUnit(inst.installation_id, 'lag', r.recorded_at) * 18_000));
      if (batch.installation_id.length === BATCH_ROWS) {
        total += await insertReadings(client, batch);
        batch = emptyBatch();
      }
    }
  }
  total += await insertReadings(client, batch);

  await client.query('COMMIT');
  console.log(`Seeded ${PROVINCES.length} provinces, ${DISTRICTS.length} districts, ${SUBSTATIONS.length} substations, `
    + `${installations.length} installations, ${USERS.length} users and ${total} readings `
    + `(${new Date(start).toISOString()} to ${new Date(end).toISOString()}).`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await db.end();
}

function emptyBatch() {
  return { installation_id: [], recorded_at: [], power_kw: [], energy_kwh: [], voltage_v: [], received_at: [] };
}

// One INSERT per batch: unnest() turns six parallel arrays into rows, so
// the statement has six parameters however many rows it carries.
async function insertReadings(tx, b) {
  if (b.installation_id.length === 0) return 0;
  const { rowCount } = await tx.query(
    `INSERT INTO generation_reading (installation_id, recorded_at, power_kw, energy_kwh, voltage_v, received_at)
     SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::numeric[], $4::numeric[], $5::numeric[], $6::timestamptz[])`,
    [b.installation_id, b.recorded_at, b.power_kw, b.energy_kwh, b.voltage_v, b.received_at],
  );
  return rowCount;
}
