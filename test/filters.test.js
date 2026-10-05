import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, assertErrorBody, as, userToken } from './helpers.js';

after(() => db.end());

// A national analyst sees every jurisdiction, so these tests exercise the
// resources themselves; jurisdiction limits are tested in auth.test.js.
const national = as(await userToken('national.analyst'));

const BASE = '/solar/v1';

// Readings in the small seed span the last two days; pick windows relative
// to the newest reading so the tests do not depend on when they run.
async function newestReadingTime() {
  const { rows } = await db.query('SELECT max(recorded_at) AS t FROM generation_reading');
  return rows[0].t;
}

async function installationsInDistrict(districtId) {
  const { rows } = await db.query(
    `SELECT i.installation_id FROM solar_installation i JOIN grid_substation s USING (substation_id)
     WHERE s.district_id = $1 AND i.status <> 'decommissioned'`,
    [districtId],
  );
  return new Set(rows.map((r) => r.installation_id));
}

test('installations can be filtered by district (jurisdiction filter)', async () => {
  const expected = await installationsInDistrict('ds-01');
  const res = await national.get(`${BASE}/installations?district-id=ds-01&limit=500`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, expected.size);
  assert.ok(res.body.items.every((i) => expected.has(i.installation_id)));
});

test('installations can be filtered by province and by status', async () => {
  const western = await national.get(`${BASE}/installations?province-id=pv-01&limit=500`);
  const westernDistricts = await Promise.all(['ds-01', 'ds-02', 'ds-03'].map(installationsInDistrict));
  assert.equal(western.body.count, westernDistricts.reduce((n, s) => n + s.size, 0));

  const maintenance = await national.get(`${BASE}/installations?status=maintenance`);
  assert.equal(maintenance.body.count, 3);
  assert.ok(maintenance.body.items.every((i) => i.status === 'maintenance'));
});

test('installations sort by capacity in both directions', async () => {
  const asc = await national.get(`${BASE}/installations?sort=capacity_kw&order=asc&limit=500`);
  const desc = await national.get(`${BASE}/installations?sort=capacity_kw&order=desc&limit=500`);
  const a = asc.body.items.map((i) => i.capacity_kw);
  const d = desc.body.items.map((i) => i.capacity_kw);
  assert.deepEqual(a, [...a].sort((x, y) => x - y));
  assert.deepEqual(d, [...d].sort((x, y) => y - x));
});

test('readings filter by time window: from inclusive, to exclusive', async () => {
  const newest = await newestReadingTime();
  const to = new Date(newest.getTime() - 60 * 60 * 1000);
  const from = new Date(to.getTime() - 60 * 60 * 1000);
  const res = await national
    .get(`${BASE}/installations/ins-0001/readings`)
    .query({ from: from.toISOString(), to: to.toISOString(), order: 'asc' });
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 4, 'one hour of 15-minute readings');
  assert.equal(res.body.items[0].recorded_at, from.toISOString());
  assert.ok(res.body.items.every((r) => Date.parse(r.recorded_at) < to.getTime()));
});

test('readings sort by timestamp ascending and descending', async () => {
  const asc = await national.get(`${BASE}/installations/ins-0001/readings?order=asc&limit=20`);
  const desc = await national.get(`${BASE}/installations/ins-0001/readings?order=desc&limit=20`);
  const a = asc.body.items.map((r) => Date.parse(r.recorded_at));
  const d = desc.body.items.map((r) => Date.parse(r.recorded_at));
  assert.deepEqual(a, [...a].sort((x, y) => x - y));
  assert.deepEqual(d, [...d].sort((x, y) => y - x));
  assert.ok(a[0] < d[0], 'ascending starts with the oldest, descending with the newest');
});

test('the regional /readings view filters by district and time window', async () => {
  const newest = await newestReadingTime();
  const from = new Date(newest.getTime() - 2 * 60 * 60 * 1000);
  const inColombo = await installationsInDistrict('ds-01');
  const { rows } = await db.query(
    `SELECT count(*) FROM generation_reading r JOIN solar_installation i USING (installation_id)
     JOIN grid_substation s USING (substation_id) WHERE s.district_id = 'ds-01' AND r.recorded_at >= $1`,
    [from],
  );
  const res = await national.get(`${BASE}/readings`).query({ 'district-id': 'ds-01', from: from.toISOString(), limit: 500 });
  assert.equal(res.status, 200);
  assert.equal(res.body.count, rows[0].count);
  assert.ok(res.body.items.every((r) => inColombo.has(r.installation_id)));
});

test('pagination stays stable when many rows tie on the sort key', async () => {
  // Overnight every site reads 0 kW, so sorting by power_kw is all ties.
  const { rows } = await db.query(`
    SELECT r.recorded_at FROM generation_reading r
    WHERE extract(hour FROM r.recorded_at AT TIME ZONE 'Asia/Colombo') = 1 ORDER BY r.recorded_at DESC LIMIT 1`);
  const from = rows[0].recorded_at;
  const to = new Date(from.getTime() + 60 * 60 * 1000);
  let url = `${BASE}/readings?sort=power_kw&order=asc&limit=7&from=${from.toISOString()}&to=${to.toISOString()}`;
  const seen = new Set();
  let count;
  while (url) {
    const page = await national.get(url.replace(/^https?:\/\/[^/]+/, ''));
    count = page.body.count;
    for (const r of page.body.items) {
      assert.equal(r.power_kw, 0);
      assert.ok(!seen.has(r.reading_id), `reading ${r.reading_id} appeared on two pages`);
      seen.add(r.reading_id);
    }
    url = page.body.next;
  }
  assert.ok(count > 20);
  assert.equal(seen.size, count, 'every reading appears exactly once across pages');
});

test('invalid filters are rejected with 400', async () => {
  const cases = [
    '/readings?from=2026-10-03T00:00:00Z&to=2026-10-02T00:00:00Z', // empty window
    '/readings?from=yesterday', // not ISO 8601
    '/readings?district-id=colombo', // wrong id format
    '/readings?sort=voltage_v', // not a sortable field
    '/readings?order=up',
    '/installations?status=decommissioned',
    '/installations?limit=10&limit=20', // repeated parameter
  ];
  for (const path of cases) {
    const res = await national.get(`${BASE}${path}`);
    assertErrorBody(res, 400, 40001);
  }
});

test('a jurisdiction filter that matches no installation is an empty page, not an error', async () => {
  const res = await national.get(`${BASE}/readings?district-id=ds-99`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.items, []);
});
