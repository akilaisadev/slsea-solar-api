import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { issueUserToken, SCOPES } from '../src/lib/tokens.js';
import { assertErrorBody } from './helpers.js';

// A stand-in for a database that cannot be reached, so the 503 path is
// tested without stopping PostgreSQL.
const refusing = () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }));
const unreachableDb = { query: refusing, connect: refusing };
const app = createApp({ db: unreachableDb });

const token = issueUserToken(
  { user_id: 'usr-01', username: 'national.analyst', role: 'analyst', jurisdiction_level: 'national' },
  SCOPES.analyst,
).access_token;

test('an unreachable database gives 503 with Retry-After, not a 500', async () => {
  const res = await request(app).get('/solar/v1/provinces').set('Authorization', `Bearer ${token}`);
  assertErrorBody(res, 503, 50301);
  assert.equal(res.headers['retry-after'], '30');
});

test('the token endpoint also reports 503 when the database is down', async () => {
  const res = await request(app).post('/oauth2/token').send({ grant_type: 'client_credentials', client_id: 'ins-0001', client_secret: 'x' });
  assertErrorBody(res, 503, 50301);
});

test('liveness stays up while readiness reports the database as unavailable', async () => {
  assert.equal((await request(app).get('/health')).status, 200);
  const ready = await request(app).get('/health/database');
  assert.equal(ready.status, 503);
  assert.equal(ready.body.database, 'unavailable');
});

test('the pool handles idle-connection errors instead of crashing the process', async () => {
  const pool = createPool('postgres://localhost:5432/slsea_test');
  assert.equal(pool.listenerCount('error'), 1);
  // With a listener this is handled; without one, emit() would throw.
  assert.doesNotThrow(() => pool.emit('error', new Error('terminating connection due to administrator command')));
  await pool.end();
});
