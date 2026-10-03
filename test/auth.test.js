import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, db, assertErrorBody, as, userToken, deviceToken, deviceSecret } from './helpers.js';

after(() => db.end());

const BASE = '/solar/v1';
const tokenRequest = () => request(app).post('/oauth2/token');

// Fixtures from the small seed, looked up rather than hard-coded.
const { rows: [kandy] } = await db.query(`
  SELECT s.substation_id, i.installation_id FROM grid_substation s
  JOIN solar_installation i USING (substation_id)
  WHERE s.district_id = 'ds-04' ORDER BY i.installation_id LIMIT 1`);
const { rows: [colomboSite] } = await db.query(`
  SELECT i.installation_id FROM solar_installation i JOIN grid_substation s USING (substation_id)
  WHERE s.district_id = 'ds-01' ORDER BY i.installation_id LIMIT 1`);
const { rows: [kandyReading] } = await db.query(
  'SELECT reading_id FROM generation_reading WHERE installation_id = $1 LIMIT 1', [kandy.installation_id]);

const national = as(await userToken('national.analyst'));
const western = as(await userToken('western.analyst'));
const colombo = as(await userToken('colombo.analyst'));

async function districtOfInstallations(ids) {
  const { rows } = await db.query(`
    SELECT DISTINCT s.district_id FROM solar_installation i JOIN grid_substation s USING (substation_id)
    WHERE i.installation_id = ANY($1)`, [ids]);
  return rows.map((r) => r.district_id).sort();
}

// ---------------------------------------------------------------- tokens

test('password grant issues a JWT bearer token with the user scopes', async () => {
  const res = await tokenRequest().type('form')
    .send({ grant_type: 'password', username: 'colombo.analyst', password: process.env.DEMO_PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.token_type, 'Bearer');
  assert.equal(res.body.expires_in, 3600);
  assert.equal(res.body.scope, 'assets:read readings:read');
  assert.equal(res.headers['cache-control'], 'no-store');
  const claims = jwt.decode(res.body.access_token);
  assert.deepEqual(claims.jurisdiction, { level: 'district', province_id: 'pv-01', district_id: 'ds-01' });
});

test('client credentials grant works with body or HTTP Basic client authentication', async () => {
  const id = colomboSite.installation_id;
  const viaBody = await tokenRequest().send({ grant_type: 'client_credentials', client_id: id, client_secret: deviceSecret(id) });
  assert.equal(viaBody.status, 200);
  assert.equal(viaBody.body.scope, 'readings:write');
  assert.equal(jwt.decode(viaBody.body.access_token).sub, id);

  const viaBasic = await tokenRequest().auth(id, deviceSecret(id)).type('form').send({ grant_type: 'client_credentials' });
  assert.equal(viaBasic.status, 200);
});

test('the password grant works the way Swagger UI sends it (empty Basic client)', async () => {
  const res = await tokenRequest().set('Authorization', 'Basic Og==').type('form')
    .send({ grant_type: 'password', username: 'western.analyst', password: process.env.DEMO_PASSWORD, scope: 'assets:read' });
  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'assets:read');
});

test('an asset administrator also receives installations:write', async () => {
  const res = await tokenRequest().send({ grant_type: 'password', username: 'asset.admin', password: process.env.DEMO_PASSWORD });
  assert.equal(res.body.scope, 'assets:read readings:read installations:write');
});

test('wrong, unknown or decommissioned credentials get 401 with a challenge', async () => {
  const attempts = [
    { grant_type: 'password', username: 'colombo.analyst', password: 'wrong' },
    { grant_type: 'password', username: 'no.such.user', password: 'whatever' },
    { grant_type: 'client_credentials', client_id: colomboSite.installation_id, client_secret: 'wrong' },
    { grant_type: 'client_credentials', client_id: 'ins-9999', client_secret: 'anything' },
  ];
  for (const body of attempts) {
    const res = await tokenRequest().send(body);
    assertErrorBody(res, 401, 40103);
    assert.match(res.headers['www-authenticate'], /^Basic realm=/);
  }
});

test('malformed token requests get 400, 405 or 415', async () => {
  assertErrorBody(await tokenRequest().send({ grant_type: 'authorization_code' }), 400, 40004);
  assertErrorBody(await tokenRequest().send({ grant_type: 'password', username: 'x' }), 400, 40002);
  assertErrorBody(await tokenRequest().send({ grant_type: 'password', username: 'colombo.analyst',
    password: process.env.DEMO_PASSWORD, scope: 'readings:write' }), 400, 40005);
  assertErrorBody(await tokenRequest().set('Content-Type', 'text/plain').send('grant_type=password'), 415, 41501);
  const get = await request(app).get('/oauth2/token');
  assertErrorBody(get, 405, 40501);
  assert.equal(get.headers.allow, 'POST, OPTIONS');
});

test('requested scopes beyond the client\'s rights are dropped, and the response says so', async () => {
  // Swagger UI's "select all" asks an analyst for installations:write too.
  const res = await tokenRequest().send({ grant_type: 'password', username: 'national.analyst',
    password: process.env.DEMO_PASSWORD, scope: 'assets:read readings:read installations:write' });
  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'assets:read readings:read');
});

test('a narrower requested scope is honoured and enforced', async () => {
  const res = await tokenRequest().send({ grant_type: 'password', username: 'national.analyst',
    password: process.env.DEMO_PASSWORD, scope: 'assets:read' });
  assert.equal(res.body.scope, 'assets:read');
  const client = as(res.body.access_token);
  assert.equal((await client.get(`${BASE}/provinces`)).status, 200);
  assertErrorBody(await client.get(`${BASE}/readings`), 403, 40301);
});

