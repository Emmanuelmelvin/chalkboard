import {
  listDashboardRoomRatings,
  submitRoomSessionFeedback,
} from '@/services/feedback/feedback.service';
import { roomSessionFeedbackSchema } from '@/validators/feedback.validator';
import { APIError } from '@/utils/error';

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

export async function listDashboardRatingsHandler(c: any) {
  const user = c.get('user');
  if (!user) throw new APIError('unauthorized', 401);
  const feedback = await listDashboardRoomRatings(user.id);
  return c.json({ feedback });
}