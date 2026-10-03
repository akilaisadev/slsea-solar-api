import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, db, assertErrorBody } from './helpers.js';

after(() => db.end());

test('GET /health is a liveness probe that does not touch the database', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.database, undefined);
});

test('GET /health/database reports the database as reachable', async () => {
  const res = await request(app).get('/health/database');
  assert.equal(res.status, 200);
  assert.equal(res.body.database, 'ok');
  assert.equal(typeof res.body.latency_ms, 'number');
});

test('a non-JSON Accept header is refused with 406', async () => {
  const res = await request(app).get('/health').set('Accept', 'application/xml');
  assertErrorBody(res, 406, 40601);
});

test('an unsupported method gets 405 and an Allow header', async () => {
  const res = await request(app).post('/health');
  assertErrorBody(res, 405, 40501);
  assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
});

test('OPTIONS answers 204 with the Allow header', async () => {
  const res = await request(app).options('/health');
  assert.equal(res.status, 204);
  assert.equal(res.headers.allow, 'GET, HEAD, OPTIONS');
});

test('an unknown URI gets the standard 404 error body', async () => {
  const res = await request(app).get('/no-such-resource');
  assertErrorBody(res, 404, 40402);
});

test('more_info links resolve to an error catalogue entry', async () => {
  const notFound = await request(app).get('/no-such-resource');
  const path = new URL(notFound.body.more_info).pathname;
  const res = await request(app).get(path);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), ['code', 'http_status', 'description', 'resolution']);
  assert.equal(res.body.code, 40402);
});

test('Express fingerprinting header is not sent', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.headers['x-powered-by'], undefined);
});