test('repeated failures for one credential are rate limited without locking out others', async () => {
  const bad = { grant_type: 'password', username: 'kandy.analyst', password: 'wrong' };
  let res;
  for (let i = 0; i < 11; i++) res = await tokenRequest().send(bad);
  assertErrorBody(res, 429, 42901);
  const other = await tokenRequest().send({ grant_type: 'password', username: 'western.analyst', password: process.env.DEMO_PASSWORD });
  assert.equal(other.status, 200, 'a different credential is unaffected');
});

// -------------------------------------------------------- bearer tokens

test('no bearer token: 401 with a Bearer challenge', async () => {
  const res = await request(app).get(`${BASE}/provinces`);
  assertErrorBody(res, 401, 40101);
  assert.equal(res.headers['www-authenticate'], 'Bearer realm="slsea"');
});

test('forged, expired, unsigned and foreign tokens are rejected with invalid_token', async () => {
  const claims = { sub: 'usr-01', role: 'analyst', scope: 'assets:read readings:read', jurisdiction: { level: 'national' } };
  const options = { algorithm: 'HS256', issuer: 'slsea-solar-api', audience: 'slsea-solar-api' };
  const header = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const forged = [
    jwt.sign(claims, 'not-the-server-secret-but-long-enough-0123456789', options), // wrong key
    jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, options), // expired
    jwt.sign(claims, process.env.JWT_SECRET, { ...options, audience: 'some-other-api' }), // wrong audience
    `${header({ alg: 'none', typ: 'JWT' })}.${header({ ...claims, iss: 'slsea-solar-api', aud: 'slsea-solar-api' })}.`, // alg none
    'not.a.jwt',
  ];
  for (const token of forged) {
    const res = await as(token).get(`${BASE}/provinces`);
    assertErrorBody(res, 401, 40102);
    assert.match(res.headers['www-authenticate'], /error="invalid_token"/);
  }
});

// ------------------------------------------------------ write-read split

test('a device token cannot read anything (403 insufficient_scope)', async () => {
  const device = as(await deviceToken(colomboSite.installation_id));
  for (const path of ['/provinces', '/installations', `/installations/${colomboSite.installation_id}`,
    `/installations/${colomboSite.installation_id}/readings`, '/readings']) {
    const res = await device.get(`${BASE}${path}`);
    assertErrorBody(res, 403, 40301);
    assert.match(res.headers['www-authenticate'], /error="insufficient_scope"/);
  }
});

// ------------------------------------------------- jurisdiction scoping

test('a district user sees only their own district in every collection', async () => {
  const provinces = await colombo.get(`${BASE}/provinces`);
  assert.deepEqual(provinces.body.items.map((p) => p.province_id), ['pv-01']);
  const districts = await colombo.get(`${BASE}/districts`);
  assert.deepEqual(districts.body.items.map((d) => d.district_id), ['ds-01']);
  const substations = await colombo.get(`${BASE}/grid-substations?limit=500`);
  assert.ok(substations.body.items.every((s) => s.district_id === 'ds-01'));
  const installations = await colombo.get(`${BASE}/installations?limit=500`);
  assert.deepEqual(await districtOfInstallations(installations.body.items.map((i) => i.installation_id)), ['ds-01']);
  const readings = await colombo.get(`${BASE}/readings?limit=500`);
  assert.ok(readings.body.count > 0);
  assert.deepEqual(await districtOfInstallations(readings.body.items.map((r) => r.installation_id)), ['ds-01']);
});

test('a district user is refused (403) every member outside their district', async () => {
  const outside = [
    '/provinces/pv-02',
    '/districts/ds-04',
    `/grid-substations/${kandy.substation_id}`,
    `/installations/${kandy.installation_id}`,
    `/installations/${kandy.installation_id}/last-reading`,
    `/installations/${kandy.installation_id}/readings`,
    `/installations/${kandy.installation_id}/readings/${kandyReading.reading_id}`,
  ];
  for (const path of outside) {
    assertErrorBody(await colombo.get(`${BASE}${path}`), 403, 40302);
  }
  assert.equal((await colombo.get(`${BASE}/provinces/pv-01`)).status, 200, 'own province is visible');
  assert.equal((await colombo.get(`${BASE}/installations/${colomboSite.installation_id}`)).status, 200);
});

test('explicit filters naming another jurisdiction are refused (403), not silently emptied', async () => {
  for (const path of ['/installations?district-id=ds-04', '/readings?province-id=pv-02',
    `/readings?substation-id=${kandy.substation_id}`, '/grid-substations?district-id=ds-04']) {
    assertErrorBody(await colombo.get(`${BASE}${path}`), 403, 40302);
  }
  assertErrorBody(await western.get(`${BASE}/installations?district-id=ds-04`), 403, 40302);
});

test('a province user sees every district of their province and nothing else', async () => {
  const districts = await western.get(`${BASE}/districts`);
  assert.deepEqual(districts.body.items.map((d) => d.district_id), ['ds-01', 'ds-02', 'ds-03']);
  assert.equal((await western.get(`${BASE}/districts/ds-02`)).status, 200);
  assertErrorBody(await western.get(`${BASE}/districts/ds-04`), 403, 40302);
  const readings = await western.get(`${BASE}/readings?limit=500`);
  const seen = await districtOfInstallations(readings.body.items.map((r) => r.installation_id));
  assert.ok(seen.every((d) => ['ds-01', 'ds-02', 'ds-03'].includes(d)));
});

test('a national user can read across every jurisdiction', async () => {
  assert.equal((await national.get(`${BASE}/provinces`)).body.count, 9);
  assert.equal((await national.get(`${BASE}/installations/${kandy.installation_id}`)).status, 200);
  assert.equal((await national.get(`${BASE}/readings?district-id=ds-04`)).status, 200);
});
