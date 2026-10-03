// Verifies the seeded dataset against the brief: scale, foreign-key
// consistency, a week of history per installation, a realistic diurnal
// shape and monotonic energy counters. Exits non-zero on any failure.
// Usage: node scripts/check-seed.js [--small]
import { createPool } from '../src/db/pool.js';

const small = process.argv.includes('--small');
const db = createPool(process.env.DATABASE_URL);

const one = async (sql) => (await db.query(sql)).rows[0];

const checks = [];
function check(name, actual, pass) {
  checks.push({ check: name, actual, result: pass ? 'PASS' : 'FAIL' });
}

try {
  const counts = await one(`SELECT
    (SELECT count(*) FROM province) AS provinces,
    (SELECT count(*) FROM district) AS districts,
    (SELECT count(*) FROM grid_substation) AS substations,
    (SELECT count(*) FROM solar_installation) AS installations,
    (SELECT count(*) FROM generation_reading) AS readings,
    (SELECT count(*) FROM app_user) AS users`);
  check('9 provinces', counts.provinces, counts.provinces === 9);
  check('25 districts', counts.districts, counts.districts === 25);
  check('20+ grid substations', counts.substations, counts.substations >= 20);
  check('200+ installations', counts.installations, small || counts.installations >= 200);
  check('readings present', counts.readings, counts.readings > 0);

  // FK constraints already guarantee these; the queries make it visible.
  const orphans = await one(`SELECT
    (SELECT count(*) FROM district d LEFT JOIN province p USING (province_id) WHERE p.province_id IS NULL)
    + (SELECT count(*) FROM grid_substation s LEFT JOIN district d USING (district_id) WHERE d.district_id IS NULL)
    + (SELECT count(*) FROM solar_installation i LEFT JOIN grid_substation s USING (substation_id) WHERE s.substation_id IS NULL)
    + (SELECT count(*) FROM generation_reading r LEFT JOIN solar_installation i USING (installation_id) WHERE i.installation_id IS NULL)
    AS orphans`);
  check('no orphaned foreign keys', orphans.orphans, orphans.orphans === 0);

  const coverage = await one(`SELECT
    (SELECT count(*) FROM district d WHERE NOT EXISTS (SELECT 1 FROM grid_substation s WHERE s.district_id = d.district_id)) AS empty_districts,
    (SELECT count(*) FROM grid_substation s WHERE NOT EXISTS (SELECT 1 FROM solar_installation i WHERE i.substation_id = s.substation_id)) AS empty_substations`);
  check('every district has a substation', coverage.empty_districts, coverage.empty_districts === 0);
  check('every substation has installations', coverage.empty_substations, small || coverage.empty_substations === 0);

  const history = await one(`
    WITH spans AS (
      SELECT installation_id, max(recorded_at) - min(recorded_at) AS span, count(*) AS n
      FROM generation_reading GROUP BY installation_id
    )
    SELECT count(*) FILTER (WHERE span >= interval '7 days') AS week_or_more,
           count(*) AS reporting,
           min(n) AS min_readings
    FROM spans`);
  check('reporting installations with 7+ days of history', `${history.week_or_more}/${history.reporting}`,
    small || history.week_or_more === history.reporting);

  const edge = await one(`SELECT count(*) AS without_readings FROM solar_installation i
    WHERE NOT EXISTS (SELECT 1 FROM generation_reading r WHERE r.installation_id = i.installation_id)`);
  check('edge case: installation with no readings', edge.without_readings, edge.without_readings >= 1);

  const night = await one(`SELECT count(*) AS night_rows, count(*) FILTER (WHERE power_kw > 0) AS night_generating
    FROM generation_reading
    WHERE extract(hour FROM recorded_at AT TIME ZONE 'Asia/Colombo') NOT BETWEEN 6 AND 18`);
  check('zero generation overnight', `${night.night_generating} of ${night.night_rows}`, night.night_generating === 0);

  const monotonic = await one(`SELECT count(*) AS decreases FROM (
      SELECT energy_kwh < lag(energy_kwh) OVER (PARTITION BY installation_id ORDER BY recorded_at) AS dropped
      FROM generation_reading) t WHERE dropped`);
  check('cumulative energy never decreases', monotonic.decreases, monotonic.decreases === 0);

  console.table(checks);
  if (checks.some((c) => c.result === 'FAIL')) process.exitCode = 1;
} finally {
  await db.end();
}
