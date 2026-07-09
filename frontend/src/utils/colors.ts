// Custom function to convert hex color to rgba for transparency
export function addAlpha(hex: string, alpha: number): string {
  let c = hex.substring(1);
  if (c.length === 3) {
    c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Generate a random chalk color for a user's cursor
export const CURSOR_COLORS = ['#fff3a1', '#a3e5ff', '#ffa3d1', '#a3ffd6', '#ffffff'];
export const getRandomColor = () => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
