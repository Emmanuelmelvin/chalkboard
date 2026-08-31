/**
 * @file reactions.ts
 * @description Centralized room interaction constants — single source of truth for reactions and hand interactions.
 * Import from here instead of redefining literals in components or tools.
 */

export const REACTION_EMOJIS = ['👍', '👏', '😂', '😮', '❤️', '🎉'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Custom event name for interactive reaction picker animation via WebMCP tool */
export const REACTION_PICKER_EVENT = 'chalkboard:reaction-picker' as const;

export function isReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}
