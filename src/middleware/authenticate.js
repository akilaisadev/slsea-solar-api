import { ApiError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

const REALM = 'slsea';

// Every request under the base path must carry a valid bearer token.
// 401 = "who are you?" (missing/invalid/expired token) and always carries a
// WWW-Authenticate challenge (RFC 6750); the client may retry with a token.
export function authenticate(req, res, next) {
  const [scheme, token] = (req.get('Authorization') ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new ApiError(40101, 'This resource requires a bearer token in the Authorization header.', {
      headers: { 'WWW-Authenticate': `Bearer realm="${REALM}"` },
    });
  }

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    const reason = err.name === 'TokenExpiredError' ? 'The access token has expired.' : 'The access token is invalid.';
    throw new ApiError(40102, reason, {
      headers: { 'WWW-Authenticate': `Bearer realm="${REALM}", error="invalid_token", error_description="${reason}"` },
    });
  }

  req.auth = {
    subject: claims.sub,
    role: claims.role,
    scopes: new Set(claims.scope.split(' ')),
    // Devices act for exactly one installation; users read within a jurisdiction.
    installationId: claims.role === 'device' ? claims.sub : null,
    jurisdiction: claims.role === 'device' ? null : {
      level: claims.jurisdiction.level,
      province_id: claims.jurisdiction.province_id,
      district_id: claims.jurisdiction.district_id,
    },
  };
  next();
}

// 403 = "I know who you are, and you may not do this" (RFC 6750
// insufficient_scope). This is what enforces the write-read split: device
// tokens hold only readings:write, user tokens never do.
export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.auth.scopes.has(scope)) {
      throw new ApiError(40301, `This operation requires the '${scope}' scope, which your token does not hold.`, {
        headers: { 'WWW-Authenticate': `Bearer realm="${REALM}", error="insufficient_scope", scope="${scope}"` },
      });
    }
    next();
  };
}
