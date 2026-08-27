import { z } from 'zod';

export const agentInstructSchema = z.object({
  roomId: z.string().min(1, 'roomId is required'),
  prompt: z.string().min(1, 'prompt is required').max(4000, 'prompt is too long'),
  level: z.string().max(100).optional(),
  style: z.string().max(100).optional(),
});

export const agentStopSchema = z.object({
  roomId: z.string().min(1, 'roomId is required'),
});
