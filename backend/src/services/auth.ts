import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export async function verifyGoogleIdToken(idToken) {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    logger.warn('Google token missing subject or email');
    throw new Error('Google token missing subject or email');
  }
  return {
    googleSub: payload.sub,
    email: payload.email,
    displayName: payload.name || payload.email.split('@')[0],
    avatarUrl: payload.picture,
  };
}

export async function upsertGoogleUser(profile) {
  if (!db) return { id: `dev-${profile.googleSub}`, ...profile };
  const [existing] = await db.select().from(users).where(eq(users.googleSub, profile.googleSub)).limit(1);
  if (existing) {
    const [updated] = await db.update(users).set({ email: profile.email, displayName: profile.displayName, avatarUrl: profile.avatarUrl, updatedAt: new Date() }).where(eq(users.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(users).values(profile).returning();
  return created;
}

export async function authenticateBearer(c) {
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const profile = await verifyGoogleIdToken(token);
  return upsertGoogleUser(profile);
}
