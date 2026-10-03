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
  return new pg.Pool({ connectionString, max: 10 });
}
