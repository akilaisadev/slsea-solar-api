import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db/pool.js';

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
