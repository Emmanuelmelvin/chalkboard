import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { db } from '@/db/client';
import { adminTwoFactor, users } from '@/db/schema';
import { authenticateRequest } from '@/services/auth';
import { env } from '@/config/env';
import { APIError } from '@/utils/error';

export const ADMIN_2FA_COOKIE = 'chalkboard_admin_2fa';
const ADMIN_2FA_TTL_SECONDS = 60 * 60 * 8;
const TOTP_STEP_SECONDS = 30;

function encryptionKey() {
  return createHash('sha256').update(`${env.AUTH_SESSION_SECRET}:admin-2fa`).digest();
}

function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted admin secret');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

function base32Encode(value: Buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totpForCounter(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

function safeCodeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyTotp(secret: string, code: string) {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  return [-1, 0, 1].some((offset) => safeCodeEqual(totpForCounter(secret, counter + offset), normalized));
}

function normalizeRecoveryCode(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function hashRecoveryCode(value: string) {
  return createHash('sha256').update(`${env.AUTH_SESSION_SECRET}:recovery:${normalizeRecoveryCode(value)}`).digest('base64url');
}

function createRecoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
}

function signAdminTwoFactorPayload(payload: string) {
  return createHmac('sha256', `${env.AUTH_SESSION_SECRET}:admin-2fa-session`).update(payload).digest('base64url');
}

function createAdminTwoFactorValue(userId: string) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${signAdminTwoFactorPayload(payload)}`;
}

function verifyAdminTwoFactorValue(value: string | undefined, userId: string) {
  if (!value) return false;
  const signatureStart = value.lastIndexOf('.');
  if (signatureStart <= 0) return false;
  const payload = value.slice(0, signatureStart);
  const signature = value.slice(signatureStart + 1);
  const expected = signAdminTwoFactorPayload(payload);
  if (!safeCodeEqual(signature, expected)) return false;
  const [payloadUserId, timestampValue] = payload.split('.');
  const timestamp = Number(timestampValue);
  return payloadUserId === userId && Number.isFinite(timestamp) && Date.now() - timestamp <= ADMIN_2FA_TTL_SECONDS * 1000;
}

export function setAdminTwoFactorSession(c: any, userId: string) {
  setCookie(c, ADMIN_2FA_COOKIE, createAdminTwoFactorValue(userId), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_2FA_TTL_SECONDS,
  });
}

export function clearAdminTwoFactorSession(c: any) {
  deleteCookie(c, ADMIN_2FA_COOKIE, { path: '/' });
}

export function isAdminRole(role: string | undefined) {
  return role === 'admin' || role === 'super_admin';
}

export async function getAdminAccessState(userId: string) {
  const [record] = await db.select({ enabled: adminTwoFactor.enabled }).from(adminTwoFactor)
    .where(eq(adminTwoFactor.userId, userId))
    .limit(1);
  return { twoFactorEnabled: record?.enabled ?? false };
}

export async function beginAdminTwoFactorSetup(user: typeof users.$inferSelect) {
  const current = await db.select().from(adminTwoFactor).where(eq(adminTwoFactor.userId, user.id)).limit(1);
  if (current[0]?.enabled) throw new APIError('admin_2fa_already_enabled', 409);

  const secret = base32Encode(randomBytes(20));
  const values = {
    userId: user.id,
    secretCiphertext: encryptSecret(secret),
    recoveryCodeHashes: [] as string[],
    enabled: false,
    updatedAt: new Date(),
  };
  if (current[0]) {
    await db.update(adminTwoFactor).set(values).where(eq(adminTwoFactor.userId, user.id));
  } else {
    await db.insert(adminTwoFactor).values(values);
  }
  const label = encodeURIComponent(`Chalkboard:${user.email}`);
  const issuer = encodeURIComponent('Chalkboard');
  return { secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}` };
}

export async function verifyAdminTwoFactor(userId: string, code: string) {
  const [record] = await db.select().from(adminTwoFactor).where(eq(adminTwoFactor.userId, userId)).limit(1);
  if (!record) throw new APIError('admin_2fa_setup_required', 409);
  const secret = decryptSecret(record.secretCiphertext);
  const isTotpValid = verifyTotp(secret, code);
  const normalizedRecoveryCode = normalizeRecoveryCode(code);
  const recoveryHash = hashRecoveryCode(normalizedRecoveryCode);
  const recoveryIndex = record.recoveryCodeHashes.findIndex((value) => safeCodeEqual(value, recoveryHash));
  if (!isTotpValid && recoveryIndex < 0) throw new APIError('invalid_admin_2fa_code', 401);

  if (!record.enabled) {
    const recoveryCodes = createRecoveryCodes();
    await db.update(adminTwoFactor).set({ enabled: true, recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode), updatedAt: new Date() }).where(eq(adminTwoFactor.userId, userId));
    return { recoveryCodes };
  }

  if (recoveryIndex >= 0) {
    const remainingCodes = record.recoveryCodeHashes.filter((_, index) => index !== recoveryIndex);
    await db.update(adminTwoFactor).set({ recoveryCodeHashes: remainingCodes, updatedAt: new Date() }).where(eq(adminTwoFactor.userId, userId));
  }
  return { recoveryCodes: [] };
}

export async function requireAdminIdentity(c: any, next: () => Promise<void>) {
  const user = await authenticateRequest(c);
  if (!user) throw new APIError('unauthorized', 401);
  if (!isAdminRole(user.platformRole)) throw new APIError('admin_access_required', 403);
  c.set('user', user);
  await next();
}

export async function requireAdmin(c: any, next: () => Promise<void>) {
  await requireAdminIdentity(c, async () => {
    const user = c.get('user');
    if (!verifyAdminTwoFactorValue(getCookie(c, ADMIN_2FA_COOKIE), user.id)) {
      throw new APIError('admin_2fa_required', 428);
    }
    await next();
  });
}

export async function requireSuperAdmin(c: any, next: () => Promise<void>) {
  await requireAdmin(c, async () => {
    if (c.get('user').platformRole !== 'super_admin') throw new APIError('super_admin_access_required', 403);
    await next();
  });
}

export function hasAdminTwoFactorSession(c: any, userId: string) {
  return verifyAdminTwoFactorValue(getCookie(c, ADMIN_2FA_COOKIE), userId);
}
