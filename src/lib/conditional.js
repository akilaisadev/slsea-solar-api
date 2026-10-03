import { createHash } from 'node:crypto';

// Entity tags and the HTTP precondition rules (RFC 9110 §13, WSO2 §10.4–10.5).

// A strong ETag: a digest of the exact bytes of the representation, so it
// changes whenever any field the client would see changes.
export function etagOf(serialisedBody) {
  return `"${createHash('sha256').update(serialisedBody).digest('base64url').slice(0, 32)}"`;
}

// HTTP dates have one-second precision; compare at that precision.
function toSeconds(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function parseTagList(header) {
  return header.split(',').map((tag) => tag.trim()).filter(Boolean);
}

// Weak comparison (used by If-None-Match): W/"x" and "x" are the same tag.
function weakMatch(header, etag) {
  const strip = (tag) => tag.replace(/^W\//, '');
  return parseTagList(header).some((tag) => tag === '*' || strip(tag) === strip(etag));
}

// Strong comparison (used by If-Match): weak tags never match.
function strongMatch(header, etag) {
  return parseTagList(header).some((tag) => tag === '*' || (!tag.startsWith('W/') && tag === etag));
}

// Conditional GET: true when the client's cached copy is current, so the
// server answers 304 with no body. If-None-Match takes precedence; only when
// it is absent is If-Modified-Since consulted.
export function isNotModified(req, etag, lastModified) {
  const ifNoneMatch = req.get('If-None-Match');
  if (ifNoneMatch) return weakMatch(ifNoneMatch, etag);
  const ifModifiedSince = req.get('If-Modified-Since');
  if (ifModifiedSince && lastModified) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since)) return toSeconds(lastModified) <= Math.floor(since / 1000);
  }
  return false;
}

// Optimistic concurrency for writes: true when the client's precondition
// fails, so the server answers 412 and changes nothing. If-Match takes
// precedence over If-Unmodified-Since.
export function preconditionFails(req, etag, lastModified) {
  const ifMatch = req.get('If-Match');
  if (ifMatch) return !strongMatch(ifMatch, etag);
  const ifUnmodifiedSince = req.get('If-Unmodified-Since');
  if (ifUnmodifiedSince && lastModified) {
    const since = Date.parse(ifUnmodifiedSince);
    if (!Number.isNaN(since)) return toSeconds(lastModified) > Math.floor(since / 1000);
  }
  return false;
}
