import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './helpers.js';

// Each test runs inside a transaction that is rolled back, so the schema
// tests never leave rows behind for the API tests.
let client;
beforeEach(async () => {
  client = await db.connect();
  await client.query('BEGIN');
  await client.query(`
    INSERT INTO province (province_id, name) VALUES ('pv-99', 'Test Province');
    INSERT INTO district (district_id, name, province_id) VALUES ('ds-99', 'Test District', 'pv-99');
    INSERT INTO grid_substation (substation_id, name, district_id) VALUES ('gss-999', 'Test GSS', 'ds-99');
    INSERT INTO solar_installation (installation_id, inverter_id, substation_id, capacity_kw,
      latitude, longitude, commissioned_on, device_secret_hash, updated_at)
    VALUES ('ins-9999', 'INV-TEST-1', 'gss-999', 5, 6.9, 79.9, '2024-01-01', 'x', '2000-01-01T00:00:00Z');
    INSERT INTO generation_reading (installation_id, recorded_at, power_kw, energy_kwh, voltage_v)
    VALUES ('ins-9999', '2026-01-01T06:00:00Z', 1.2, 100, 231.5);
  `);
});
afterEach(async () => {
  await client.query('ROLLBACK');
  client.release();
});
after(() => db.end());

async function rejects(sql, pattern) {
  await client.query('SAVEPOINT attempt');
  await assert.rejects(client.query(sql), pattern);
  await client.query('ROLLBACK TO SAVEPOINT attempt');
}

test('readings are append-only: UPDATE is rejected by the database', async () => {
  await rejects(`UPDATE generation_reading SET power_kw = 0 WHERE installation_id = 'ins-9999'`, /append-only/);
});

test('readings are append-only: DELETE is rejected by the database', async () => {
  await rejects(`DELETE FROM generation_reading WHERE installation_id = 'ins-9999'`, /append-only/);
});

test('one reading per installation per instant', async () => {
  await rejects(`
    INSERT INTO generation_reading (installation_id, recorded_at, power_kw, energy_kwh, voltage_v)
    VALUES ('ins-9999', '2026-01-01T06:00:00Z', 1.3, 100.1, 231)`, /generation_reading_unique_instant/);
});

test('a reading must belong to an existing installation', async () => {
  await rejects(`
    INSERT INTO generation_reading (installation_id, recorded_at, power_kw, energy_kwh, voltage_v)
    VALUES ('ins-0000', '2026-01-01T06:15:00Z', 1, 1, 230)`, /foreign key/);
});

test('a district user must name a district and no province', async () => {
  await rejects(`
    INSERT INTO app_user (user_id, username, display_name, password_hash, role, jurisdiction_level, province_id)
    VALUES ('usr-99', 'bad', 'Bad', 'x', 'analyst', 'district', 'pv-99')`, /jurisdiction_consistent/);
});

test('an asset admin must have national jurisdiction', async () => {
  await rejects(`
    INSERT INTO app_user (user_id, username, display_name, password_hash, role, jurisdiction_level, district_id)
    VALUES ('usr-98', 'bad2', 'Bad', 'x', 'asset_admin', 'district', 'ds-99')`, /admin_is_national/);
});

test('updating an installation refreshes updated_at (the Last-Modified source)', async () => {
  await client.query(`UPDATE solar_installation SET capacity_kw = 6 WHERE installation_id = 'ins-9999'`);
  const { rows } = await client.query(`SELECT updated_at, capacity_kw FROM solar_installation WHERE installation_id = 'ins-9999'`);
  assert.equal(rows[0].capacity_kw, 6);
  assert.ok(rows[0].updated_at > new Date('2000-01-01T00:00:00Z'), 'trigger should replace the old timestamp');
});
