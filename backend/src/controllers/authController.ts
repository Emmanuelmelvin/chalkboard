import {
  authenticateRequest,
  clearAuthSession,
  setAuthSession,
  toPublicUser,
  upsertGoogleUser,
  verifyGoogleIdToken,
} from '@/services/auth';
import { googleAuthSchema } from '@/validators/roomValidators';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

export async function googleAuth(c: any) {
  c.header('Cache-Control', 'no-store');
  const { idToken } = googleAuthSchema.parse(await c.req.json());
  const user = await upsertGoogleUser(await verifyGoogleIdToken(idToken));
  setAuthSession(c, user.id);
  logger.info('Google auth completed', { userId: user.id, email: user.email });
  return c.json({ user: toPublicUser(user) });
}

export function googleAuthConfig(c: any) {
  return c.json({ clientId: env.GOOGLE_CLIENT_ID });
}

export async function currentUser(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user') || await authenticateRequest(c);
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user: toPublicUser(user) });
}

export function logout(c: any) {
  c.header('Cache-Control', 'no-store');
  clearAuthSession(c);
  return c.json({ ok: true });
}
