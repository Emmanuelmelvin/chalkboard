import { Hono } from 'hono';
import {
  approveJoinRequestHandler,
  createRoomHandler,
  deleteRoomHandler,
  denyJoinRequestHandler,
  getRoomHandler,
  joinRoomHandler,
  listJoinRequestsHandler,
  listRoomsHandler,
  resetRoomPasswordHandler,
  updateRoomHandler,
  updateRoomMemberRoleHandler,
  voiceTokenHandler,
} from '@/controllers/room.controller';
import { requireAuth } from '@/middlewares/auth.middleware';
import { inviteJoinRateLimit, roomPasswordRateLimit } from '@/middlewares/rateLimit.middleware';

export const roomRouter = new Hono();

roomRouter.use('/', requireAuth);
roomRouter.use('/*', requireAuth);

roomRouter.get('/', listRoomsHandler);
roomRouter.post('/', createRoomHandler);
// Join accepts the room password, so it needs the password-guessing limiter
// rather than the looser invite limiter.
roomRouter.post('/:slug/join', roomPasswordRateLimit, joinRoomHandler);
roomRouter.get('/:slug/join-requests', listJoinRequestsHandler);
roomRouter.post('/:slug/join-requests/:userId/approve', approveJoinRequestHandler);
roomRouter.post('/:slug/join-requests/:userId/deny', denyJoinRequestHandler);
roomRouter.post('/:slug/password', roomPasswordRateLimit, resetRoomPasswordHandler);
roomRouter.patch('/:slug/members/:userId', updateRoomMemberRoleHandler);
roomRouter.get('/:slug', inviteJoinRateLimit, getRoomHandler);
roomRouter.delete('/:slug', deleteRoomHandler);
roomRouter.patch('/:slug', updateRoomHandler);
roomRouter.post('/:slug/voice-token', inviteJoinRateLimit, voiceTokenHandler);
