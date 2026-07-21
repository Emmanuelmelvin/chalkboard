import { z } from 'zod';

const pluginIdSchema = z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Plugin IDs may use lowercase letters, numbers, dots, and hyphens.');
const versionSchema = z.string().trim().min(1).max(40).regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Use a semantic version such as 1.0.0.');
const logoDataUrlSchema = z.string().max(400_000).regex(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG, JPEG, WebP, or SVG image.').optional().or(z.literal(''));
const manifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().trim().min(1).max(120),
  version: versionSchema,
  description: z.string().trim().max(1000).optional(),
  author: z.string().trim().max(160).optional(),
  permissions: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  contributes: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export const createPluginSchema = z.object({
  pluginId: pluginIdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  logoDataUrl: logoDataUrlSchema,
  plan: z.enum(['free', 'pro']).default('free'),
  version: versionSchema,
  manifest: manifestSchema,
  changelog: z.string().trim().max(2000).optional(),
  entryUrl: z.string().trim().url().max(1000).optional().or(z.literal('')),
});

export const createPluginVersionSchema = z.object({
  version: versionSchema,
  manifest: manifestSchema,
  changelog: z.string().trim().max(2000).optional(),
  entryUrl: z.string().trim().url().max(1000).optional().or(z.literal('')),
});

export const pluginReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'suspended']),
  notes: z.string().trim().max(2000).optional(),
});
