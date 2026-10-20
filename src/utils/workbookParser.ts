import * as XLSX from 'xlsx';
import { Tab, Workbook, GridCell, FieldOrder, RecordItem, KBData } from '../types';

/* ================= EXACT PORT OF ORIGINAL PROJECT PARSER ================= */

function cellStr(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v).split('\u0001')[0].replace(/\u00a0/g, ' ').trim();
}

function cellLink(v: any): string {
  const x = v === null || v === undefined ? '' : String(v);
  const i = x.indexOf('\u0001');
  return i < 0 ? '' : x.slice(i + 1);
}

function cellFull(v: any): string {
  const t = cellStr(v);
  const l = cellLink(v);
  return l && t.indexOf(l) < 0 ? (t ? t + '\n\n' : '') + '🔗 ' + l : t;
}

function isNoteLabel(t: string): boolean {
  return t.length <= 30 && /^\s*important\s*notes?/i.test(t);
}

function nnCount(r: any[]): number {
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    if (cellStr(r[i]) !== '') n++;
  }
  return n;
}

// Normalize grid by trimming outer empty rows and columns
function normalizeGrid(rows: any[][]): string[][] {
  let grid: string[][] = rows.map(r =>
    (r || []).map(c => (c === null || c === undefined ? '' : String(c)))
  );

  function rowEmpty(r: string[]) {
    return r.every(c => cellStr(c) === '');
  }

  while (grid.length && rowEmpty(grid[grid.length - 1])) grid.pop();
  let top = 0;
  while (top < grid.length && rowEmpty(grid[top])) top++;
  grid = grid.slice(top);
  if (!grid.length) return [];

  let minCol = Infinity;
  let maxCol = -1;
  grid.forEach(r => {
    for (let i = 0; i < r.length; i++) {
      if (cellStr(r[i]) !== '') {
        if (i < minCol) minCol = i;
        if (i > maxCol) maxCol = i;
      }
    }
  });

  if (maxCol < 0) return [];
  return grid.map(r => {
    const out: string[] = [];
    for (let i = minCol; i <= maxCol; i++) {
      out.push(r[i] === undefined ? '' : r[i]);
    }
    return out;
  });
}

