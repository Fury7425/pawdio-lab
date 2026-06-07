/**
 * Deterministic, theme-independent palette for overlaying multiple devices.
 * Mid lightness/saturation so each curve stays legible on dark and light.
 */
const COMPARE_HUES = [210, 18, 150, 280, 45, 190, 320, 95];

export function compareColor(index: number): string {
  const hue = COMPARE_HUES[index % COMPARE_HUES.length];
  return `hsl(${hue}, 70%, 55%)`;
}
