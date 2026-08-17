import {
  createFeedbackSubmission,
  getFeedbackStats,
  listFeedbackSubmissions,
  listRoomSessionFeedback,
  submitRoomSessionFeedback,
  updateFeedbackStatus,
} from '@/services/feedback/feedback.service';
import {
  createFeedbackSchema,
  feedbackStatsQuerySchema,
  listFeedbackQuerySchema,
  roomSessionFeedbackSchema,
  updateFeedbackStatusSchema,
} from '@/validators/feedback.validator';
import { APIError } from '@/utils/error';

export async function createFeedbackHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const body = createFeedbackSchema.parse(await c.req.json().catch(() => ({})));
  const submission = await createFeedbackSubmission({
    userId: user.id,
    category: body.category,
    message: body.message,
    contactEmail: body.contactEmail || undefined,
  });
  return c.json({ submission }, 201);
}

export async function submitRoomSessionFeedbackHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const body = roomSessionFeedbackSchema.parse(await c.req.json().catch(() => ({})));
  const result = await submitRoomSessionFeedback({
    roomSlug: c.req.param('slug'),
    userId: user.id,
    rating: body.rating,
    note: body.note || undefined,
  });
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 403;
    throw new APIError(result.error, status);
  }
  return c.json({ ok: true, feedback: result.feedback });
}

export async function listFeedbackHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const query = listFeedbackQuerySchema.parse(c.req.query());
  const result = await listFeedbackSubmissions({
    status: query.status,
    category: query.category,
    actorRole: user.platformRole,
  });
  if (!result.ok) throw new APIError('forbidden', 403);
  return c.json({ submissions: result.submissions });
}

export async function updateFeedbackStatusHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  if (user.platformRole !== 'admin' && user.platformRole !== 'super_admin') {
    throw new APIError('forbidden', 403);
  }
  const body = updateFeedbackStatusSchema.parse(await c.req.json().catch(() => ({})));
  const result = await updateFeedbackStatus({
    feedbackId: c.req.param('id'),
    status: body.status,
    decidedById: user.id,
  });
  if (!result.ok) throw new APIError('not_found', 404);
  return c.json({ submission: result.submission });
}

export async function listRoomFeedbackHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  if (user.platformRole !== 'admin' && user.platformRole !== 'super_admin') {
    throw new APIError('forbidden', 403);
  }
  return c.json({ feedback: await listRoomSessionFeedback(user.platformRole) });
}

export async function feedbackStatsHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  if (user.platformRole !== 'admin' && user.platformRole !== 'super_admin') {
    throw new APIError('forbidden', 403);
  }
  const query = feedbackStatsQuerySchema.parse(c.req.query());
  // The validator only admits 7 / 30 / 90, so this cast is safe.
  const stats = await getFeedbackStats(query.days as 7 | 30 | 90, user.platformRole);
  if (!stats) throw new APIError('forbidden', 403);
  return c.json({ stats });
}