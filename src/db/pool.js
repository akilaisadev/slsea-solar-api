import pg from 'pg';

// NUMERIC columns (power_kw, energy_kwh, ...) arrive from pg as strings to
// avoid precision loss. Our values are small decimals, so parse them as
// JavaScript numbers to keep the JSON representation numeric.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
// BIGINT (reading_id, counts) stays well inside Number.MAX_SAFE_INTEGER here.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
// DATE (commissioned_on) would otherwise become a Date at local midnight and
// serialise with a time and a timezone shift (2023-04-02 -> 2023-04-01T18:30Z
// on a UTC+05:30 machine). A calendar date stays a plain "YYYY-MM-DD" string.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export function createPool(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Fail a request after 10 s instead of waiting forever for a connection,
    // so an unreachable database becomes a prompt 503 rather than a hang.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // A serverless database (Neon) closes idle connections when it scales to
  // zero. pg reports that as an 'error' event on the pool; with no listener
  // Node treats it as unhandled and the whole API process would crash. The
  // pool simply opens a fresh connection for the next query.
  pool.on('error', (err) => {
    console.error(`Idle database connection closed: ${err.message}`);
  });
  return pool;
}
