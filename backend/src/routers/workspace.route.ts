import { Hono } from 'hono';
import {
  acceptInviteHandler,
  createInviteHandler,
  getInviteHandler,
  getWorkspaceHandler,
  leaveWorkspaceHandler,
  removeWorkspaceMemberHandler,
  revokeInviteHandler,
} from '@/controllers/workspace.controller';
import { requireAuth } from '@/middlewares/auth.middleware';

/**
 * The shared workspace behind a Team plan. Everything here requires a session;
 * an invite token is not a capability, so the routes that read or accept an
 * invite sit behind the same guard and verify the signed-in email themselves.
 */
export const workspaceRouter = new Hono();

workspaceRouter.use('/', requireAuth);
workspaceRouter.use('/*', requireAuth);
workspaceRouter.get('/', getWorkspaceHandler);
workspaceRouter.post('/invites', createInviteHandler);
workspaceRouter.get('/invites/:token', getInviteHandler);
workspaceRouter.post('/invites/:token/accept', acceptInviteHandler);
workspaceRouter.post('/invites/:token/revoke', revokeInviteHandler);
workspaceRouter.delete('/members/:userId', removeWorkspaceMemberHandler);
workspaceRouter.post('/leave', leaveWorkspaceHandler);
