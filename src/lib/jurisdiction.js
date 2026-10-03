import { ApiError } from './errors.js';

// Jurisdiction scope of the caller. National users see everything; a
// province user sees one province; a district user sees one district (and
// the name of the province that contains it). The scope comes from the
// verified access token, so a client cannot widen it.
export const NATIONAL = Object.freeze({ level: 'national' });

// Fails closed: a request without a verified user jurisdiction (no token,
// or a device token) is refused rather than defaulting to national scope.
export function scopeOf(req) {
  const jurisdiction = req.auth?.jurisdiction;
  if (!jurisdiction) {
    throw new ApiError(40301, 'Reading data requires an SLSEA user token with a jurisdiction.');
  }
  return jurisdiction;
}

// Restricts a query to the caller's jurisdiction.
// columns.province / columns.district name the SQL columns available in the
// query; a province-level row has no district column, so a district user
// sees only the province that contains their district.
export function restrictToScope(conditions, scope, columns) {
  if (scope.level === 'province') {
    conditions.add(`${columns.province} = ?`, scope.province_id);
  } else if (scope.level === 'district') {
    if (columns.district) conditions.add(`${columns.district} = ?`, scope.district_id);
    else conditions.add(`${columns.province} = ?`, scope.province_id);
  }
}

// Member check for a single resource that exists: 403 when it lies outside
// the caller's jurisdiction (identity is known; the answer is "not yours").
export function assertInScope(scope, { province_id, district_id }, what) {
  const visible = scope.level === 'national'
    || (scope.level === 'province' && province_id === scope.province_id)
    || (scope.level === 'district' && (district_id === undefined
      ? province_id === scope.province_id
      : district_id === scope.district_id));
  if (!visible) {
    throw new ApiError(40302, `${what} is outside your jurisdiction.`);
  }
}
