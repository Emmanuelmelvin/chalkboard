export const roomThemes = [
  {
    id: 'classroom',
    label: 'Classroom',
    description: 'Focused, familiar, and chalkboard green.',
  },
  {
    id: 'workshop',
    label: 'Workshop',
    description: 'Warm, practical, and built for making.',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    description: 'Energetic color for loose, fast ideas.',
  },
  {
    id: 'meeting',
    label: 'Meeting',
    description: 'Clear, calm, and easy to scan together.',
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Structured, balanced, and ready for next steps.',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'Quiet and neutral for visual exploration.',
  },
] as const;

export type RoomTheme = typeof roomThemes[number]['id'];

export function isRoomTheme(value: unknown): value is RoomTheme {
  return roomThemes.some((theme) => theme.id === value);
}

export function getRoomThemeLabel(value: RoomTheme) {
  return roomThemes.find((theme) => theme.id === value)?.label || 'Classroom';
}
