import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './helpers.js';
import { NATIONAL, assertInScope } from '../src/lib/jurisdiction.js';
import { listProvinces, listDistricts, listGridSubstations } from '../src/repositories/hierarchy.js';
import { listInstallations } from '../src/repositories/installations.js';

after(() => db.end());

// Scopes as they will be carried in access tokens (district users also
// carry the province that contains their district).
const WESTERN = { level: 'province', province_id: 'pv-01' };
const COLOMBO = { level: 'district', district_id: 'ds-01', province_id: 'pv-01' };
const page = { offset: 0, limit: 500 };

test('national scope sees every province', async () => {
  const result = await listProvinces(db, { scope: NATIONAL, ...page });
  assert.equal(result.count, 9);
});

test('a province user sees only their province and its districts', async () => {
  const provinces = await listProvinces(db, { scope: WESTERN, ...page });
  assert.deepEqual(provinces.rows.map((r) => r.province_id), ['pv-01']);
  const districts = await listDistricts(db, { scope: WESTERN, ...page });
  assert.deepEqual(districts.rows.map((r) => r.district_id), ['ds-01', 'ds-02', 'ds-03']);
});

test('a district user sees only their district, its substations and installations', async () => {
  const districts = await listDistricts(db, { scope: COLOMBO, ...page });
  assert.deepEqual(districts.rows.map((r) => r.district_id), ['ds-01']);
  const substations = await listGridSubstations(db, { scope: COLOMBO, ...page });
  assert.ok(substations.rows.every((r) => r.district_id === 'ds-01'));
  const installations = await listInstallations(db, { scope: COLOMBO, ...page });
  const allowed = new Set(substations.rows.map((r) => r.substation_id));
  assert.ok(installations.count > 0);
  assert.ok(installations.rows.every((r) => allowed.has(r.substation_id)));
});

test('a district user may see the province that contains their district', async () => {
  const provinces = await listProvinces(db, { scope: COLOMBO, ...page });
  assert.deepEqual(provinces.rows.map((r) => r.province_id), ['pv-01']);
  assert.doesNotThrow(() => assertInScope(COLOMBO, { province_id: 'pv-01' }, 'Province'));
});

test('members outside the caller jurisdiction are refused with 40302', () => {
  assert.throws(() => assertInScope(COLOMBO, { province_id: 'pv-02', district_id: 'ds-04' }, 'District'), { code: 40302 });
  assert.throws(() => assertInScope(COLOMBO, { province_id: 'pv-01', district_id: 'ds-02' }, 'District'), { code: 40302 });
  assert.throws(() => assertInScope(WESTERN, { province_id: 'pv-02' }, 'Province'), { code: 40302 });
  assert.doesNotThrow(() => assertInScope(WESTERN, { province_id: 'pv-01', district_id: 'ds-03' }, 'District'));
});
