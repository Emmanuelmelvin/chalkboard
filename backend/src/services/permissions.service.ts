export const instructorTier = new Set(['owner', 'instructor']);
export function canManage(role) { return instructorTier.has(role); }
export function canPublishVoice(role) { return instructorTier.has(role); }
