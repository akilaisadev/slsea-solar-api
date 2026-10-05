import { randomUUID } from 'node:crypto';

// Request IDs: every response carries an X-Request-Id, and the same id
// appears in the server log, so a failure a client reports ("I got a 500 at
// 10:32") can be found in Render's logs from the id alone. A well-formed id
// sent by the client (for example from a gateway) is kept; anything else is
// replaced, so a client cannot inject arbitrary text into the logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

// One JSON line per request, written when the response finishes. Only the
// path is logged (no query string, headers or bodies), so tokens and
// credentials never reach the logs; the caller is identified by role and
// pseudonymous id (e.g. "analyst:usr-03", "device:ins-0001").
export function accessLog({ enabled }) {
  return (req, res, next) => {
    if (!enabled) return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      console.log(JSON.stringify({
        time: new Date().toISOString(),
        request_id: req.id,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        duration_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        client: req.auth ? `${req.auth.role}:${req.auth.subject}` : null,
      }));
    });
    next();
  };
}
