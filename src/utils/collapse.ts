// Decides whether a long field value should start collapsed in the case drawer.
// Collapsed when ANY of these is exceeded: characters, words, or lines.
export const COLLAPSE_MAX_CHARS = 600;
export const COLLAPSE_MAX_WORDS = 120;
export const COLLAPSE_MAX_LINES = 12;

export function shouldCollapse(text: string): boolean {
  if (!text) return false;
  const s = String(text);
  if (s.length > COLLAPSE_MAX_CHARS) return true;
  const trimmed = s.trim();
  if (!trimmed) return false;
  // Words: whitespace-separated runs (works for Arabic and English alike).
  if (trimmed.split(/\s+/).length > COLLAPSE_MAX_WORDS) return true;
  // Lines: every line break counts, blank lines included (they take space on screen).
  if (trimmed.split(/\r\n|\r|\n/).length > COLLAPSE_MAX_LINES) return true;
  return false;
}
