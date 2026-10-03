import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// JWT bearer access tokens (WSO2 §12.2). HS256 is pinned on both signing
// and verification so a token cannot choose its own algorithm ("alg":
// "none" or an RS/HS confusion attack is rejected by verify()).
const ALGORITHM = 'HS256';

// Scopes say WHAT a client may do. WHERE a user may read is carried
// separately as the jurisdiction claim and enforced on every query.
export const SCOPES = {
  device: ['readings:write'],
  analyst: ['assets:read', 'readings:read'],
  asset_admin: ['assets:read', 'readings:read', 'installations:write'],
};

export function issueDeviceToken(installationId, scopes) {
  return sign({ sub: installationId, role: 'device', scope: scopes.join(' ') }, config.jwt.deviceTtlSeconds);
}

export function issueUserToken(user, scopes) {
  return sign({
    sub: user.user_id,
    username: user.username,
    role: user.role,
    scope: scopes.join(' '),
    // District users also carry their district's province, so the province
    // above them can be shown without another lookup.
    jurisdiction: {
      level: user.jurisdiction_level,
      province_id: user.province_id ?? undefined,
      district_id: user.district_id ?? undefined,
    },
  }, config.jwt.userTtlSeconds);
}

function sign(claims, ttlSeconds) {
  const accessToken = jwt.sign(claims, config.jwt.secret, {
    algorithm: ALGORITHM,
    expiresIn: ttlSeconds,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  return { access_token: accessToken, token_type: 'Bearer', expires_in: ttlSeconds, scope: claims.scope };
}

// Throws (jsonwebtoken error) if the signature, algorithm, issuer,
// audience or expiry is wrong.
export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: [ALGORITHM],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}
