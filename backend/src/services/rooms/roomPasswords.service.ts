import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '@/config/env';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const CIPHER_KEY = createHash('sha256').update(env.AUTH_SESSION_SECRET).digest();

/** Encrypt a room password for owner-only display in the dashboard. */
export function encryptRoomPassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, CIPHER_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((value) => value.toString('base64url')).join('.');
}

/** Decrypt a stored room password, returning null if it cannot be recovered. */
export function decryptRoomPassword(value?: string | null) {
  if (!value) return null;
  const [ivValue, authTagValue, ciphertextValue] = value.split('.');
  if (!ivValue || !authTagValue || !ciphertextValue) return null;

  try {
    const decipher = createDecipheriv(
      CIPHER_ALGORITHM,
      CIPHER_KEY,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
