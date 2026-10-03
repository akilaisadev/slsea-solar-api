import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, assertErrorBody, as, userToken } from './helpers.js';

after(() => db.end());

// A national analyst sees every jurisdiction, so these tests exercise the
// resources themselves; jurisdiction limits are tested in auth.test.js.
const national = as(await userToken('national.analyst'));

const BASE = '/solar/v1';

test('GET /provinces returns the paginated collection shape', async () => {
  const res = await national.get(`${BASE}/provinces?limit=3`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.ok(res.headers['last-modified'], 'Last-Modified header expected');
  assert.deepEqual(Object.keys(res.body), ['count', 'offset', 'limit', 'next', 'previous', 'items']);
  assert.equal(res.body.count, 9);
  assert.equal(res.body.items.length, 3);
  assert.deepEqual(Object.keys(res.body.items[0]), ['province_id', 'name']);
  assert.equal(res.body.previous, null);
  assert.match(res.body.next, /\/solar\/v1\/provinces\?limit=3&offset=3$/);
});

test('pagination links walk forwards and backwards through the collection', async () => {
  const middle = await national.get(`${BASE}/districts?offset=10&limit=5`);
  assert.equal(middle.body.count, 25);
  assert.equal(new URL(middle.body.next).searchParams.get('offset'), '15');
  assert.equal(new URL(middle.body.previous).searchParams.get('offset'), '5');

  const last = await national.get(`${BASE}/districts?offset=20&limit=5`);
  assert.equal(last.body.items.length, 5);
  assert.equal(last.body.next, null);
});

test('an offset past the end is an empty page, not an error', async () => {
  const res = await national.get(`${BASE}/provinces?offset=50`);
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 9);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.next, null);
  assert.ok(res.body.previous);
});

test('invalid and unknown query parameters are rejected with 400 and listed', async () => {
  const res = await national.get(`${BASE}/provinces?limit=999&offset=-1&district_id=ds-01`);
  assertErrorBody(res, 400, 40001);
  const fields = res.body.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ['district_id', 'limit', 'offset']);
});

test('atomic hierarchy resources carry their parent foreign key', async () => {
  const district = await national.get(`${BASE}/districts/ds-04`);
  assert.equal(district.status, 200);
  assert.deepEqual(district.body, { district_id: 'ds-04', name: 'Kandy', province_id: 'pv-02' });

  const substation = await national.get(`${BASE}/grid-substations/gss-001`);
  assert.deepEqual(substation.body, { substation_id: 'gss-001', name: 'Kolonnawa Grid Substation', district_id: 'ds-01' });
});

test('an unknown member returns 404, never 200 with an empty body', async () => {
  for (const path of ['/provinces/pv-99', '/districts/ds-99', '/grid-substations/gss-999', '/installations/ins-9999']) {
    const res = await national.get(`${BASE}${path}`);
    assertErrorBody(res, 404, 40401);
  }
});

test('installations never expose the device secret hash, and dates stay calendar dates', async () => {
  const { rows } = await db.query(`SELECT count(*) FROM solar_installation WHERE status <> 'decommissioned'`);
  const res = await national.get(`${BASE}/installations?limit=500`);
  assert.equal(res.body.count, rows[0].count);
  for (const item of res.body.items) {
    assert.equal(item.device_secret_hash, undefined);
    assert.match(item.commissioned_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof item.capacity_kw, 'number');
  }
});

test('collections are read-only here: POST gets 405 with Allow', async () => {
  const res = await national.post(`${BASE}/provinces`).send({ name: 'New' });
  assertErrorBody(res, 405, 40501);
  assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
});
