import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, db, assertErrorBody, as, userToken, deviceToken } from './helpers.js';

after(() => db.end());

const BASE = '/solar/v1';
const SITE = 'ins-0013'; // reports normally in the small seed
const pathOf = (url) => new URL(url).pathname;

const admin = as(await userToken('asset.admin'));
const analyst = as(await userToken('national.analyst'));
const device = as(await deviceToken(SITE));

// A reading one minute after the site's latest, with a slightly higher
// cumulative counter. (The seed ends at the current 15-minute slot, so the
// *next* slot can still be up to 15 minutes in the future, which the API
// rightly rejects; one minute later is always in the past or within skew.)
async function nextReading(installationId = SITE) {
  const { rows: [last] } = await db.query(
    'SELECT recorded_at, energy_kwh FROM generation_reading WHERE installation_id = $1 ORDER BY recorded_at DESC LIMIT 1',
    [installationId]);
  return {
    recorded_at: new Date(last.recorded_at.getTime() + 60 * 1000).toISOString(),
    power_kw: 1.5,
    energy_kwh: last.energy_kwh + 0.375,
    voltage_v: 231.4,
  };
}

const newSite = (overrides = {}) => ({
  inverter_id: `INV-T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
  status: 'active',
  substation_id: 'gss-001',
  capacity_kw: 6,
  latitude: 6.91,
  longitude: 79.88,
  commissioned_on: '2026-09-15',
  ...overrides,
});

// ------------------------------------------------------ device ingestion

test('a device POSTs a reading: 201, Location, ETag and Last-Modified', async () => {
  const body = await nextReading();
  const res = await device.post(`${BASE}/installations/${SITE}/readings`).send(body);
  assert.equal(res.status, 201);
  assert.match(res.headers.location, new RegExp(`^https?://[^/]+${BASE}/installations/${SITE}/readings/\\d+$`));
  assert.ok(res.headers.etag);
  assert.ok(res.headers['last-modified']);
  assert.equal(res.body.recorded_at, body.recorded_at);
  assert.equal(res.body.installation_id, SITE, 'installation comes from the path');
  assert.ok(Math.abs(Date.parse(res.body.received_at) - Date.now()) < 10_000, 'received_at is the server clock');

  // The Location header resolves to the reading that was created...
  const located = await analyst.get(pathOf(res.headers.location));
  assert.equal(located.status, 200);
  assert.deepEqual(located.body, res.body);
  // ...and the operational view now reports it as the latest reading.
  const last = await analyst.get(`${BASE}/installations/${SITE}/last-reading`);
  assert.equal(last.body.reading_id, res.body.reading_id);
});

test('re-sending the same reading is refused with 409 and points to the original', async () => {
  const body = await nextReading();
  const first = await device.post(`${BASE}/installations/${SITE}/readings`).send(body);
  assert.equal(first.status, 201);
  const retry = await device.post(`${BASE}/installations/${SITE}/readings`).send(body);
  assertErrorBody(retry, 409, 40901);
  // Compare paths: supertest serves each request on a new port.
  assert.ok(retry.body.message.includes(pathOf(first.headers.location)));
});

test('only the device bound to the installation may write its readings', async () => {
  const body = await nextReading();
  assertErrorBody(await device.post(`${BASE}/installations/ins-0001/readings`).send(body), 403, 40303);
  assertErrorBody(await analyst.post(`${BASE}/installations/${SITE}/readings`).send(body), 403, 40301);
  assertErrorBody(await request(app).post(`${BASE}/installations/${SITE}/readings`).send(body), 401, 40101);
});

test('invalid readings are rejected with 400 naming each field', async () => {
  const good = await nextReading();
  const missing = await device.post(`${BASE}/installations/${SITE}/readings`).send({ power_kw: 1 });
  assertErrorBody(missing, 400, 40002);
  assert.deepEqual(missing.body.errors.map((e) => e.field).sort(), ['energy_kwh', 'recorded_at', 'voltage_v']);

  const cases = [
    [{ ...good, power_kw: '1.5' }, 'power_kw'], // a string, not a number
    [{ ...good, installation_id: 'ins-0001' }, 'installation_id'], // id is taken from the path only
    [{ ...good, recorded_at: new Date(Date.now() + 3_600_000).toISOString() }, 'recorded_at'], // future
    [{ ...good, power_kw: 9999 }, 'power_kw'], // beyond the site's capacity
    [{ ...good, energy_kwh: 1 }, 'energy_kwh'], // cumulative counter going backwards
  ];
  for (const [body, field] of cases) {
    const res = await device.post(`${BASE}/installations/${SITE}/readings`).send(body);
    assertErrorBody(res, 400, 40002);
    assert.equal(res.body.errors[0].field, field);
  }
});

