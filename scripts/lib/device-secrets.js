import { createHmac } from 'node:crypto';

// Seeded devices get a secret derived from one master key, so the device
// simulator (which stands in for the whole fleet) can authenticate as any
// seeded installation without the secrets being stored anywhere. The API
// itself only ever holds SHA-256 hashes. Installations registered through
// POST /installations get a fresh random secret instead.
export function deriveDeviceSecret(masterKey, installationId) {
  return createHmac('sha256', masterKey).update(installationId).digest('base64url');
}
