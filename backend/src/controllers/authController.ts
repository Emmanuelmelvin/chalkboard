import { upsertGoogleUser, verifyGoogleIdToken } from '@/services/auth';
import { googleAuthSchema } from '@/validators/roomValidators';
import { logger } from '@/utils/logger';

export async function googleAuth(c: any) {
  const { idToken } = googleAuthSchema.parse(await c.req.json());
  const user = await upsertGoogleUser(await verifyGoogleIdToken(idToken));
  logger.info('Google auth completed', { userId: user.id, email: user.email });
  return c.json({ user });
}
