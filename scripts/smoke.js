// End-to-end contract check against a running deployment: the evidence
// that the public API behaves as designed (status codes, headers, scoping).
// Usage: node scripts/smoke.js <base-url> [--read-only]
//   needs DEMO_PASSWORD; the write checks also need DEVICE_SECRET_SEED.
import { deriveDeviceSecret } from './lib/device-secrets.js';

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const readOnly = process.argv.includes('--read-only');
const API = `${base}/solar/v1`;
const { DEMO_PASSWORD, DEVICE_SECRET_SEED } = process.env;
if (!DEMO_PASSWORD) throw new Error('DEMO_PASSWORD must be set');

const results = [];
function check(name, expected, actual, pass) {
  results.push({ check: name, expected, actual: String(actual), result: pass ? 'PASS' : 'FAIL' });
}

async function call(url, { token, method = 'GET', headers = {}, body, type } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': type ?? 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

async function requestToken(form) {
  const res = await call(`${base}/oauth2/token`, {
    method: 'POST', type: 'application/x-www-form-urlencoded', body: new URLSearchParams(form).toString(),
  });
  return res;
}

const started = Date.now();

// --- operations and documentation
const health = await call(`${base}/health/database`);
check('GET /health/database', '200, database ok', `${health.status}, ${health.json?.database}`, health.status === 200 && health.json?.database === 'ok');
const docs = await call(`${base}/docs/`, { headers: { Accept: 'text/html' } });
check('GET /docs (Swagger UI)', '200 text/html', `${docs.status} ${docs.headers.get('content-type')}`, docs.status === 200 && /text\/html/.test(docs.headers.get('content-type')));
const spec = await call(`${base}/openapi.json`);
check('GET /openapi.json', 'OpenAPI 3.1.0', spec.json?.openapi, spec.json?.openapi === '3.1.0');

// --- authentication
const anonymous = await call(`${API}/provinces`);
check('no token', '401 + Bearer challenge', `${anonymous.status} ${anonymous.headers.get('www-authenticate')}`,
  anonymous.status === 401 && /^Bearer/.test(anonymous.headers.get('www-authenticate') ?? ''));
const nationalLogin = await requestToken({ grant_type: 'password', username: 'national.analyst', password: DEMO_PASSWORD });
check('password grant', '200 Bearer', `${nationalLogin.status} ${nationalLogin.json?.token_type}`, nationalLogin.status === 200);
const national = nationalLogin.json?.access_token;
const colombo = (await requestToken({ grant_type: 'password', username: 'colombo.analyst', password: DEMO_PASSWORD })).json?.access_token;

// --- read path
const provinces = await call(`${API}/provinces`, { token: national });
check('GET /provinces', '200, count 9', `${provinces.status}, ${provinces.json?.count}`, provinces.status === 200 && provinces.json?.count === 9);

const sorted = await call(`${API}/installations?district-id=ds-01&sort=capacity_kw&order=desc&limit=10`, { token: national });
const capacities = sorted.json?.items?.map((i) => i.capacity_kw) ?? [];
check('filter + sort installations', 'capacity non-increasing', capacities.join(','),
  sorted.status === 200 && capacities.every((c, i) => i === 0 || c <= capacities[i - 1]));

const composite = await call(`${API}/installations/ins-0001`, { token: national });
check('composite GET /installations/ins-0001', '200 + location + last_reading + ETag',
  `${composite.status} ${Boolean(composite.json?.location)} ${Boolean(composite.json?.last_reading)} ${composite.headers.get('etag')}`,
  composite.status === 200 && composite.json?.location && composite.json?.last_reading && composite.headers.get('etag'));

const replay = await call(`${API}/installations/ins-0001`, { token: national, headers: { 'If-None-Match': composite.headers.get('etag') } });
check('conditional GET replay', '304, empty body', `${replay.status}, ${replay.text.length} bytes`, replay.status === 304 && replay.text.length === 0);

const history = await call(`${API}/installations/ins-0001/readings?order=asc&limit=5`, { token: national });
const times = history.json?.items?.map((r) => Date.parse(r.recorded_at)) ?? [];
check('readings ascending + pagination', 'sorted asc, next link', `${history.json?.count} total, next=${Boolean(history.json?.next)}`,
  history.status === 200 && times.every((t, i) => i === 0 || t > times[i - 1]) && Boolean(history.json?.next));

const to = new Date();
const from = new Date(to.getTime() - 2 * 3_600_000);
const regional = await call(`${API}/readings?district-id=ds-01&from=${from.toISOString()}&to=${to.toISOString()}&limit=5`, { token: national });
check('regional readings: district + time window', '200, count > 0', `${regional.status}, ${regional.json?.count}`, regional.status === 200 && regional.json?.count > 0);

const summary = await call(`${API}/districts/ds-01/generation-summary`, { token: national });
check('district generation summary', '200, sites reporting', `${summary.status}, ${summary.json?.reporting_installation_count} reporting, ${summary.json?.current_total_power_kw} kW`,
  summary.status === 200 && summary.json?.reporting_installation_count > 0);

const xml = await call(`${API}/provinces`, { token: national, headers: { Accept: 'application/xml' } });
check('Accept: application/xml', '406', xml.status, xml.status === 406);

// --- jurisdiction
const kandySite = (await call(`${API}/installations?district-id=ds-04&limit=1`, { token: national })).json?.items?.[0]?.installation_id;
const crossRead = await call(`${API}/installations/${kandySite}`, { token: colombo });
check('Colombo user reads a Kandy site', '403', crossRead.status, crossRead.status === 403);
const crossFilter = await call(`${API}/readings?district-id=ds-04`, { token: colombo });
check('Colombo user filters by Kandy', '403', crossFilter.status, crossFilter.status === 403);

// --- write path
if (!readOnly) {
  if (!DEVICE_SECRET_SEED) throw new Error('DEVICE_SECRET_SEED must be set for write checks (or pass --read-only)');
  const deviceLogin = await requestToken({ grant_type: 'client_credentials', client_id: 'ins-0001', client_secret: deriveDeviceSecret(DEVICE_SECRET_SEED, 'ins-0001') });
  check('client credentials grant (device)', '200, readings:write', `${deviceLogin.status}, ${deviceLogin.json?.scope}`, deviceLogin.json?.scope === 'readings:write');
  const device = deviceLogin.json?.access_token;

  const deviceRead = await call(`${API}/provinces`, { token: device });
  check('device tries to read', '403 insufficient_scope', deviceRead.status, deviceRead.status === 403);

  // One second after the latest reading, with the same values: a valid
  // reading that can never make a later simulator reading look like the
  // cumulative counter ran backwards.
  const last = composite.json.last_reading;
  const reading = {
    recorded_at: new Date(Date.parse(last.recorded_at) + 1000).toISOString(),
    power_kw: last.power_kw, energy_kwh: last.energy_kwh, voltage_v: last.voltage_v,
  };
  const created = await call(`${API}/installations/ins-0001/readings`, { token: device, method: 'POST', body: reading });
  const location = created.headers.get('location');
  check('device POST reading', '201 + Location', `${created.status} ${location}`, created.status === 201 && Boolean(location));
  const located = location ? await call(location, { token: national }) : { status: 'n/a' };
  check('Location resolves', '200', located.status, located.status === 200);
  const duplicate = await call(`${API}/installations/ins-0001/readings`, { token: device, method: 'POST', body: reading });
  check('re-send same reading', '409', duplicate.status, duplicate.status === 409);
  const put = location ? await call(location, { token: national, method: 'PUT', body: reading }) : { status: 'n/a', headers: new Headers() };
  check('PUT on a reading (append-only)', '405 + Allow', `${put.status} ${put.headers.get('allow')}`, put.status === 405);
  const plain = await call(`${API}/installations/ins-0001/readings`, { token: device, method: 'POST', body: 'x', type: 'text/plain' });
  check('POST text/plain', '415', plain.status, plain.status === 415);

  const admin = (await requestToken({ grant_type: 'password', username: 'asset.admin', password: DEMO_PASSWORD })).json?.access_token;
  const stale = await call(`${API}/installations/ins-0001`, {
    token: admin, method: 'PATCH', type: 'application/merge-patch+json', headers: { 'If-Match': '"stale-etag"' }, body: { status: 'maintenance' },
  });
  check('PATCH with stale If-Match', '412 (no change)', stale.status, stale.status === 412);
}

console.log(`\nSmoke test against ${base} (${readOnly ? 'read-only' : 'read + write'}), ${new Date().toISOString()}, ${Date.now() - started} ms`);
console.table(results);
const failed = results.filter((r) => r.result === 'FAIL').length;
console.log(failed ? `${failed} check(s) FAILED` : `All ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
