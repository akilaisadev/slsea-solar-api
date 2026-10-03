import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, assertErrorBody, as, userToken } from './helpers.js';

after(() => db.end());

// A national analyst sees every jurisdiction, so these tests exercise the
// resources themselves; jurisdiction limits are tested in auth.test.js.
const national = as(await userToken('national.analyst'));

const BASE = '/solar/v1';
// From the small seed: ins-0001 reports normally, ins-0017 stopped reporting
// two days ago (maintenance), ins-0240 was registered today with no readings.
const REPORTING = 'ins-0001';
const STOPPED = 'ins-0017';
const SILENT = 'ins-0240';

async function latestInDb(installationId) {
  const { rows } = await db.query(
    'SELECT reading_id, recorded_at FROM generation_reading WHERE installation_id = $1 ORDER BY recorded_at DESC LIMIT 1',
    [installationId],
  );
  return rows[0];
}

test('the installation composite embeds its location chain and the latest reading', async () => {
  const res = await national.get(`${BASE}/installations/${REPORTING}`);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.location), ['grid_substation', 'district', 'province']);
  assert.deepEqual(res.body.location.district, { district_id: 'ds-01', name: 'Colombo' });
  assert.deepEqual(res.body.location.province, { province_id: 'pv-01', name: 'Western' });

  const latest = await latestInDb(REPORTING);
  assert.equal(res.body.last_reading.reading_id, latest.reading_id, 'last_reading must be the newest by recorded_at');
  assert.equal(res.body.readings, undefined, 'the history must not be embedded in the composite');
  assert.equal(res.body.last_power, undefined, 'no last-value fields on the installation');
});

test('a site with no readings has last_reading: null in the composite', async () => {
  const res = await national.get(`${BASE}/installations/${SILENT}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.last_reading, null);
});

test('last-reading is derived from the time series and matches the composite', async () => {
  const [composite, derived] = await Promise.all([
    national.get(`${BASE}/installations/${REPORTING}`),
    national.get(`${BASE}/installations/${REPORTING}/last-reading`),
  ]);
  assert.equal(derived.status, 200);
  assert.deepEqual(derived.body, composite.body.last_reading);
  assert.deepEqual(Object.keys(derived.body),
    ['reading_id', 'installation_id', 'recorded_at', 'power_kw', 'energy_kwh', 'voltage_v', 'received_at']);
  assert.equal(derived.headers['last-modified'], new Date(derived.body.received_at).toUTCString());
});

test('last-reading of a stopped site is its last report, two days old', async () => {
  const res = await national.get(`${BASE}/installations/${STOPPED}/last-reading`);
  assert.equal(res.status, 200);
  const ageHours = (Date.now() - Date.parse(res.body.recorded_at)) / 3_600_000;
  assert.ok(ageHours >= 47 && ageHours < 49.5, `expected about 48 hours old, got ${ageHours.toFixed(1)}`);
});

test('last-reading of a site that never reported is 404', async () => {
  const res = await national.get(`${BASE}/installations/${SILENT}/last-reading`);
  assertErrorBody(res, 404, 40401);
  assert.match(res.body.message, /has not reported any readings yet/);
});

test('the readings sub-collection is scoped to its installation, newest first', async () => {
  const { rows } = await db.query('SELECT count(*) FROM generation_reading WHERE installation_id = $1', [REPORTING]);
  const res = await national.get(`${BASE}/installations/${REPORTING}/readings?limit=100`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, rows[0].count);
  assert.equal(res.body.items.length, 100);
  assert.ok(res.body.items.every((r) => r.installation_id === REPORTING));
  const times = res.body.items.map((r) => Date.parse(r.recorded_at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('an installation with no readings has an empty history (200), not 404', async () => {
  const res = await national.get(`${BASE}/installations/${SILENT}/readings`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.items, []);
});

test('a single reading is addressable only under its own installation', async () => {
  const latest = await latestInDb(REPORTING);
  const ok = await national.get(`${BASE}/installations/${REPORTING}/readings/${latest.reading_id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reading_id, latest.reading_id);

  const otherParent = await national.get(`${BASE}/installations/${STOPPED}/readings/${latest.reading_id}`);
  assertErrorBody(otherParent, 404, 40401);

  const notANumber = await national.get(`${BASE}/installations/${REPORTING}/readings/latest`);
  assertErrorBody(notANumber, 404, 40401);
});

test('sub-resources of an unknown installation are 404', async () => {
  for (const path of ['/readings', '/last-reading', '/readings/1']) {
    const res = await national.get(`${BASE}/installations/ins-9999${path}`);
    assertErrorBody(res, 404, 40401);
  }
});
