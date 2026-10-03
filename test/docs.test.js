import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, db } from './helpers.js';

after(() => db.end());

test('the OpenAPI document is served as JSON', async () => {
  const res = await request(app).get('/openapi.json');
  assert.equal(res.status, 200);
  assert.equal(res.body.openapi, '3.1.0');
  assert.equal(res.body.servers[0].url, '/solar/v1');
});

test('Swagger UI is served as HTML to browsers', async () => {
  const res = await request(app).get('/docs/').set('Accept', 'text/html');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
});

test('the API index links to the documentation', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.body.documentation, /\/docs$/);
  assert.match(res.body.base_path, /\/solar\/v1$/);
});