// Reads one sheet into cells {v,l,rs,cs} or {cov:[r,c]} for merged-over cells.
export function readSheetGrid(ws: XLSX.WorkSheet | undefined): GridCell[][] {
  if (!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']);
  const R = rg.e.r + 1;
  const C = rg.e.c + 1;
  const g: (GridCell | null)[][] = [];

  for (let r = 0; r < R; r++) g.push(new Array(C).fill(null));

  Object.keys(ws).forEach(k => {
    if (k.charAt(0) === '!') return;
    const a = XLSX.utils.decode_cell(k);
    const cell = ws[k];
    if (!cell || a.r >= R || a.c >= C) return;
    const v = cell.w !== undefined ? cell.w : cell.v === undefined || cell.v === null ? '' : String(cell.v);
    const l = cell.l && cell.l.Target ? String(cell.l.Target) : '';
    if (v === '' && !l) return;
    g[a.r][a.c] = { v: String(v), l: l, rs: 1, cs: 1 };
  });

  (ws['!merges'] || []).forEach(m => {
    if (m.s.r >= R || m.s.c >= C) return;
    const master = g[m.s.r][m.s.c];
    if (!master) return;
    master.rs = Math.min(m.e.r, R - 1) - m.s.r + 1;
    master.cs = Math.min(m.e.c, C - 1) - m.s.c + 1;
    for (let rr = m.s.r; rr <= Math.min(m.e.r, R - 1); rr++) {
      for (let cc = m.s.c; cc <= Math.min(m.e.c, C - 1); cc++) {
        if (rr !== m.s.r || cc !== m.s.c) {
          g[rr][cc] = { cov: [m.s.r, m.s.c] };
        }
      }
    }
  });

  let fr = -1;
  let lr = -1;
  let fc = Infinity;
  let lc = -1;

  g.forEach((row, ri) => {
    row.forEach((x, ci) => {
      if (x && !x.cov) {
        if (fr < 0) fr = ri;
        lr = ri;
        if (ci < fc) fc = ci;
        if (ci > lc) lc = ci;
      }
    });
  });

  if (fr < 0) return [];

  return g.slice(fr, lr + 1).map(row => {
    return row.slice(fc, lc + 1).map(x => {
      return x && x.cov ? { cov: [x.cov[0] - fr, x.cov[1] - fc] } : (x as GridCell);
    });
  });
}

// Flat text rows for the case parser: vertically merged cells repeat their value, links ride along after \u0001
export function gridToRows(g: GridCell[][]): string[][] {
  return g.map(row => {
    return row.map((x, c) => {
      if (!x) return '';
      if (x.cov) {
        const m = g[x.cov[0]] && g[x.cov[0]][x.cov[1]];
        return m && x.cov[1] === c ? m.v || '' : '';
      }
      return (x.v || '') + (x.l && /^(https?:\/\/|mailto:)/i.test(x.l) ? '\u0001' + x.l : '');
    });
  });
}

// Parse workbook flat rows into { importantNotes, fieldOrder, records, hasGroup, hasSections }
export function parseWorkbookRows(rawRows: any[][]): KBData {
  const rows = normalizeGrid(rawRows);
  let hdrIdx = -1;
  let groupIdx = -1;

  // 1) Header row found by content ("Complaint Type")
  for (let h = 0; h < Math.min(rows.length, 20) && hdrIdx < 0; h++) {
    for (let c = 0; c < rows[h].length; c++) {
      if (/complaint\s*type/i.test(cellStr(rows[h][c]))) {
        hdrIdx = h;
        break;
      }
    }
  }

  if (hdrIdx >= 0) {
    if (hdrIdx >= 1 && !isNoteLabel(cellStr(rows[hdrIdx - 1][0]))) groupIdx = hdrIdx - 1;
  } else {
    let r0 = 0;
    while (r0 < Math.min(rows.length, 6) && isNoteLabel(cellStr(rows[r0][0]))) r0++;
    hdrIdx = Math.min(r0, Math.max(rows.length - 1, 0));
    const a = nnCount(rows[hdrIdx] || []);
    const b = nnCount(rows[hdrIdx + 1] || []);
    if (rows[hdrIdx + 1] && a >= 1 && b >= 2 * a) {
      groupIdx = hdrIdx;
      hdrIdx++;
    }
  }

  const importantNotes: string[] = [];
  const seenNote: Record<string, number> = {};
  const limit = groupIdx >= 0 ? groupIdx : hdrIdx;

  for (let n = 0; n < limit; n++) {
    const nr = rows[n] || [];
    const hasLabel = nr.some(x => isNoteLabel(cellStr(x)));
    for (let c = hasLabel ? 0 : 1; c < nr.length; c++) {
      const t = cellFull(nr[c]);
      if (!t || isNoteLabel(cellStr(nr[c]))) continue;
      if (!seenNote[t]) {
        seenNote[t] = 1;
        importantNotes.push(t);
      }
    }
  }

  const groupRow = groupIdx >= 0 ? rows[groupIdx] : [];
  const groupForCol: string[] = [];
  let lastGroup = '';
  for (let i = 0; i < groupRow.length; i++) {
    if (cellStr(groupRow[i]) !== '') lastGroup = cellStr(groupRow[i]);
    groupForCol[i] = lastGroup;
  }

  const headerRow = rows[hdrIdx] || [];
  const numCols = headerRow.length;
  const fieldForCol: string[] = [];
  let lastField = '';
  for (let i = 0; i < numCols; i++) {
    if (cellStr(headerRow[i]) !== '') lastField = cellStr(headerRow[i]);
    fieldForCol[i] = lastField;
  }

  const fieldOrder: FieldOrder[] = [];
  const seen: Record<string, boolean> = {};
  for (let i = 0; i < numCols; i++) {
    const f = fieldForCol[i];
    if (!f) continue;
    if (!seen[f]) {
      seen[f] = true;
      fieldOrder.push({
        key: f,
        group: groupForCol[i] || '',
        cols: [i],
        link: cellLink(headerRow[i]),
      });
    } else {
      const entry = fieldOrder.find(e => e.key === f);
      if (entry) entry.cols.push(i);
    }
  }

  function divInfo(rw: string[]) {
    if (!cellStr(rw[0]) || cellStr(rw[1])) return null;
    const strays: number[] = [];
    let hit = 0;
    for (let k = 2; k < rw.length; k++) {
      const x = cellStr(rw[k]);
      if (!x) continue;
      if (x === cellStr(headerRow[k])) hit++;
      else strays.push(k);
    }
    return strays.length <= 1 ? { strays, hit } : null;
  }

  let initialSection = '';
  let repeats = false;
  for (let r = hdrIdx + 1; r < rows.length && !repeats; r++) {
    const di0 = divInfo(rows[r]);
    if (di0 && di0.hit >= 2) repeats = true;
  }

  if (repeats && fieldOrder.length && fieldOrder[0].cols.indexOf(0) >= 0) {
    initialSection = fieldOrder[0].key;
    fieldOrder[0].key = 'Inquiry';
  }

  const records: RecordItem[] = [];
  let currentSection = initialSection;

  for (let r = hdrIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every(x => cellStr(x) === '')) continue;
    const di = divInfo(row);
    if (di) {
      // Category divider row. Any stray text sitting in one of its other columns is an annotation of the
      // spreadsheet layout, NOT an "Important Note": it must not be added to the notes list. The text is not lost:
      // it stays in the sheet grid and is visible in the Table view.
      currentSection = cellStr(row[0]);
      continue;
    }

    const record: RecordItem = { _section: currentSection, _row: r + 1, fields: {} };
    for (let fi = 0; fi < fieldOrder.length; fi++) {
      const fo = fieldOrder[fi];
      const vals = fo.cols.map(ci => cellFull(row[ci])).filter(Boolean);
      if (vals.length) record.fields[fo.key] = vals.join('\n\n');
    }
    if (Object.keys(record.fields).length) records.push(record);
  }

  return {
    importantNotes,
    fieldOrder,
    records,
    primaryKey: '',
    descKey: '',
    hasGroup: groupIdx >= 0,
    hasSections: records.some(x => !!x._section),
  };
}

