import { Hono } from 'hono';
import { currentUser, googleAuth, googleAuthConfig, logout } from '@/controllers/authController';
import { addAdminHandler, adminSessionHandler, adminTwoFactorLogoutHandler, adminTwoFactorSetupHandler, adminTwoFactorVerifyHandler, listAdminsHandler, removeAdminHandler } from '@/controllers/adminController';
import { createMyPluginHandler, createMyPluginVersionHandler, getMyPluginHandler, listAdminPluginsHandler, listMyPluginsHandler, getAdminPluginHandler, listPublishedPluginsHandler, publishAdminPluginHandler, removeAdminPluginFromRegistryHandler, reviewAdminPluginHandler, submitMyPluginHandler } from '@/controllers/pluginController';
import { approveJoinRequestHandler, createRoomHandler, deleteRoomHandler, denyJoinRequestHandler, getRoomHandler, joinRoomHandler, listJoinRequestsHandler, listRoomsHandler, resetRoomPasswordHandler, updateRoomHandler, updateRoomMemberRoleHandler, voiceTokenHandler } from '@/controllers/roomController';
import { requireAuth } from '@/middlewares/auth';
import { requireAdmin, requireSuperAdmin } from '@/services/adminAuth';
import { inviteJoinRateLimit } from '@/middlewares/rateLimit';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true }));
api.get('/auth/google/config', googleAuthConfig);
api.post('/auth/google', googleAuth);
api.get('/auth/me', currentUser);
api.post('/auth/logout', logout);

api.use('/plugins', requireAuth);
api.use('/plugins/*', requireAuth);
api.get('/plugins/mine', listMyPluginsHandler);
api.get('/plugins/catalog', listPublishedPluginsHandler);
api.post('/plugins', createMyPluginHandler);
api.get('/plugins/:pluginId', getMyPluginHandler);
api.post('/plugins/:pluginId/versions', createMyPluginVersionHandler);
api.post('/plugins/:pluginId/submit', submitMyPluginHandler);

api.get('/admin/session', adminSessionHandler);
api.post('/admin/2fa/setup', adminTwoFactorSetupHandler);
api.post('/admin/2fa/verify', adminTwoFactorVerifyHandler);
api.post('/admin/2fa/logout', adminTwoFactorLogoutHandler);
api.get('/admin/admins', requireAdmin, listAdminsHandler);
api.post('/admin/admins', requireSuperAdmin, addAdminHandler);
api.delete('/admin/admins/:userId', requireSuperAdmin, removeAdminHandler);
api.use('/admin/plugins', requireAdmin);
api.use('/admin/plugins/*', requireAdmin);
api.get('/admin/plugins', listAdminPluginsHandler);
api.get('/admin/plugins/:pluginId', getAdminPluginHandler);
api.post('/admin/plugins/:pluginId/review', reviewAdminPluginHandler);
api.post('/admin/plugins/:pluginId/publish', publishAdminPluginHandler);
api.delete('/admin/plugins/:pluginId/registry', removeAdminPluginFromRegistryHandler);

api.use('/rooms', requireAuth);
api.use('/rooms/*', requireAuth);
api.get('/rooms', listRoomsHandler);
api.post('/rooms', createRoomHandler);
api.post('/rooms/:slug/join', joinRoomHandler);
api.get('/rooms/:slug/join-requests', listJoinRequestsHandler);
api.post('/rooms/:slug/join-requests/:userId/approve', approveJoinRequestHandler);
api.post('/rooms/:slug/join-requests/:userId/deny', denyJoinRequestHandler);
api.post('/rooms/:slug/password', resetRoomPasswordHandler);
api.patch('/rooms/:slug/members/:userId', updateRoomMemberRoleHandler);
api.get('/rooms/:slug', inviteJoinRateLimit, getRoomHandler);
api.delete('/rooms/:slug', deleteRoomHandler);
api.patch('/rooms/:slug', updateRoomHandler);
api.post('/rooms/:slug/voice-token', inviteJoinRateLimit, voiceTokenHandler);
