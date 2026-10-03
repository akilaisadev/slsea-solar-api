import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Device secrets are 256-bit random values, so a fast SHA-256 digest is
// enough to store them safely (there is nothing to brute-force). Human
// passwords are low-entropy and use bcrypt instead (see the token endpoint).

export function generateDeviceSecret() {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

export function deviceSecretMatches(secret, storedHash) {
  const candidate = Buffer.from(hashDeviceSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
