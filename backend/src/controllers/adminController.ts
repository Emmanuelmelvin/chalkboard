import { z } from 'zod';
import { addAdminByEmail, listAdmins, removeAdmin } from '@/services/admins';
import { beginAdminTwoFactorSetup, clearAdminTwoFactorSession, getAdminAccessState, hasAdminTwoFactorSession, requireAdminIdentity, setAdminTwoFactorSession, verifyAdminTwoFactor } from '@/services/adminAuth';
import { APIError } from '@/utils/error';

const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
const addAdminSchema = z.object({ email: z.string().trim().email(), role: z.enum(['admin', 'super_admin']).default('admin') });

export async function adminSessionHandler(c: any) {
  await requireAdminIdentity(c, async () => undefined);
  const user = c.get('user');
  const access = await getAdminAccessState(user.id);
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      platformRole: user.platformRole,
    },
    twoFactorEnabled: access.twoFactorEnabled,
    twoFactorVerified: access.twoFactorEnabled && hasAdminTwoFactorSession(c, user.id),
  });
}

export async function adminTwoFactorSetupHandler(c: any) {
  await requireAdminIdentity(c, async () => undefined);
  const user = c.get('user');
  return c.json(await beginAdminTwoFactorSetup(user));
}

export async function adminTwoFactorVerifyHandler(c: any) {
  await requireAdminIdentity(c, async () => undefined);
  const { code } = twoFactorCodeSchema.parse(await c.req.json());
  const user = c.get('user');
  const result = await verifyAdminTwoFactor(user.id, code);
  setAdminTwoFactorSession(c, user.id);
  return c.json({ ok: true, recoveryCodes: result.recoveryCodes });
}

export async function adminTwoFactorLogoutHandler(c: any) {
  clearAdminTwoFactorSession(c);
  return c.json({ ok: true });
}

export async function listAdminsHandler(c: any) {
  return c.json({ admins: await listAdmins() });
}

export async function addAdminHandler(c: any) {
  const input = addAdminSchema.parse(await c.req.json());
  const user = await addAdminByEmail(input.email, input.role);
  return c.json({ admin: user }, 201);
}

export async function removeAdminHandler(c: any) {
  const user = c.get('user');
  await removeAdmin(c.req.param('userId'), user.id);
  return c.json({ ok: true });
}

export async function requireAdminAction(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  return user;
}
