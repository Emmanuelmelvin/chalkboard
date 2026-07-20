import { z } from 'zod';

export const createRoomSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(3),
  accessMode: z.enum(['open', 'approval_required', 'password_protected']).default('open'),
  password: z.string().optional(),
  maxAttendees: z.number().int().positive().optional(),
  voiceEnabled: z.boolean().default(false),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});
