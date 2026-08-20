import { z } from 'zod';

export const roomSessionFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});