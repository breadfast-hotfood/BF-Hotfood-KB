// Turns a sheet name into a safe single-line tab label.
// Sheet names that came from Excel can contain line breaks, tabs, non-breaking or invisible characters;
// a tab must always be ONE line, so every run of such characters becomes a single space.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const WHITESPACE_RUN = /[\s\u0085\u000B\u000C\u2028\u2029\u00A0]+/g;

export function tabLabel(name: unknown, index: number): string {
  const raw = typeof name === 'string' ? name : name == null ? '' : String(name);
  const clean = raw.replace(INVISIBLE, '').replace(WHITESPACE_RUN, ' ').trim();
  return clean || `Sheet ${index + 1}`;
}
