import {
  authenticateRequest,
  clearAuthSession,
  setAuthSession,
  toPublicUser,
  upsertGoogleUser,
  verifyGoogleIdToken,
} from '@/services/auth/auth.service';
import { googleAuthSchema } from '@/validators/room.validator';
import { ZodError } from 'zod';
import { failed, metricNames, timed } from '@/utils/metrics';
import { logger } from '@/utils/logger';
import { env } from '@/config/env';

export async function googleAuth(c: any) {
  c.header('Cache-Control', 'no-store');
  try {
    const { idToken } = googleAuthSchema.parse(await c.req.json());
    const profile = await verifyGoogleIdToken(idToken);
    const user = await timed(metricNames.authLoginDuration, () => upsertGoogleUser(profile), { provider: 'google' });
    setAuthSession(c, user.id);
    logger.info('Google auth completed', { userId: user.id, email: user.email });
    return c.json({ user: await toPublicUser(user) });
  } catch (error) {
    failed(metricNames.authLogin, {
      provider: 'google',
      reason: error instanceof ZodError ? 'invalid_payload' : 'unknown',
    });
    throw error;
  }
}


export function googleAuthConfig(c: any) {
  return c.json({ clientId: env.GOOGLE_CLIENT_ID });
}

export async function currentUser(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user') || await authenticateRequest(c);
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user: await toPublicUser(user) });

}

export function logout(c: any) {
  c.header('Cache-Control', 'no-store');
  clearAuthSession(c);
  return c.json({ ok: true });
}
