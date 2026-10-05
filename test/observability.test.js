import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { app, db, userToken } from './helpers.js';

after(() => db.end());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Captures what a console method prints while fn runs.
async function capture(method, fn) {
  const original = console[method];
  const lines = [];
  console[method] = (...args) => lines.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console[method] = original;
  }
  return lines;
}

test('every response carries a generated X-Request-Id, errors included', async () => {
  const ok = await request(app).get('/health');
  const missing = await request(app).get('/no-such-resource');
  assert.match(ok.headers['x-request-id'], UUID);
  assert.match(missing.headers['x-request-id'], UUID);
  assert.notEqual(ok.headers['x-request-id'], missing.headers['x-request-id']);
});

test('a well-formed client request id is kept; anything else is replaced', async () => {
  const kept = await request(app).get('/health').set('X-Request-Id', 'gateway-42.abc_DEF');
  assert.equal(kept.headers['x-request-id'], 'gateway-42.abc_DEF');
  for (const unsafe of ['has spaces in it', 'x'.repeat(65), '<script>']) {
    const res = await request(app).get('/health').set('X-Request-Id', unsafe);
    assert.match(res.headers['x-request-id'], UUID, `"${unsafe.slice(0, 20)}" must be replaced`);
  }
});

test('the access log writes one JSON line per request, without query strings or tokens', async () => {
  const token = await userToken('national.analyst');
  const logged = createApp({ db, logRequests: true });
  const lines = await capture('log', () => request(logged)
    .get('/solar/v1/provinces?limit=1&offset=2')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Request-Id', 'trace-me-1'));
  const entry = JSON.parse(lines.find((line) => line.includes('trace-me-1')));
  assert.equal(entry.method, 'GET');
  assert.equal(entry.path, '/solar/v1/provinces');
  assert.equal(entry.status, 200);
  assert.equal(entry.client, 'analyst:usr-01');
  assert.equal(typeof entry.duration_ms, 'number');
  assert.ok(!lines.join('\n').includes(token), 'the bearer token must never be logged');
});

test('a server error is logged under the request id the client received', async () => {
  const failing = () => Promise.reject(new Error('boom'));
  const broken = createApp({ db: { query: failing, connect: failing }, logRequests: false });
  let res;
  const errors = await capture('error', async () => {
    res = await request(broken).post('/oauth2/token').set('X-Request-Id', 'incident-7')
      .send({ grant_type: 'client_credentials', client_id: 'ins-0001', client_secret: 'x' });
  });
  assert.equal(res.status, 500);
  assert.equal(res.headers['x-request-id'], 'incident-7');
  assert.ok(errors.some((line) => line.startsWith('[incident-7]')));
});
