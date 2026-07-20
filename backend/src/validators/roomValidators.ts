import { z } from 'zod';

export const createRoomSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(3),
  description: z.string().max(280).optional(),
  accessMode: z.enum(['open', 'approval_required', 'password_protected']).default('password_protected'),
  theme: z.enum(['classroom', 'workshop', 'brainstorm', 'meeting', 'planning', 'studio']).default('classroom'),
  password: z.string().optional(),
  maxAttendees: z.number().int().positive().optional(),
  voiceEnabled: z.boolean().default(false),
});

export const joinRoomSchema = z.object({
  password: z.string().max(256).optional(),
});

export const roomPasswordSchema = z.object({
  password: z.string().trim().min(1).max(256).optional(),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});
