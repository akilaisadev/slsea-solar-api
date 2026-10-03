import { ApiError, errorBody } from '../lib/errors.js';
import { origin } from '../lib/urls.js';

export function notFound(req, res, next) {
  next(new ApiError(40402, `No resource matches ${req.path}.`));
}

// Maps errors raised by Express's own body parser onto the catalogue so
// they share the §11 body shape with every other error.
function fromFrameworkError(err) {
  if (err.type === 'entity.parse.failed') return new ApiError(40003, 'The request body is not valid JSON.');
  if (err.type === 'entity.too.large') return new ApiError(41301, 'The request body exceeds the 10 kB limit.');
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    return new ApiError(41501, 'The request body encoding is not supported.');
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
