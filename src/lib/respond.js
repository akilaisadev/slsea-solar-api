import { etagOf, isNotModified } from './conditional.js';

// Sends a representation with its validators (WSO2 §8.2) and honours
// conditional GET (§10.4): if the client already holds this exact
// representation, the answer is 304 Not Modified with an empty body.
// Last-Modified comes from the data itself (updated_at / received_at).
// `etag` overrides the computed tag when the body sent is not exactly the
// resource's GET representation (POST /installations adds a one-time
// device_secret that is not part of the resource's state).
export function sendRepresentation(req, res, body, { lastModified, status = 200, etag: etagOverride } = {}) {
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
