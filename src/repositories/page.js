// Runs the two queries behind every paginated collection over the same
// FROM / WHERE: one for the total count and Last-Modified, one for the page.
// `orderBy` and `select` are always fixed strings chosen by the route, never
// client input; client values only ever arrive as bound parameters.
export async function fetchPage(db, { select, from, conditions, orderBy, offset, limit, lastModified }) {
  const totals = await db.query(
    `SELECT count(*) AS count, ${lastModified} AS last_modified FROM ${from} ${conditions.where}`,
    conditions.params,
  );
  const n = conditions.params.length;
  const page = await db.query(
    `SELECT ${select} FROM ${from} ${conditions.where} ORDER BY ${orderBy} OFFSET $${n + 1} LIMIT $${n + 2}`,
    [...conditions.params, offset, limit],
  );
  return { count: totals.rows[0].count, lastModified: totals.rows[0].last_modified, rows: page.rows };
}
