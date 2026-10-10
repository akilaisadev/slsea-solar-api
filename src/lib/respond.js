import { etagOf, isNotModified } from './conditional.js';
import { paginated } from './pagination.js';

// Sends a representation with its validators (WSO2 §8.2) and honours
// conditional GET (§10.4): if the client already holds this exact
// representation, the answer is 304 Not Modified with an empty body.
// Last-Modified comes from the data itself (updated_at / received_at).
// `etag` overrides the computed tag when the body sent is not exactly the
// resource's GET representation (POST /installations adds a one-time
// device_secret that is not part of the resource's state).
export function sendRepresentation(req, res, body, { lastModified, status = 200, etag: etagOverride } = {}) {
  // A successful conditional write has no response entity: retrieve the new
  // representation with GET. This also prevents the hosting CDN from
  // re-testing the old validator against a post-update response entity.
  if (['PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      (req.get('If-Match') || req.get('If-Unmodified-Since'))) {
    res.set('Cache-Control', 'no-store');
    return res.status(204).end();
  }
  const json = JSON.stringify(body);
  const etag = etagOverride ?? etagOf(json);
  res.set('ETag', etag);
  if (lastModified) res.set('Last-Modified', new Date(lastModified).toUTCString());
  // The same URI returns different data to different jurisdictions, so a
  // shared cache must not reuse it across callers (private, Vary) and
  // clients must revalidate before reusing a stored copy (no-cache).
  res.set('Cache-Control', 'private, no-cache');
  res.vary('Authorization');

  if (status === 200 && (req.method === 'GET' || req.method === 'HEAD') && isNotModified(req, etag, lastModified)) {
    return res.status(304).end();
  }
  res.status(status).type('application/json').send(json);
}

// Sends one page of a collection (WSO2 §10.3) built from a repository page
// ({ count, rows, lastModified }), mapping each row to its representation.
export function sendPage(req, res, page, { offset, limit }, toItem) {
  const body = paginated(req, { count: page.count, offset, limit, items: page.rows.map(toItem) });
  sendRepresentation(req, res, body, { lastModified: page.lastModified });
}
