import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { lockInstallationReadings } from '../src/repositories/readings.js';
import { db, assertErrorBody, as, deviceToken } from './helpers.js';

after(() => db.end());

const SITE = 'ins-0019'; // reports normally in the small seed
const URL = `/solar/v1/installations/${SITE}/readings`;
const device = as(await deviceToken(SITE));
const MINUTE = 60 * 1000;

async function readingsOf(limit, order = 'DESC') {
  const { rows } = await db.query(
    `SELECT recorded_at, energy_kwh FROM generation_reading WHERE installation_id = $1
     ORDER BY recorded_at ${order === 'ASC' ? 'ASC' : 'DESC'} LIMIT $2`, [SITE, limit]);
  return rows;
}

const body = (at, energy) => ({ recorded_at: new Date(at).toISOString(), power_kw: 0.5, energy_kwh: energy, voltage_v: 230 });

test('a late (back-filled) reading between two existing ones is accepted', async () => {
  // Two consecutive readings from the middle of the history, 15 minutes apart.
  const [earlier, later] = (await readingsOf(2, 'ASC'));
  const midpoint = (earlier.energy_kwh + later.energy_kwh) / 2;
  const res = await device.post(URL).send(body(earlier.recorded_at.getTime() + 7 * MINUTE, midpoint));
  assert.equal(res.status, 201);
});

test('a back-filled reading may not exceed the counter of the reading after it', async () => {
  const [earlier, later] = (await readingsOf(3, 'ASC')).slice(1);
  const res = await device.post(URL).send(body(earlier.recorded_at.getTime() + 8 * MINUTE, later.energy_kwh + 1));
  assertErrorBody(res, 400, 40002);
  assert.equal(res.body.errors[0].field, 'energy_kwh');
  assert.match(res.body.errors[0].message, /cannot exceed the next reading/);
});

test('simultaneous identical uploads: exactly one is stored, the other is a 409', async () => {
  const [latest] = await readingsOf(1);
  const reading = body(latest.recorded_at.getTime() + MINUTE, latest.energy_kwh + 0.1);
  const statuses = (await Promise.all([device.post(URL).send(reading), device.post(URL).send(reading)]))
    .map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409]);
});

test('simultaneous conflicting uploads cannot both pass the counter check', async () => {
  // Two readings whose counters contradict each other: the later instant has
  // the lower value. Whichever the server handles second must be refused.
  const [latest] = await readingsOf(1);
  const t = latest.recorded_at.getTime();
  const first = body(t + 2 * MINUTE, latest.energy_kwh + 0.5);
  const second = body(t + 3 * MINUTE, latest.energy_kwh + 0.2);
  const statuses = (await Promise.all([device.post(URL).send(first), device.post(URL).send(second)]))
    .map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 400]);
});

test('simultaneous valid uploads at different instants are all stored', async () => {
  const [latest] = await readingsOf(1);
  const t = latest.recorded_at.getTime();
  const uploads = [1, 2, 3, 4, 5].map((n) => device.post(URL).send(body(t + n * MINUTE, latest.energy_kwh + n * 0.1)));
  const statuses = (await Promise.all(uploads)).map((r) => r.status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201]);
  const stored = await readingsOf(6);
  const counters = stored.reverse().map((r) => r.energy_kwh);
  assert.deepEqual(counters, [...counters].sort((a, b) => a - b), 'the cumulative counter still never decreases');
});

test('the upload lock makes a second writer for the same installation wait', async () => {
  // Deterministic proof of the lock itself: the HTTP tests above rarely
  // overlap on a fast local machine, so they cannot show the wait happening.
  const [a, b, c] = await Promise.all([db.connect(), db.connect(), db.connect()]);
  try {
    await Promise.all([a, b, c].map((client) => client.query('BEGIN')));
    await lockInstallationReadings(a, SITE);

    let secondAcquired = false;
    const second = lockInstallationReadings(b, SITE).then(() => { secondAcquired = true; });
    await lockInstallationReadings(c, 'ins-0001'); // another installation: not blocked
    await sleep(200);
    assert.equal(secondAcquired, false, 'same installation must wait while the first transaction holds the lock');

    await a.query('COMMIT'); // releases the lock
    await second;
    assert.equal(secondAcquired, true);
  } finally {
    // Release the lock holder first, or the waiting client could never finish.
    await a.query('ROLLBACK');
    await Promise.all([b, c].map((client) => client.query('ROLLBACK')));
    [a, b, c].forEach((client) => client.release());
  }
});
