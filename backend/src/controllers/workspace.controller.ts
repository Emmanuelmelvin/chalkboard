import {
  acceptInvite,
  createInvite,
  getInviteView,
  getWorkspaceView,
  leaveWorkspace,
  removeMember,
  revokeInvite,
} from '@/services/billing/workspaces.service';
import { APIError } from '@/utils/error';

/**
 * Workspace endpoints. Every state-changing action is re-checked server-side
 * (plan, ownership, seat cap, email match) rather than trusted from the
 * client: these routes are where a Team plan actually seats people.
 */

export async function getWorkspaceHandler(c: any) {
  c.header('Cache-Control', 'no-store');
  const user = c.get('user');
  return c.json({ workspace: await getWorkspaceView(user.id) });
}

export async function createInviteHandler(c: any) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const invite = await createInvite(user.id, String(body?.email ?? ''));
  return c.json({ invite }, 201);
}

/** What the accept page may render before the user decides. */
export async function getInviteHandler(c: any) {
  c.header('Cache-Control', 'no-store');
  const view = await getInviteView(c.req.param('token') ?? '');
  if (!view) throw new APIError('invite_not_found', 404);
  return c.json(view);
}

export async function acceptInviteHandler(c: any) {
  const user = c.get('user');
  const workspace = await acceptInvite(user.id, c.req.param('token') ?? '');
  return c.json({ ok: true, workspace });
}

export async function revokeInviteHandler(c: any) {
  const user = c.get('user');
  await revokeInvite(user.id, c.req.param('token') ?? '');
  return c.json({ ok: true });
}

export async function removeWorkspaceMemberHandler(c: any) {
  const user = c.get('user');
  await removeMember(user.id, c.req.param('userId') ?? '');
  return c.json({ ok: true });
}

/** A member frees their own seat. The owner cannot leave; they own the plan. */
export async function leaveWorkspaceHandler(c: any) {
  const user = c.get('user');
  await leaveWorkspace(user.id);
  return c.json({ ok: true });
}
