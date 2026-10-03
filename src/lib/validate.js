import { ApiError } from './errors.js';

// Turns zod validation issues into the errors[] list of the §11 error body,
// one entry per offending field or query parameter.
function toErrorList(issues, code) {
  return issues.map((issue) => ({
    code,
    field: issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : issue.path.join('.'),
    message: issue.code === 'unrecognized_keys' ? 'is not a supported parameter' : issue.message,
  }));
}

// Unknown query parameters are rejected (schemas are strict) so a typo such
// as ?district_id= fails loudly instead of being silently ignored.
export function parseQuery(schema, req) {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw new ApiError(40001, 'One or more query parameters are invalid.', { errors: toErrorList(result.error.issues, 40001) });
  }
  return result.data;
}

export function parseBody(schema, req) {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new ApiError(40002, 'The request body is invalid.', { errors: toErrorList(result.error.issues, 40002) });
  }
  return result.data;
}
