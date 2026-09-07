import { eq, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { APIError } from '@/utils/error';

export async function listAdmins() {
  return db.select({
    id: users.id,
    email: users.email,
    displayName: users.displayName,
    avatarUrl: users.avatarUrl,
    platformRole: users.platformRole,
    createdAt: users.createdAt,
  }).from(users).where(or(eq(users.platformRole, 'admin'), eq(users.platformRole, 'super_admin')));
}

export async function addAdminByEmail(email: string, role: 'admin' | 'super_admin') {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (!user) throw new APIError('user_must_sign_in_before_admin_access', 404);
  const [updated] = await db.update(users).set({ platformRole: role, updatedAt: new Date() }).where(eq(users.id, user.id)).returning();
  return updated;
}

export async function removeAdmin(userId: string, actorId: string) {
  if (userId === actorId) throw new APIError('cannot_remove_your_own_admin_access', 409);
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target || !['admin', 'super_admin'].includes(target.platformRole)) throw new APIError('admin_not_found', 404);
  if (target.platformRole === 'super_admin') throw new APIError('super_admin_requires_transfer', 409);
  const [updated] = await db.update(users).set({ platformRole: 'user', updatedAt: new Date() }).where(eq(users.id, userId)).returning();
  return updated;
}
