import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { allowOnly } from '../middleware/allow.js';
import { requireBodyType } from '../middleware/negotiate.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { deviceSecretMatches } from '../lib/credentials.js';
import { SCOPES, issueDeviceToken, issueUserToken } from '../lib/tokens.js';
import { findDeviceCredential, findUserByUsername } from '../repositories/principals.js';

// POST /oauth2/token: issues JWT bearer tokens, modelled on the OAuth 2.0
// token endpoint (RFC 6749). It sits outside /solar/v1 because issuing
// credentials is the authorisation server's job, not a resource of the
// generation API. A token is not a stored resource, so success is 200
// (RFC 6749 §5.1), not 201.
//   Devices: grant_type=client_credentials, client_id=<installation-id>
//   Users:   grant_type=password, username, password
export const oauthRouter = Router();

// A real bcrypt hash of a random string, compared against when the username
// does not exist, so unknown and known usernames take the same time and the
// response time does not reveal which usernames exist.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

const tokenRequest = z.object({
  grant_type: z.string(),
  scope: z.string().optional(),
  client_id: z.string().max(100).optional(),
  client_secret: z.string().max(200).optional(),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
});

// Brute-force protection: failed attempts are counted per credential
// (installation or username), so one client's mistakes never lock out
// another, and successful requests are not counted at all.
const failedAttemptsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `credential:${req.body?.client_id ?? req.body?.username ?? 'anonymous'}`,
  handler: (req, res, next) => next(new ApiError(42901, 'Too many failed token requests for this credential. Try again later.')),
});

// RFC 6749 §2.3.1 lets a client send its credentials as HTTP Basic instead
// of in the body (Swagger UI does this for the client-credentials flow).
function basicClientCredentials(req) {
  const [scheme, encoded] = (req.get('Authorization') ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return null;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return {
    client_id: decodeURIComponent(decoded.slice(0, separator)),
    client_secret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}

// Grants the requested scopes if every one is allowed; no request = all allowed.
function grantedScopes(requested, allowed) {
  if (!requested) return allowed;
  const wanted = requested.split(' ').filter(Boolean);
  const refused = wanted.filter((scope) => !allowed.includes(scope));
  if (refused.length) {
    throw new ApiError(40005, `Scope not permitted for this client: ${refused.join(', ')}.`);
  }
  return wanted;
}

function invalidCredentials() {
  return new ApiError(40103, 'The credentials are invalid.', {
    headers: { 'WWW-Authenticate': 'Basic realm="slsea-oauth2"' },
  });
}

async function deviceToken(db, body) {
  if (!body.client_id || !body.client_secret) {
    throw new ApiError(40002, 'client_credentials requires client_id and client_secret.', {
      errors: [{ code: 40002, field: 'client_id, client_secret', message: 'are required for grant_type=client_credentials' }],
    });
  }
  const device = await findDeviceCredential(db, body.client_id);
  const valid = device && device.status !== 'decommissioned'
    && deviceSecretMatches(body.client_secret, device.device_secret_hash);
  if (!valid) throw invalidCredentials();
  return issueDeviceToken(device.installation_id, grantedScopes(body.scope, SCOPES.device));
}

async function userToken(db, body) {
  if (!body.username || !body.password) {
    throw new ApiError(40002, 'password grant requires username and password.', {
      errors: [{ code: 40002, field: 'username, password', message: 'are required for grant_type=password' }],
    });
  }
  const user = await findUserByUsername(db, body.username);
  const passwordOk = await bcrypt.compare(body.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !passwordOk) throw invalidCredentials();
  return issueUserToken(user, grantedScopes(body.scope, SCOPES[user.role]));
}

oauthRouter.route('/token')
  .post(
    requireBodyType('application/x-www-form-urlencoded', 'application/json'),
    express.urlencoded({ extended: false, limit: '10kb' }),
    (req, res, next) => {
      // Merge Basic client credentials into the body before rate limiting,
      // so attempts are counted against the right client_id.
      const basic = basicClientCredentials(req);
      if (basic) req.body = { ...req.body, ...basic };
      next();
    },
    failedAttemptsLimiter,
    async (req, res) => {
      const body = parseBody(tokenRequest, req);
      const db = req.app.locals.db;
      let token;
      if (body.grant_type === 'client_credentials') token = await deviceToken(db, body);
      else if (body.grant_type === 'password') token = await userToken(db, body);
      else throw new ApiError(40004, `grant_type '${body.grant_type}' is not supported.`);
      // RFC 6749 §5.1: token responses must never be cached.
      res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
      res.json(token);
    },
  )
  .all(allowOnly('POST'));
