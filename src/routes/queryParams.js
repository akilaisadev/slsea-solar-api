import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { scopeOf, assertInScope } from '../lib/jurisdiction.js';
import { findDistrict, findGridSubstation } from '../repositories/hierarchy.js';

// Shared query-string parameters (WSO2 §5.7, §10.2). Names follow the URI
// rules: lowercase and hyphenated, like the path segments.

export const jurisdictionParams = {
  'province-id': z.string().regex(/^pv-[0-9]{2}$/, 'must look like pv-01').optional(),
  'district-id': z.string().regex(/^ds-[0-9]{2}$/, 'must look like ds-01').optional(),
  'substation-id': z.string().regex(/^gss-[0-9]{3}$/, 'must look like gss-001').optional(),
};

// Time window over recorded_at: from is inclusive, to is exclusive, so
// consecutive windows (e.g. one per day) never double-count a reading.
const instant = z.iso.datetime({ offset: true, error: 'must be an ISO 8601 date-time such as 2026-10-01T00:00:00Z' });
export const timeWindowParams = {
  from: instant.optional(),
  to: instant.optional(),
};

export const order = (defaultOrder) => z.enum(['asc', 'desc']).default(defaultOrder);

export function timeWindowOf(query) {
  const window = {
    from: query.from ? new Date(query.from) : null,
    to: query.to ? new Date(query.to) : null,
  };
  if (window.from && window.to && window.from >= window.to) {
    throw new ApiError(40001, 'The time window is empty.', {
      errors: [{ code: 40001, field: 'from', message: 'must be earlier than to' }],
    });
  }
  return window;
}

// Explicit jurisdiction filters must lie inside the caller's own
// jurisdiction: asking for another district is refused (403), not silently
// answered with an empty page. Filters that name nothing simply match nothing.
export async function jurisdictionFiltersOf(req, query) {
  const filters = {
    provinceId: query['province-id'],
    districtId: query['district-id'],
    substationId: query['substation-id'],
  };
  const scope = scopeOf(req);
  if (scope.level !== 'national') {
    const db = req.app.locals.db;
    if (filters.provinceId) {
      assertInScope(scope, { province_id: filters.provinceId }, `province-id '${filters.provinceId}'`);
    }
    if (filters.districtId) {
      const district = await findDistrict(db, filters.districtId);
      if (district) assertInScope(scope, district, `district-id '${filters.districtId}'`);
    }
    if (filters.substationId) {
      const substation = await findGridSubstation(db, filters.substationId);
      if (substation) assertInScope(scope, substation, `substation-id '${filters.substationId}'`);
    }
  }
  return filters;
}
