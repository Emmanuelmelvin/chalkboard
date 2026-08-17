import { z } from 'zod';

export const createFeedbackSchema = z.object({
  category: z.enum(['bug_report', 'feature_request', 'general']).default('general'),
  message: z.string().trim().min(1).max(2000),
  contactEmail: z.string().trim().email().max(254).optional().or(z.literal('')),
});

export const roomSessionFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(['acknowledged', 'resolved', 'closed']),
});

export const listFeedbackQuerySchema = z.object({
  status: z.enum(['new', 'acknowledged', 'resolved', 'closed']).optional(),
  category: z.enum(['bug_report', 'feature_request', 'general']).optional(),
});