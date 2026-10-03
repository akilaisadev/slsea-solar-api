// Stands in for the fleet of rooftop inverters. Each seeded installation
// that reports normally authenticates as itself (client credentials) and
// POSTs its readings through the public API, exactly as a real device would.
//
// It re-sends the last LOOKBACK_SLOTS 15-minute slots on every run, so a
// delayed or skipped run leaves no gap. Values come from the same
// deterministic model as the seed, so a slot that already exists comes back
// as 409 (a harmless duplicate), never as a conflicting value.
//
// Usage: API_BASE_URL=https://... DEVICE_SECRET_SEED=... node scripts/simulate-devices.js
// Runs every 30 minutes from .github/workflows/simulate-devices.yml.
import { buildInstallations } from './lib/seed-data.js';
import { readingsBetween, floorToSlot, SLOT_MS, MODEL_EPOCH } from './lib/solar-model.js';
import { deriveDeviceSecret } from './lib/device-secrets.js';

const base = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');
const masterKey = process.env.DEVICE_SECRET_SEED;
const lookbackSlots = Number(process.env.LOOKBACK_SLOTS ?? 6);
const CONCURRENCY = 6;
if (!base || !masterKey) throw new Error('API_BASE_URL and DEVICE_SECRET_SEED must be set.');

const now = Date.now();
const lastSlot = floorToSlot(now);
const firstSlot = Math.max(MODEL_EPOCH, lastSlot - (lookbackSlots - 1) * SLOT_MS);

// Only the sites that report normally; the maintenance sites stay silent and
// the newly registered site has no device online yet.
const devices = buildInstallations({ today: '2026-01-01' }).filter((inst) => inst.reporting === 'normal');

const tally = { created: 0, duplicate: 0, failed: 0 };
const failures = [];

async function runDevice(inst) {
  const tokenRes = await fetch(`${base}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: inst.installation_id,
      client_secret: deriveDeviceSecret(masterKey, inst.installation_id),
    }),
  });
  if (tokenRes.status !== 200) {
    tally.failed += 1;
    failures.push(`${inst.installation_id}: token ${tokenRes.status}`);
    return;
  }
  const { access_token: token } = await tokenRes.json();

  for (const reading of readingsBetween(inst, firstSlot, lastSlot)) {
    const res = await fetch(`${base}/solar/v1/installations/${inst.installation_id}/readings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...reading, recorded_at: new Date(reading.recorded_at).toISOString() }),
    });
    if (res.status === 201) tally.created += 1;
    else if (res.status === 409) tally.duplicate += 1;
    else {
      tally.failed += 1;
      failures.push(`${inst.installation_id} @ ${new Date(reading.recorded_at).toISOString()}: ${res.status} ${await res.text()}`);
    }
  }
}

// A small pool of concurrent devices keeps a run short without
// overwhelming a free-tier instance.
const queue = [...devices];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await runDevice(queue.shift());
}));

console.log(`Simulated ${devices.length} devices, slots ${new Date(firstSlot).toISOString()} to ${new Date(lastSlot).toISOString()}: `
  + `${tally.created} created, ${tally.duplicate} already present (409), ${tally.failed} failed, ${Math.round((Date.now() - now) / 1000)} s.`);
if (failures.length) {
  console.log(failures.slice(0, 20).join('\n'));
  process.exitCode = 1;
}
