import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';
import { deriveDeviceSecret } from '../scripts/lib/device-secrets.js';

export const db = createPool(process.env.DATABASE_URL);
export const app = createApp({ db });

// Every error response must carry the single WSO2 §11 error body.
export function assertErrorBody(res, status, code) {
  assert.equal(res.status, status);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.body.code, code);
  assert.equal(typeof res.body.message, 'string');
  assert.equal(typeof res.body.description, 'string');
  assert.match(res.body.more_info, new RegExp(`/errors/${code}$`));
  assert.ok(Array.isArray(res.body.errors));
}

// Tokens come from the real token endpoint, exactly as a client gets them.
export async function userToken(username) {
  const res = await request(app).post('/oauth2/token').type('form')
    .send({ grant_type: 'password', username, password: process.env.DEMO_PASSWORD });
  assert.equal(res.status, 200, `token for ${username}: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

export function deviceSecret(installationId) {
  return deriveDeviceSecret(process.env.DEVICE_SECRET_SEED, installationId);
}

export async function deviceToken(installationId) {
  const res = await request(app).post('/oauth2/token').type('form')
    .send({ grant_type: 'client_credentials', client_id: installationId, client_secret: deviceSecret(installationId) });
  assert.equal(res.status, 200, `token for ${installationId}: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

// A request builder that sends the given bearer token on every call.
export function as(token) {
  const withToken = (method) => (url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
  return {
    get: withToken('get'),
    head: withToken('head'),
    post: withToken('post'),
    put: withToken('put'),
    patch: withToken('patch'),
    delete: withToken('delete'),
    options: withToken('options'),
  };
}
