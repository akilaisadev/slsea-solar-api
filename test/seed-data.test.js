import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallations, INSTALLATION_COUNT } from '../scripts/lib/seed-data.js';
import { readingsBetween } from '../scripts/lib/solar-model.js';

test('the full coursework seed gives every installation at least seven days of readings', () => {
  const end = Date.UTC(2026, 9, 10, 12);
  const day = 24 * 60 * 60 * 1000;
  const start = end - 9 * day;
  const installations = buildInstallations({ today: '2026-10-10' });
  assert.equal(installations.length, INSTALLATION_COUNT);
  for (const installation of installations) {
    assert.notEqual(installation.reporting, 'none', installation.installation_id);
    const last = installation.reporting === 'stopped-2-days-ago' ? end - 2 * day : end;
    const readings = [...readingsBetween(installation, start, last)];
    assert.ok(readings.length >= 673, installation.installation_id);
    assert.ok(readings.at(-1).recorded_at - readings[0].recorded_at >= 7 * day,
      installation.installation_id);
    assert.ok(Date.parse(installation.commissioned_on) <= readings[0].recorded_at,
      installation.installation_id);
  }
});

test('empty history remains available as an explicit test fixture', () => {
  const installations = buildInstallations({ today: '2026-10-10', includeEmptyHistory: true });
  const empty = installations.filter((installation) => installation.reporting === 'none');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].installation_id, 'ins-0240');
  assert.equal(empty[0].commissioned_on, '2026-10-10');
});
