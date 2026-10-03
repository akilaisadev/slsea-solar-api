// Lookups for the two kinds of principal that can obtain a token.

export async function findDeviceCredential(db, installationId) {
  const { rows } = await db.query(
    `SELECT installation_id, device_secret_hash, status
     FROM solar_installation WHERE installation_id = $1`,
    [installationId],
  );
  return rows[0] ?? null;
}

// A district user's token also carries the province containing the district,
// so province_id is resolved here for every jurisdiction level.
export async function findUserByUsername(db, username) {
  const { rows } = await db.query(
    `SELECT u.user_id, u.username, u.password_hash, u.role, u.jurisdiction_level,
            COALESCE(u.province_id, d.province_id) AS province_id, u.district_id
     FROM app_user u LEFT JOIN district d ON d.district_id = u.district_id
     WHERE u.username = $1`,
    [username],
  );
  return rows[0] ?? null;
}
