import { ApiError } from '../lib/errors.js';

// WSO2 §10.1 / §9: the API has exactly one representation, application/json.
// A client that will not accept it gets 406 rather than a body it cannot read.
export function requireJsonAccept(req, res, next) {
  if (req.accepts('application/json')) return next();
  next(new ApiError(40601, `This API only produces application/json, but the Accept header was "${req.get('accept')}".`));
}

// WSO2 §8.1 / §9: a request body must arrive in a media type the route
// understands, otherwise 415. req.is() returns null when there is no body
// at all; that case is left to body validation (400), not reported as 415.
export function requireBodyType(...types) {
  return (req, res, next) => {
    if (req.is(types) === false) {
      return next(new ApiError(41501, `Content-Type "${req.get('content-type')}" is not supported here. Use ${types.join(' or ')}.`));
    }
    next();
  };
}