test('request bodies must be JSON: 415 for other media types, 400 for broken JSON', async () => {
  const wrongType = await device.post(`${BASE}/installations/${SITE}/readings`).set('Content-Type', 'text/plain').send('power=1');
  assertErrorBody(wrongType, 415, 41501);
  const broken = await device.post(`${BASE}/installations/${SITE}/readings`).set('Content-Type', 'application/json').send('{"power_kw": ');
  assertErrorBody(broken, 400, 40003);
});

test('readings are append-only over HTTP: PUT, PATCH and DELETE get 405', async () => {
  const { rows: [r] } = await db.query('SELECT reading_id FROM generation_reading WHERE installation_id = $1 LIMIT 1', [SITE]);
  for (const method of ['put', 'patch', 'delete']) {
    const res = await admin[method](`${BASE}/installations/${SITE}/readings/${r.reading_id}`).send({});
    assertErrorBody(res, 405, 40501);
    assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
  }
});

// ------------------------------------------------ installation lifecycle

test('POST /installations creates a site: 201, Location, a one-time device secret', async () => {
  const res = await admin.post(`${BASE}/installations`).send(newSite());
  assert.equal(res.status, 201);
  assert.match(res.body.installation_id, /^ins-0\d{3}$/);
  assert.ok(Number(res.body.installation_id.slice(4)) > 240, 'continues after the seeded ids');
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.last_reading, null);
  assert.equal(typeof res.body.device_secret, 'string');

  // The Location resolves; GET returns the same resource without the secret,
  // and the ETag sent with 201 is the ETag of that GET representation.
  const located = await admin.get(pathOf(res.headers.location));
  assert.equal(located.status, 200);
  assert.equal(located.body.device_secret, undefined);
  assert.equal(located.headers.etag, res.headers.etag);

  // The new device can authenticate with the secret it was given.
  const token = await request(app).post('/oauth2/token')
    .send({ grant_type: 'client_credentials', client_id: res.body.installation_id, client_secret: res.body.device_secret });
  assert.equal(token.status, 200);
});

test('POST /installations validates input and refuses duplicates', async () => {
  const site = newSite();
  assert.equal((await admin.post(`${BASE}/installations`).send(site)).status, 201);
  assertErrorBody(await admin.post(`${BASE}/installations`).send(site), 409, 40902);

  const unknownSubstation = await admin.post(`${BASE}/installations`).send(newSite({ substation_id: 'gss-999' }));
  assertErrorBody(unknownSubstation, 400, 40002);
  assert.equal(unknownSubstation.body.errors[0].field, 'substation_id');

  for (const bad of [
    { ...newSite(), installation_id: 'ins-9000' }, // server-assigned
    newSite({ commissioned_on: '2999-01-01' }),
    newSite({ capacity_kw: -5 }),
    { inverter_id: 'INV-ONLY-THIS' },
  ]) {
    assertErrorBody(await admin.post(`${BASE}/installations`).send(bad), 400, 40002);
  }
});

test('only asset administrators may manage installations', async () => {
  assertErrorBody(await analyst.post(`${BASE}/installations`).send(newSite()), 403, 40301);
  assertErrorBody(await analyst.delete(`${BASE}/installations/${SITE}`), 403, 40301);
});

test('PUT replaces the whole resource, is idempotent, and requires every field', async () => {
  const created = await admin.post(`${BASE}/installations`).send(newSite());
  const uri = pathOf(created.headers.location);
  const replacement = newSite({ capacity_kw: 9.5, status: 'maintenance', substation_id: 'gss-002' });

  const first = await admin.put(uri).send(replacement);
  assert.equal(first.status, 200);
  assert.equal(first.body.capacity_kw, 9.5);
  assert.equal(first.body.status, 'maintenance');
  assert.equal(first.body.location.grid_substation.substation_id, 'gss-002');
  const second = await admin.put(uri).send(replacement);
  assert.equal(second.headers.etag, first.headers.etag, 'same request, same resulting state');

  const { status, ...partial } = replacement;
  const incomplete = await admin.put(uri).send(partial);
  assertErrorBody(incomplete, 400, 40002);
  assert.equal(incomplete.body.errors[0].field, 'status');
});

