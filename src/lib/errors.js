// WSO2 §11 error contract: every error response has the same body shape,
//   { code, message, description, more_info, errors[] }
// `code` is a product-specific integer (HTTP status x 100 + sequence) so a
// client can branch on it without parsing the message text.

export const ERROR_CATALOGUE = {
  40001: { status: 400, description: 'Invalid query parameter', resolution: 'Check the query string against the OpenAPI document; the errors array names each offending parameter.' },
  40002: { status: 400, description: 'Invalid request body', resolution: 'Send every required field with the documented type and range; the errors array names each offending field.' },
  40003: { status: 400, description: 'Malformed JSON body', resolution: 'The request body could not be parsed as JSON. Validate the payload before sending.' },
  40004: { status: 400, description: 'Unsupported grant type', resolution: 'Use grant_type=client_credentials (devices) or grant_type=password (SLSEA users).' },
  40005: { status: 400, description: 'Invalid scope', resolution: 'Request only scopes your client type may hold: readings:write for devices; assets:read, readings:read (and installations:write for asset administrators) for SLSEA users.' },
  40101: { status: 401, description: 'Missing bearer token', resolution: 'Obtain a token from POST /oauth2/token and send it as "Authorization: Bearer <token>".' },
  40102: { status: 401, description: 'Invalid or expired token', resolution: 'Request a new access token from POST /oauth2/token.' },
  40103: { status: 401, description: 'Invalid credentials', resolution: 'Check the client_id/client_secret (devices) or username/password (users).' },
  40301: { status: 403, description: 'Insufficient scope', resolution: 'The token is valid but lacks the scope this operation requires. Devices may only write readings; SLSEA users may only read.' },
  40302: { status: 403, description: 'Outside caller jurisdiction', resolution: 'SLSEA users can only read data inside the province or district attached to their account.' },
  40303: { status: 403, description: 'Device not bound to this installation', resolution: 'A device token may only write readings for the installation it authenticated as.' },
  40401: { status: 404, description: 'Resource not found', resolution: 'No resource exists with this identifier. Check the identifier, or list the parent collection.' },
  40402: { status: 404, description: 'Unknown URI', resolution: 'No resource matches this URI. See the OpenAPI document at /docs for the resource map.' },
  40501: { status: 405, description: 'Method not allowed', resolution: 'Use one of the methods listed in the Allow response header.' },
  40601: { status: 406, description: 'Not acceptable', resolution: 'This API only produces application/json. Send "Accept: application/json" or omit the header.' },
  40901: { status: 409, description: 'Duplicate reading', resolution: 'A reading with this timestamp already exists for the installation. Readings are append-only and unique per timestamp, so a retry is safe to ignore.' },
  40902: { status: 409, description: 'Conflicting resource state', resolution: 'The request conflicts with an existing resource, for example a duplicate inverter_id.' },
  41201: { status: 412, description: 'Precondition failed', resolution: 'The resource changed since you fetched it. GET it again to obtain the current ETag, then retry with If-Match.' },
  41301: { status: 413, description: 'Payload too large', resolution: 'Request bodies are limited to 10 kB.' },
  41501: { status: 415, description: 'Unsupported media type', resolution: 'Send the request body as application/json (or application/merge-patch+json for PATCH).' },
  42901: { status: 429, description: 'Too many requests', resolution: 'Too many token requests from this client. Wait and retry after the period in the RateLimit headers.' },
  50001: { status: 500, description: 'Internal server error', resolution: 'An unexpected error occurred. Retry later; if it persists, report it with the X-Request-Id response header.' },
  50301: { status: 503, description: 'Service unavailable', resolution: 'The database is temporarily unreachable (it may be resuming from idle). Retry after the number of seconds in the Retry-After header.' },
};

export class ApiError extends Error {
  constructor(code, message, { errors = [], headers = {} } = {}) {
    super(message);
    const entry = ERROR_CATALOGUE[code];
    if (!entry) throw new Error(`Unknown error code ${code}`);
    this.code = code;
    this.status = entry.status;
    this.description = entry.description;
    this.errors = errors;
    this.headers = headers;
  }
}

export function errorBody(err, baseUrl) {
  return {
    code: err.code,
    message: err.message,
    description: err.description,
    more_info: `${baseUrl}/errors/${err.code}`,
    errors: err.errors,
  };
}
