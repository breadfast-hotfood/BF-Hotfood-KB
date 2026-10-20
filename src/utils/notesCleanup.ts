/**
 * Older imports generated one extra "note" from stray text on a category divider row, in the exact format
 * "<Section name> › <Column name>: <text>". That line is not a real note. This removes ONLY notes of that exact generated
 * shape whose section is a real section of the tab AND whose column is a real column of the tab, so it also fixes
 * versions that were published before the importer was corrected. Every other note is returned unchanged.
 */
export interface NotesTabLike {
  kb?: {
    importantNotes?: string[];
    fieldOrder?: { key: string }[];
    records?: { _section?: string }[];
  };
}

const GENERATED = /^([^\n]+?) › ([^\n]+?): ([\s\S]*)$/;

export function withoutDividerAnnotationNotes<T extends NotesTabLike>(tab: T): T {
  const notes = tab?.kb?.importantNotes;
  if (!tab?.kb || !Array.isArray(notes) || notes.length === 0) return tab;
  const sections = new Set((tab.kb.records || []).map((r) => (r._section || '').trim()).filter(Boolean));
  const columns = new Set((tab.kb.fieldOrder || []).map((f) => String(f.key).split('\n')[0].trim()));
  const kept = notes.filter((n) => {
    const m = typeof n === 'string' ? n.match(GENERATED) : null;
    if (!m) return true;
    return !(sections.has(m[1].trim()) && columns.has(m[2].trim()));
  });
  if (kept.length === notes.length) return tab;
  return { ...tab, kb: { ...tab.kb, importantNotes: kept } };
}
