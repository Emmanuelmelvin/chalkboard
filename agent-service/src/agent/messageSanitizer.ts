/**
 * @file messageSanitizer.ts
 * @description Sanitization and friendly error helpers for chat messages.
 */

export function sanitizeChatMessage(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^[\{\[]/.test(trimmed) && /[\}\]]$/.test(trimmed)) return null;
  if (/^(?:Invalid command|Traceback|node:internal|UnhandledPromiseRejection)/i.test(trimmed)) return null;
  return trimmed;
}

export function getFriendlyErrorMessage(displayName: string): string {
  const variations = [
    `I ran into a temporary hiccup while working on the chalkboard. Could you please ask again, ${displayName}?`,
    `Sorry ${displayName}, my connection to the board had a brief interruption. Please try asking once more!`,
    `I hit a slight bump while updating the classroom. Let me know what you'd like me to explain or draw next!`,
  ];
  return variations[Math.floor(Math.random() * variations.length)];
}
