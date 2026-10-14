import { KBData, RecordItem, SearchResult, Tab, GridCell } from '../types';

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c] || c;
  });
}

export function stripDiacritics(s: string): string {
  return String(s).replace(/[\u064B-\u0652\u0670\u0640]/g, '');
}

export function normalize(s: string): string {
  return stripDiacritics(String(s).toLowerCase());
}

export function splitHeader(key: string): { en: string; ar: string } {
  const parts = String(key).split(/\r?\n/).filter(Boolean);
  return { en: parts[0] || key, ar: parts[1] || '' };
}

export function isRTLText(s: string): boolean {
  return /[\u0600-\u06FF]/.test(s);
}

export function fieldWeight(key: string): number {
  const k = key.toLowerCase();
  if (k.includes('complaint type')) return 6;
  if (k.includes('category')) return 5;
  if (k.includes('description')) return 4;
  if (k.includes('chat label')) return 3;
  return 1;
}

export function linkify(text: string): string {
  return text.replace(/https?:\/\/[^\s<]+/g, u => {
    let t = '';
    const m = u.match(/(&quot;|&#39;|&lt;|&gt;|[.,;:!?)\]])+$/);
    if (m) {
      t = m[0];
      u = u.slice(0, u.length - t.length);
    }
    return `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>${t}`;
  });
}

export function primaryValue(rec: RecordItem, kb: KBData | null): string {
  const pk = kb?.primaryKey;
  if (pk && rec.fields[pk]) return rec.fields[pk];
  return fieldValue(rec, 'Complaint Type');
}

export function descValue(rec: RecordItem, kb: KBData | null): string {
  const dk = kb?.descKey;
  if (dk && rec.fields[dk]) return rec.fields[dk];
  return fieldValue(rec, 'Description');
}

export function fieldValue(rec: RecordItem, partialKey: string): string {
  const keys = Object.keys(rec.fields);
  const target = partialKey.toLowerCase();
  for (const k of keys) {
    if (k.toLowerCase().startsWith(target)) return rec.fields[k];
  }
  return '';
}

export function isCritical(section: string): boolean {
  return /critical/i.test(section || '');
}

export function recordDisplayTitle(rec: RecordItem, kb: KBData | null): string {
  const pv = primaryValue(rec, kb);
  if (pv) return pv;
  const ct = fieldValue(rec, 'Complaint Type');
  if (ct) return ct;
  const cat = fieldValue(rec, 'Category');
  return cat || `Case #${rec._row}`;
}

export function cellStr(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v).split('\u0001')[0].replace(/\u00a0/g, ' ').trim();
}

export function cellLink(v: any): string {
  const x = (v === null || v === undefined) ? '' : String(v);
  const i = x.indexOf('\u0001');
  return i < 0 ? '' : x.slice(i + 1);
}

export function cellFull(v: any): string {
  const t = cellStr(v);
  const l = cellLink(v);
  return (l && !t.includes(l)) ? ((t ? t + '\n\n' : '') + '🔗 ' + l) : t;
}

export function searchRecords(
  kb: KBData | null,
  query: string,
  scopeField: string,
  activeSection: string | null,
  activeComplaintType: string | null
): SearchResult[] {
  if (!kb) return [];
  const recs = kb.records;
  const q = normalize(query.trim());

  const filtered = recs.filter(rec => {
    if (activeSection && rec._section !== activeSection) return false;
    if (activeComplaintType && primaryValue(rec, kb) !== activeComplaintType) return false;
    return true;
  });

  if (!q) {
    return filtered.map(rec => ({ rec, score: 0, matchKey: null, snippet: null }));
  }

  let scopeKey: string | null = null;
  if (scopeField !== 'ALL') {
    const idx = parseInt(scopeField, 10);
    const fo = kb.fieldOrder[idx];
    if (fo) scopeKey = fo.key;
  }

  const results: SearchResult[] = [];
  filtered.forEach(rec => {
    let bestScore = 0;
    let bestKey: string | null = null;
    let bestIdx = -1;

    Object.keys(rec.fields).forEach(key => {
      if (scopeKey && key !== scopeKey) return;
      const raw = rec.fields[key];
      const norm = normalize(raw);
      const idx = norm.indexOf(q);
      if (idx === -1) return;

      const occurrences = norm.split(q).length - 1;
      const score = fieldWeight(key) * (1 + Math.min(occurrences, 5) * 0.15);
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
        bestIdx = idx;
      } else if (!bestKey) {
        bestScore = Math.max(bestScore, score);
      }
    });

    if (bestKey) {
      const raw = rec.fields[bestKey];
      const start = Math.max(0, bestIdx - 40);
      const end = Math.min(raw.length, bestIdx + q.length + 60);
      const snippet = (start > 0 ? '…' : '') + raw.slice(start, end).replace(/\s+/g, ' ') + (end < raw.length ? '…' : '');
      results.push({ rec, score: bestScore, matchKey: bestKey, snippet });
    }
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

export function tableRowMatches(tab: Tab, query: string): number[] {
  const q = normalize(query.trim());
  const out: number[] = [];

  tab.grid.forEach((row, r) => {
    if (tab.skip && tab.skip[r]) return;
    const txt: string[] = [];
    let any = false;

    row.forEach(c => {
      if (c && !c.cov && (c.v || c.l)) {
        any = true;
        txt.push(c.v || '');
      }
    });

    if (!any) return;
    if (q && !normalize(txt.join(' \n ')).includes(q)) return;
    out.push(r);
  });

  return out;
}
