import { z } from 'zod';
import { origin } from './urls.js';

// WSO2 §10.3: offset/limit in the query string; the response carries the
// total count plus links to the next and previous chunks.
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const paginationParams = {
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
};

// Rebuilds the request URL with a different offset, keeping every other
// query parameter (filters, sort) so the link continues the same query.
function pageUrl(req, offset, limit) {
  const url = new URL(req.originalUrl, origin(req));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

export function paginated(req, { count, offset, limit, items }) {
  return {
    count,
    offset,
    limit,
    next: offset + limit < count ? pageUrl(req, offset + limit, limit) : null,
    previous: offset > 0 ? pageUrl(req, Math.max(0, offset - limit), limit) : null,
    items,
  };
}