export function finalizeKB(p: KBData): KBData {
  const fo = p.fieldOrder;
  const recs = p.records;
  let pk: string | null = null;

  fo.forEach(f => {
    if (!pk && /complaint\s*type/i.test(f.key)) pk = f.key;
  });

  if (!pk) {
    const need = Math.max(2, Math.ceil(recs.length * 0.6));
    fo.forEach(f => {
      if (pk) return;
      const seen: Record<string, number> = {};
      let n = 0;
      recs.forEach(r => {
        const v = r.fields[f.key];
        if (v && !seen[v]) {
          seen[v] = 1;
          n++;
        }
      });
      if (n >= need) pk = f.key;
    });
  }

  p.primaryKey = pk || (fo[0] && fo[0].key) || '';
  let dk = '';
  fo.forEach(f => {
    if (
      !dk &&
      f.key !== p.primaryKey &&
      /^(description|explanation|wait reason|definition)/i.test(f.key)
    ) {
      dk = f.key;
    }
  });
  p.descKey = dk;
  return p;
}

export function buildTabs(wb: XLSX.WorkBook): Tab[] {
  const tabs: Tab[] = [];
  wb.SheetNames.forEach(name => {
    const tab: Tab = {
      name,
      kind: 'table',
      view: 'smart',
      grid: [],
      kb: { importantNotes: [], fieldOrder: [], records: [], primaryKey: '', descKey: '' },
      skip: {},
    };

    try {
      try {
        tab.grid = readSheetGrid(wb.Sheets[name]);
      } catch (e1) {
        console.error('grid', name, e1);
        const jsonRows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
          header: 1,
          defval: '',
          raw: false,
        });
        tab.grid = jsonRows.map(row =>
          row.map(v => (v === '' || v === null ? null : { v: String(v), l: '', rs: 1, cs: 1 }))
        ) as any;
      }

      for (let r = 0; r < Math.min(tab.grid.length, 4); r++) {
        const first = tab.grid[r].find(x => x && !x.cov && x.v);
        if (first && isNoteLabel((first.v || '').trim())) tab.skip[r] = true;
      }

      const p = finalizeKB(parseWorkbookRows(gridToRows(tab.grid)));
      tab.kb = p;

      const longF = p.fieldOrder.filter(f => {
        const L = p.records
          .map(x => (x.fields[f.key] || '').length)
          .sort((x, y) => x - y);
        return L.length && L[L.length >> 1] > 120;
      }).length;

      if (
        p.records.length >= 2 &&
        p.fieldOrder.length >= 4 &&
        longF >= 2 &&
        (p.fieldOrder.length >= 6 || p.hasGroup || p.hasSections)
      ) {
        tab.kind = 'cases';
      }
    } catch (err) {
      console.error('tab', name, err);
    }

    if (!tab.kb) {
      tab.kb = { importantNotes: [], fieldOrder: [], records: [], primaryKey: '', descKey: '' };
    }
    tabs.push(tab);
  });
  return tabs;
}

export function parseWorkbookBytes(data: Uint8Array | ArrayBuffer, fileName: string): Workbook {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = XLSX.read(bytes, { type: 'array' });
  const tabs = buildTabs(wb);
  return {
    tabs,
    fileName,
  };
}

// Backwards-compatible alias for server / tests
export function parseWorkbookBuffer(data: any, fileName: string): Workbook {
  return parseWorkbookBytes(data, fileName);
}
