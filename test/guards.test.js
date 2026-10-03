import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config, assertRequiredConfig } from '../src/config.js';
import { scopeOf } from '../src/lib/jurisdiction.js';
import { issueUserToken, SCOPES } from '../src/lib/tokens.js';
import { app, db, assertErrorBody } from './helpers.js';

after(() => db.end());

// Safety nets that ordinary requests rarely reach, tested directly.

test('the server refuses to start without a database URL or a strong JWT secret', () => {
  const saved = { url: config.databaseUrl, secret: config.jwt.secret };
  try {
    config.jwt.secret = 'too-short';
    assert.throws(() => assertRequiredConfig(), /JWT_SECRET/);
    config.databaseUrl = undefined;
    assert.throws(() => assertRequiredConfig(), /DATABASE_URL/);
  } finally {
    config.databaseUrl = saved.url;
    config.jwt.secret = saved.secret;
  }
  assert.doesNotThrow(() => assertRequiredConfig());
});

test('jurisdiction fails closed: no verified user jurisdiction means 403, never national', () => {
  assert.throws(() => scopeOf({}), { code: 40301 });
  assert.throws(() => scopeOf({ auth: { role: 'device', jurisdiction: null } }), { code: 40301 });
});

test('an unexpected failure is a generic 500 that does not leak internal details', async () => {
  const failing = () => Promise.reject(new Error('relation "secret_table" does not exist'));
  const broken = createApp({ db: { query: failing, connect: failing } });
  const token = issueUserToken(
    { user_id: 'usr-01', username: 'national.analyst', role: 'analyst', jurisdiction_level: 'national' },
    SCOPES.analyst,
  ).access_token;
  const res = await request(broken).get('/solar/v1/provinces').set('Authorization', `Bearer ${token}`);
  assertErrorBody(res, 500, 50001);
  assert.doesNotMatch(JSON.stringify(res.body), /secret_table/);
});

test('an unknown error code has no catalogue entry (404)', async () => {
  assertErrorBody(await request(app).get('/errors/99999'), 404, 40401);
});

test('client credentials without a secret are rejected as a bad request', async () => {
  const res = await request(app).post('/oauth2/token').send({ grant_type: 'client_credentials', client_id: 'ins-0001' });
  assertErrorBody(res, 400, 40002);
});
