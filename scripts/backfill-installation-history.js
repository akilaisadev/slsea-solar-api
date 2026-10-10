// Add seven days of synthetic seed history through the device write path.
// This repairs an empty seeded installation without replacing existing data.
// Usage: node --env-file=coursework/production.env scripts/backfill-installation-history.js
//        ins-0240 https://slsea-solar-api-seven.vercel.app
import { buildInstallations } from './lib/seed-data.js';
import { floorToSlot, readingsBetween, SLOT_MS } from './lib/solar-model.js';
import { deriveDeviceSecret } from './lib/device-secrets.js';

const installationId = process.argv[2];
const base = (process.argv[3] ?? process.env.API_BASE_URL ?? '').replace(/\/$/, '');
const { DEMO_PASSWORD, DEVICE_SECRET_SEED } = process.env;
if (!installationId || !base || !DEMO_PASSWORD || !DEVICE_SECRET_SEED) {
  throw new Error('An installation id, API URL, DEMO_PASSWORD and DEVICE_SECRET_SEED are required.');
}
const apiPath = `/solar/v1/installations/${installationId}`;
const end = floorToSlot(Date.now());
const start = end - 7 * 24 * 60 * 60 * 1000;
const model = buildInstallations({ today: new Date(end).toISOString().slice(0, 10) })
  .find((installation) => installation.installation_id === installationId);
if (!model) throw new Error('Only a known seeded installation can be backfilled by this script.');

async function call(path, { token, method = 'GET', type = 'application/json', body, headers = {} } = {}) {
  const response = await fetch(path.startsWith('https://') ? path : `${base}${path}`, {
    method,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': type }) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
}

async function tokenFor(form) {
  const result = await call('/oauth2/token', {
    method: 'POST', type: 'application/x-www-form-urlencoded', body: new URLSearchParams(form).toString(),
  });
  if (result.status !== 200) throw new Error(`Authentication failed (${result.status}).`);
  return result.body.access_token;
}

const analyst = await tokenFor({ grant_type: 'password', username: 'national.analyst', password: DEMO_PASSWORD });
const current = await call(apiPath, { token: analyst });
const history = await call(`${apiPath}/readings?limit=1`, { token: analyst });
if (current.status !== 200 || history.status !== 200) throw new Error('The installation cannot be read.');
if (history.body.count !== 0) throw new Error('Refusing to replace or reinterpret an existing history.');
if (current.body.capacity_kw !== model.capacity_kw || current.body.substation_id !== model.substation_id) {
  throw new Error('The installation no longer matches its seed model.');
}
const device = await tokenFor({
  grant_type: 'client_credentials', client_id: installationId,
  client_secret: deriveDeviceSecret(DEVICE_SECRET_SEED, installationId),
});

// The original empty-history fixture was commissioned today. Restoring its
// deterministic seed date makes the backfilled measurement dates plausible
// and keeps future simulator cumulative counters on the same model.
if (current.body.commissioned_on !== model.commissioned_on) {
  const admin = await tokenFor({ grant_type: 'password', username: 'asset.admin', password: DEMO_PASSWORD });
  const updated = await call(apiPath, {
    token: admin, method: 'PATCH', type: 'application/merge-patch+json',
    headers: { 'If-Match': current.headers.get('etag') }, body: { commissioned_on: model.commissioned_on },
  });
  if (![200, 204].includes(updated.status)) throw new Error(`Commissioning date correction failed (${updated.status}).`);
}

const readings = [...readingsBetween(model, start, end)].map((reading) => ({
  ...reading, recorded_at: new Date(reading.recorded_at).toISOString(),
}));
console.log(`Backfilling ${installationId}: ${readings.length} readings, ${new Date(start).toISOString()} to ${new Date(end).toISOString()}.`);
let index = 0;
let created = 0;
let duplicate = 0;
let firstLocation;
let failure;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (!failure && index < readings.length) {
    const reading = readings[index++];
    try {
      const result = await call(`${apiPath}/readings`, { token: device, method: 'POST', body: reading });
      if (result.status === 201) {
        created += 1;
        firstLocation ??= result.headers.get('location');
      } else if (result.status === 409) duplicate += 1;
      else throw new Error(`Reading ${reading.recorded_at}: HTTP ${result.status}, ${result.body?.message ?? 'request failed'}`);
      if ((created + duplicate) % 100 === 0) console.log(`${created + duplicate}/${readings.length} readings processed.`);
    } catch (error) {
      failure = error;
    }
  }
}));
if (failure) throw failure;

const [oldest, newest, located] = await Promise.all([
  call(`${apiPath}/readings?limit=1&order=asc`, { token: analyst }),
  call(`${apiPath}/readings?limit=1&order=desc`, { token: analyst }),
  firstLocation ? call(firstLocation, { token: analyst }) : Promise.resolve(null),
]);
const span = Date.parse(newest.body.items[0].recorded_at) - Date.parse(oldest.body.items[0].recorded_at);
if (oldest.status !== 200 || newest.status !== 200 || newest.body.count < 673 || span < 672 * SLOT_MS
    || (located && located.status !== 200)) throw new Error('Backfilled history did not pass verification.');
console.log(JSON.stringify({ installation_id: installationId, created, duplicate, count: newest.body.count,
  first: oldest.body.items[0].recorded_at, last: newest.body.items[0].recorded_at, span_days: span / 86_400_000,
  location_resolves: located?.status === 200, verified: true }));
