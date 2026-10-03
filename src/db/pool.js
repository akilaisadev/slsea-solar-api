import pg from 'pg';

// NUMERIC columns (power_kw, energy_kwh, ...) arrive from pg as strings to
// avoid precision loss. Our values are small decimals, so parse them as
// JavaScript numbers to keep the JSON representation numeric.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
// BIGINT (reading_id, counts) stays well inside Number.MAX_SAFE_INTEGER here.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 10 });
}