test('PATCH applies a merge patch and leaves other fields untouched', async () => {
  const created = await admin.post(`${BASE}/installations`).send(newSite({ capacity_kw: 4 }));
  const uri = pathOf(created.headers.location);
  const res = await admin.patch(uri).set('Content-Type', 'application/merge-patch+json').send(JSON.stringify({ status: 'maintenance' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'maintenance');
  assert.equal(res.body.capacity_kw, 4);
  assert.equal(res.body.inverter_id, created.body.inverter_id);

  assertErrorBody(await admin.patch(uri).send({}), 400, 40002);
  assertErrorBody(await admin.patch(uri).send({ status: 'decommissioned' }), 400, 40002);
  assertErrorBody(await admin.patch(uri).set('Content-Type', 'text/plain').send('status=active'), 415, 41501);
});

test('If-Match: a stale ETag gets 412 and changes nothing; the current one succeeds', async () => {
  const created = await admin.post(`${BASE}/installations`).send(newSite({ capacity_kw: 3 }));
  const uri = pathOf(created.headers.location);
  const original = created.headers.etag;

  const updated = await admin.patch(uri).set('If-Match', original).send({ capacity_kw: 3.5 });
  assert.equal(updated.status, 204);
  assert.equal(updated.text, '');
  assert.equal(updated.headers.etag, undefined);
  assert.equal((await admin.get(uri)).body.capacity_kw, 3.5);

  // A second client still holding the original ETag tries to edit.
  const stale = await admin.patch(uri).set('If-Match', original).send({ capacity_kw: 99 });
  assertErrorBody(stale, 412, 41201);
  assertErrorBody(await admin.put(uri).set('If-Match', original).send(newSite()), 412, 41201);
  assertErrorBody(await admin.delete(uri).set('If-Match', original), 412, 41201);
  assert.equal((await admin.get(uri)).body.capacity_kw, 3.5, 'the stale writes changed nothing');

  const current = await admin.get(uri);
  assert.equal((await admin.patch(uri).set('If-Match', current.headers.etag).send({ capacity_kw: 4 })).status, 204);
  assert.equal((await admin.get(uri)).body.capacity_kw, 4);
});

test('conditional PUT and DELETE return 204 after applying the change; stale dates change nothing', async () => {
  const created = await admin.post(`${BASE}/installations`).send(newSite({ capacity_kw: 3 }));
  const uri = pathOf(created.headers.location);
  const before = await admin.get(uri);
  const replacement = newSite({ inverter_id: created.body.inverter_id, capacity_kw: 4 });
  const put = await admin.put(uri).set('If-Match', before.headers.etag).send(replacement);
  assert.equal(put.status, 204);
  assert.equal(put.text, '');
  assert.equal((await admin.get(uri)).body.capacity_kw, 4);
  assertErrorBody(await admin.patch(uri).set('If-Unmodified-Since', 'Thu, 01 Jan 1970 00:00:00 GMT').send({ capacity_kw: 99 }), 412, 41201);
  const current = await admin.get(uri);
  const patch = await admin.patch(uri).set('If-Unmodified-Since', current.headers['last-modified']).send({ capacity_kw: 5 });
  assert.equal(patch.status, 204);
  assert.equal((await admin.get(uri)).body.capacity_kw, 5);
  const last = await admin.get(uri);
  const deleted = await admin.delete(uri).set('If-Match', last.headers.etag);
  assert.equal(deleted.status, 204);
  assert.equal(deleted.text, '');
  assertErrorBody(await admin.get(uri), 404, 40401);
});

test('DELETE decommissions: 200 once, then 404; readings are kept; the device is locked out', async () => {
  const created = await admin.post(`${BASE}/installations`).send(newSite());
  const id = created.body.installation_id;
  const uri = pathOf(created.headers.location);
  const deviceOfSite = as((await request(app).post('/oauth2/token')
    .send({ grant_type: 'client_credentials', client_id: id, client_secret: created.body.device_secret })).body.access_token);
  const reading = { recorded_at: new Date(Date.now() - 60_000).toISOString(), power_kw: 1, energy_kwh: 10, voltage_v: 230 };
  assert.equal((await deviceOfSite.post(`${uri}/readings`).send(reading)).status, 201);

  const removed = await admin.delete(uri);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.status, 'decommissioned');
  assert.ok(removed.body.decommissioned_at);

  assertErrorBody(await admin.get(uri), 404, 40401);
  assertErrorBody(await admin.delete(uri), 404, 40401);

  const { rows } = await db.query('SELECT count(*) FROM generation_reading WHERE installation_id = $1', [id]);
  assert.equal(rows[0].count, 1, 'history survives decommissioning');
  const token = await request(app).post('/oauth2/token')
    .send({ grant_type: 'client_credentials', client_id: id, client_secret: created.body.device_secret });
  assertErrorBody(token, 401, 40103);
});
