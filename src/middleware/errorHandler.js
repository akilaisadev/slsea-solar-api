import { ApiError, errorBody } from '../lib/errors.js';
import { origin } from '../lib/urls.js';

export function notFound(req, res, next) {
  next(new ApiError(40402, `No resource matches ${req.path}.`));
}

// Network-level and server-availability failures of the database, as opposed
// to errors in a query. These are temporary, so the client is told to retry.
const DATABASE_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
]);

function isDatabaseUnavailable(err) {
  return DATABASE_UNAVAILABLE_CODES.has(err.code)
    || /timeout exceeded when trying to connect|Connection terminated/i.test(err.message ?? '');
}

// Maps errors raised by Express's body parser and by the database driver onto
// the catalogue, so they share the §11 body shape with every other error.
function fromFrameworkError(err) {
  if (err.type === 'entity.parse.failed') return new ApiError(40003, 'The request body is not valid JSON.');
  if (err.type === 'entity.too.large') return new ApiError(41301, 'The request body exceeds the 10 kB limit.');
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return new ApiError(41501, 'The request body encoding is not supported.');
  }
  if (isDatabaseUnavailable(err)) {
    console.error(`Database unavailable: ${err.code ?? ''} ${err.message}`);
    return new ApiError(50301, 'The service is temporarily unavailable. Please retry shortly.', {
      headers: { 'Retry-After': '30' },
    });
  }
  return null;
}

// Express 5 forwards rejected promises from async handlers here, so route
// code can simply throw an ApiError.
export function errorHandler(err, req, res, next) {
  let apiError = err instanceof ApiError ? err : fromFrameworkError(err);
  if (!apiError) {
    console.error(err);
    apiError = new ApiError(50001, 'An unexpected error occurred.');
  }
  if (res.headersSent) return next(err);
  res.set(apiError.headers);
  res.status(apiError.status).json(errorBody(apiError, origin(req)));
}
