// Applies db/schema.sql (idempotent). With --reset, drops every table first;
// used by the test suite and when re-seeding from scratch.
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/db/pool.js';

const reset = process.argv.includes('--reset');
const db = createPool(process.env.DATABASE_URL);

try {
  if (reset) {
    await db.query(`
      DROP TABLE IF EXISTS generation_reading, app_user, solar_installation,
                           grid_substation, district, province CASCADE;
      DROP SEQUENCE IF EXISTS installation_number_seq;
    `);
  }
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await db.query(schema);
  console.log(`Schema applied${reset ? ' (after reset)' : ''}.`);
} finally {
  await db.end();
}
