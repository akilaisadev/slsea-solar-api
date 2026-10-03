import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, assertErrorBody, as, userToken, deviceToken } from './helpers.js';
import { colomboToday } from '../src/lib/time.js';

after(() => db.end());

const BASE = '/solar/v1';
const national = as(await userToken('national.analyst'));
const colombo = as(await userToken('colombo.analyst'));

const yesterday = colomboToday(Date.now() - 24 * 60 * 60 * 1000);
const round3 = (v) => Math.round(v * 1000) / 1000;

// Recomputes the summary independently in JavaScript from raw rows, so the
// SQL aggregation is checked against a second, simpler implementation.
async function expectedSummary(districtId, date) {
  const { rows: sites } = await db.query(`
    SELECT i.installation_id, i.capacity_kw FROM solar_installation i JOIN grid_substation s USING (substation_id)
    WHERE s.district_id = $1 AND i.status <> 'decommissioned'`, [districtId]);
  const ids = sites.map((s) => s.installation_id);
  const { rows: readings } = await db.query(`
    SELECT installation_id, recorded_at, power_kw, energy_kwh FROM generation_reading
    WHERE installation_id = ANY($1) ORDER BY recorded_at`, [ids]);
  const dayStart = Date.parse(`${date}T00:00:00+05:30`);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const windowStart = Date.now() - 60 * 60 * 1000;

  let power = 0;
  let reporting = 0;
  let energy = 0;
  for (const id of ids) {
    const mine = readings.filter((r) => r.installation_id === id);
    const latest = mine.at(-1);
    if (latest && latest.recorded_at.getTime() >= windowStart) {
      reporting += 1;
      power += latest.power_kw;
    }
    const inDay = mine.filter((r) => r.recorded_at >= dayStart && r.recorded_at < dayEnd);
    if (inDay.length) {
      const before = mine.filter((r) => r.recorded_at < dayStart).at(-1);
      energy += inDay.at(-1).energy_kwh - (before ?? inDay[0]).energy_kwh;
    }
  }
  return {
    installation_count: sites.length,
    installed_capacity_kw: round3(sites.reduce((sum, s) => sum + s.capacity_kw, 0)),
    reporting_installation_count: reporting,
    current_total_power_kw: round3(power),
    total_energy_kwh: round3(energy),
  };
}

test('the district summary matches an independent recalculation (today)', async () => {
  const res = await national.get(`${BASE}/districts/ds-01/generation-summary`);
  assert.equal(res.status, 200);
  assert.equal(res.body.date, colomboToday());
  assert.equal(res.body.timezone, 'Asia/Colombo');
  const expected = await expectedSummary('ds-01', res.body.date);
  for (const [field, value] of Object.entries(expected)) {
    assert.ok(Math.abs(res.body[field] - value) < 0.01, `${field}: ${res.body[field]} vs ${value}`);
  }
  assert.ok(res.body.reporting_installation_count < res.body.installation_count,
    'the maintenance site in Colombo has stopped reporting');
});

test('?date= selects the day for total energy; a full past day yields a realistic total', async () => {
  const res = await national.get(`${BASE}/districts/ds-01/generation-summary?date=${yesterday}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.date, yesterday);
  const expected = await expectedSummary('ds-01', yesterday);
  assert.ok(Math.abs(res.body.total_energy_kwh - expected.total_energy_kwh) < 0.01);
  // Sri Lankan rooftops yield roughly 2-6 kWh per kW of capacity per day.
  const yieldPerKw = res.body.total_energy_kwh / res.body.installed_capacity_kw;
  assert.ok(yieldPerKw > 1.5 && yieldPerKw < 6.5, `daily yield ${yieldPerKw.toFixed(2)} kWh/kW`);
});

test('a day with no readings yields zero energy, not an error', async () => {
  const res = await national.get(`${BASE}/districts/ds-01/generation-summary?date=2020-01-01`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total_energy_kwh, 0);
});

test('invalid dates are rejected with 400', async () => {
  for (const date of ['2999-01-01', 'yesterday', '2026-13-01']) {
    assertErrorBody(await national.get(`${BASE}/districts/ds-01/generation-summary?date=${date}`), 400, 40001);
  }
});

test('the summary respects jurisdiction, scope and existence', async () => {
  assert.equal((await colombo.get(`${BASE}/districts/ds-01/generation-summary`)).status, 200);
  assertErrorBody(await colombo.get(`${BASE}/districts/ds-04/generation-summary`), 403, 40302);
  const device = as(await deviceToken('ins-0001'));
  assertErrorBody(await device.get(`${BASE}/districts/ds-01/generation-summary`), 403, 40301);
  assertErrorBody(await national.get(`${BASE}/districts/ds-99/generation-summary`), 404, 40401);
});

test('the summary supports conditional GET', async () => {
  const first = await national.get(`${BASE}/districts/ds-04/generation-summary?date=${yesterday}`);
  const replay = await national.get(`${BASE}/districts/ds-04/generation-summary?date=${yesterday}`)
    .set('If-None-Match', first.headers.etag);
  assert.equal(replay.status, 304);
});
