import { ApiError } from '../lib/errors.js';

// Registered with router.route(path).all(allowOnly(...)) after the real
// handlers, so it only runs for methods the route does not implement.
// OPTIONS answers 204 with Allow; anything else is 405 with Allow (RFC 9110).
export function allowOnly(...methods) {
  const allowed = [...methods];
  if (allowed.includes('GET')) allowed.push('HEAD');
  allowed.push('OPTIONS');
  const allowHeader = allowed.join(', ');

  return (req, res, next) => {
    res.set('Allow', allowHeader);
    if (req.method === 'OPTIONS') return res.status(204).end();
    next(new ApiError(40501, `${req.method} is not supported on ${req.baseUrl}${req.path}. Allowed methods: ${allowHeader}.`, {
      headers: { Allow: allowHeader },
    }));
  };
}
