import { Hono } from 'hono';
import {
  createFeedbackHandler,
  submitRoomSessionFeedbackHandler,
} from '@/controllers/feedback.controller';
import { requireAuth } from '@/middlewares/auth.middleware';
import { feedbackRateLimit } from '@/middlewares/rateLimit.middleware';

export const feedbackRouter = new Hono();

feedbackRouter.use('/', requireAuth);
feedbackRouter.use('/*', requireAuth);

feedbackRouter.post('/', feedbackRateLimit, createFeedbackHandler);
feedbackRouter.post('/room/:slug', feedbackRateLimit, submitRoomSessionFeedbackHandler);