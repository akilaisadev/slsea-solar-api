import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, db } from './helpers.js';
import { isNotModified, preconditionFails } from '../src/lib/conditional.js';

after(() => db.end());

const BASE = '/solar/v1';
const COMPOSITE = `${BASE}/installations/ins-0001`;

test('every GET representation carries validators and cache directives', async () => {
  for (const path of [`${BASE}/provinces`, COMPOSITE, `${COMPOSITE}/readings`, `${COMPOSITE}/last-reading`]) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.etag, /^"[A-Za-z0-9_-]+"$/, `strong ETag on ${path}`);
    assert.ok(res.headers['last-modified'], `Last-Modified on ${path}`);
    assert.equal(res.headers['cache-control'], 'private, no-cache');
    assert.match(res.headers.vary, /Authorization/);
  }
});

test('If-None-Match with the current ETag returns 304 with an empty body', async () => {
  const first = await request(app).get(COMPOSITE);
  const replay = await request(app).get(COMPOSITE).set('If-None-Match', first.headers.etag);
  assert.equal(replay.status, 304);
  assert.equal(replay.text, '');
  assert.equal(replay.headers.etag, first.headers.etag);
});

test('If-None-Match accepts a list, weak tags and *', async () => {
  const { headers } = await request(app).get(COMPOSITE);
  for (const value of [`"other", ${headers.etag}`, `W/${headers.etag}`, '*']) {
    const res = await request(app).get(COMPOSITE).set('If-None-Match', value);
    assert.equal(res.status, 304, value);
  }
});

test('a stale ETag gets the full 200 representation', async () => {
  const res = await request(app).get(COMPOSITE).set('If-None-Match', '"not-the-current-tag"');
  assert.equal(res.status, 200);
  assert.equal(res.body.installation_id, 'ins-0001');
});

test('If-Modified-Since returns 304 when nothing changed since that time', async () => {
  const first = await request(app).get(COMPOSITE);
  const same = await request(app).get(COMPOSITE).set('If-Modified-Since', first.headers['last-modified']);
  assert.equal(same.status, 304);
  const earlier = new Date(Date.parse(first.headers['last-modified']) - 1000).toUTCString();
  const changed = await request(app).get(COMPOSITE).set('If-Modified-Since', earlier);
  assert.equal(changed.status, 200);
});

test('If-None-Match takes precedence over If-Modified-Since', async () => {
  const first = await request(app).get(COMPOSITE);
  const res = await request(app).get(COMPOSITE)
    .set('If-None-Match', '"stale"')
    .set('If-Modified-Since', first.headers['last-modified']);
  assert.equal(res.status, 200);
});

test('collections support conditional GET too', async () => {
  // Collection bodies contain absolute next/previous links built from the
  // Host header, and supertest uses a new port per request, so pin the host.
  const path = `${BASE}/readings?district-id=ds-01&limit=10`;
  const first = await request(app).get(path).set('Host', 'api.test');
  const replay = await request(app).get(path).set('Host', 'api.test').set('If-None-Match', first.headers.etag);
  assert.equal(replay.status, 304);
  const otherPage = await request(app).get(`${path}&offset=10`).set('Host', 'api.test');
  assert.notEqual(otherPage.headers.etag, first.headers.etag, 'a different page is a different representation');
});

test('a new reading changes the validators, so the old ETag no longer matches', async () => {
  // ins-0007 reports normally; append the next 15-minute reading directly.
  const path = `${BASE}/installations/ins-0007`;
  const before = await request(app).get(path);
  await db.query(`
    INSERT INTO generation_reading (installation_id, recorded_at, power_kw, energy_kwh, voltage_v, received_at)
    SELECT installation_id, recorded_at + interval '15 minutes', power_kw, energy_kwh + 0.1, voltage_v,
           received_at + interval '15 minutes'
    FROM generation_reading WHERE installation_id = 'ins-0007' ORDER BY recorded_at DESC LIMIT 1`);
  const after = await request(app).get(path).set('If-None-Match', before.headers.etag);
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.etag, before.headers.etag);
  assert.ok(Date.parse(after.headers['last-modified']) > Date.parse(before.headers['last-modified']));
});

test('preconditionFails implements If-Match (strong) and If-Unmodified-Since', () => {
  const etag = '"abc"';
  const lastModified = new Date('2026-10-01T10:00:00Z');
  const req = (headers) => ({ get: (name) => headers[name] });
  assert.equal(preconditionFails(req({}), etag, lastModified), false, 'no precondition sent');
  assert.equal(preconditionFails(req({ 'If-Match': '"abc"' }), etag, lastModified), false);
  assert.equal(preconditionFails(req({ 'If-Match': '"old"' }), etag, lastModified), true);
  assert.equal(preconditionFails(req({ 'If-Match': 'W/"abc"' }), etag, lastModified), true, 'weak tags never match If-Match');
  assert.equal(preconditionFails(req({ 'If-Unmodified-Since': 'Thu, 01 Oct 2026 09:00:00 GMT' }), etag, lastModified), true);
  assert.equal(preconditionFails(req({ 'If-Unmodified-Since': 'Thu, 01 Oct 2026 10:00:00 GMT' }), etag, lastModified), false);
  assert.equal(isNotModified(req({ 'If-Modified-Since': 'not a date' }), etag, lastModified), false, 'invalid dates are ignored');
});
