// Runtime configuration, read once from environment variables.
// Secrets (DATABASE_URL, JWT_SECRET) are never committed; Render injects them.

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL,
  basePath: '/solar/v1',
  // One JSON access-log line per request; set LOG_REQUESTS=false to silence (tests do).
  logRequests: env.LOG_REQUESTS !== 'false',
  version: '1.0.0',
  jwt: {
    secret: env.JWT_SECRET,
    issuer: 'slsea-solar-api',
    audience: 'slsea-solar-api',
    userTtlSeconds: 60 * 60,
    deviceTtlSeconds: 60 * 60,
  },
};

export function assertRequiredConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.jwt.secret || config.jwt.secret.length < 32) missing.push('JWT_SECRET (min 32 chars)');
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}
