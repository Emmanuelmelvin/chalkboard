import { createHmac, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';
import { APIError } from '@/utils/error';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
export const AUTH_SESSION_COOKIE = 'chalkboard_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export function toPublicUser(user): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
  };
}

export async function verifyGoogleIdToken(idToken) {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified === false) {
    logger.warn('Google token missing subject or email');
    throw new APIError('invalid_google_token', 401);
  }
  return {
    googleSub: payload.sub,
    email: payload.email,
    displayName: payload.name || payload.email.split('@')[0],
    avatarUrl: payload.picture,
  };
}

export async function upsertGoogleUser(profile) {
  const [existing] = await db.select().from(users).where(eq(users.googleSub, profile.googleSub)).limit(1);
  if (existing) {
    const [updated] = await db.update(users).set({ email: profile.email, displayName: profile.displayName, avatarUrl: profile.avatarUrl, updatedAt: new Date() }).where(eq(users.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(users).values(profile).returning();
  return created;
}

function signSessionPayload(payload: string) {
  return createHmac('sha256', env.AUTH_SESSION_SECRET).update(payload).digest('base64url');
}

function createSessionValue(userId: string) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${signSessionPayload(payload)}`;
}

function verifySessionValue(value?: string | null) {
  if (!value) return null;
  const signatureStart = value.lastIndexOf('.');
  if (signatureStart <= 0) return null;

  const payload = value.slice(0, signatureStart);
  const signature = value.slice(signatureStart + 1);
  const expected = signSessionPayload(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  const timestamp = Number(payload.slice(payload.lastIndexOf('.') + 1));
  const userId = payload.slice(0, payload.lastIndexOf('.'));
  if (!userId || !Number.isFinite(timestamp) || Date.now() - timestamp > SESSION_TTL_MS) return null;
  return userId;
}

export function setAuthSession(c, userId: string) {
  setCookie(c, AUTH_SESSION_COOKIE, createSessionValue(userId), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearAuthSession(c) {
  deleteCookie(c, AUTH_SESSION_COOKIE, { path: '/' });
}

function readCookieHeader(cookieHeader?: string) {
  const entry = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_SESSION_COOKIE}=`));
  return entry?.slice(AUTH_SESSION_COOKIE.length + 1) || null;
}

async function getUserById(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function authenticateSession(c) {
  const userId = verifySessionValue(getCookie(c, AUTH_SESSION_COOKIE));
  return userId ? getUserById(userId) : null;
}

export async function authenticateSocketSession(cookieHeader?: string) {
  const userId = verifySessionValue(readCookieHeader(cookieHeader));
  return userId ? getUserById(userId) : null;
}

export async function authenticateRequest(c) {
  const sessionUser = await authenticateSession(c);
  if (sessionUser) return sessionUser;
  return authenticateBearer(c);
}

export async function authenticateBearer(c) {
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const profile = await verifyGoogleIdToken(token);
  return upsertGoogleUser(profile);
}
