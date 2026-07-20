export const roomThemes = [
  {
    id: 'classroom',
    label: 'Classroom',
    description: 'Deep slate green with warm white chalk and a quiet, nostalgic feel.',
  },
  {
    id: 'workshop',
    label: 'Workshop',
    description: 'Industrial dark grey with high-contrast yellow, white, and blueprint lines.',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    description: 'Charcoal black with electric pink, cyan, and yellow bursts.',
  },
  {
    id: 'meeting',
    label: 'Meeting',
    description: 'Graphite grey with a minimal palette and one calm accent.',
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Muted navy with crisp white chalk and faint planning grids.',
  },
  {
    id: 'studio',
    label: 'Studio',
    description: 'Warm terracotta with soft amber chalk and a tactile grain.',
  },
] as const;

export type RoomTheme = typeof roomThemes[number]['id'];

export function isRoomTheme(value: unknown): value is RoomTheme {
  return roomThemes.some((theme) => theme.id === value);
}

export function getRoomThemeLabel(value: RoomTheme) {
  return roomThemes.find((theme) => theme.id === value)?.label || 'Classroom';
}
