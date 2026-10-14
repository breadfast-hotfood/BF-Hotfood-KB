/**
 * Byte-accurate chunking for Firestore documents.
 * A tab is stored as: one "meta" chunk (everything except records and grid),
 * N "records" chunks and N "grid" chunks. Every chunk is packed greedily by REAL UTF-8 size,
 * so no chunk can exceed maxBytes (unless one single record/row is bigger than maxBytes, which throws).
 */

export const MAX_CHUNK_BYTE_SIZE = 750 * 1024; // 768,000 bytes (Firestore limit is 1 MiB per document)

export type ChunkPart = 'meta' | 'records' | 'grid';

export interface ChunkDoc {
  chunkId: string;
  chunkIndex: number;
  tabIndex: number;
  tabName: string;
  part: ChunkPart;
  partIndex: number;
  payloadJson: string;
  byteSize: number;
  sha256: string;
}

const textEncoder = new TextEncoder();
const bytes = (s: string): number => textEncoder.encode(s).length;

/** SHA-256 as lowercase hex using the Web Crypto API (works in browsers over HTTPS and in Node 20+). */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', textEncoder.encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function packArray(items: any[], maxBytes: number, label: string): string[] {
  // Returns JSON strings of arrays; each string is <= maxBytes.
  const out: string[] = [];
  let cur: string[] = [];
  let curBytes = 2; // "[" and "]"
  for (const item of items) {
    const s = JSON.stringify(item);
    const b = bytes(s);
    if (b + 2 > maxBytes) {
      throw new RangeError(`${label}: a single item is ${b} bytes, larger than the ${maxBytes}-byte chunk budget.`);
    }
    const add = b + (cur.length ? 1 : 0);
    if (cur.length && curBytes + add > maxBytes) {
      out.push('[' + cur.join(',') + ']');
      cur = [];
      curBytes = 2;
    }
    curBytes += b + (cur.length ? 1 : 0);
    cur.push(s);
  }
  if (cur.length) out.push('[' + cur.join(',') + ']');
  return out;
}

export async function buildChunks(tabs: any[], maxBytes: number = MAX_CHUNK_BYTE_SIZE): Promise<ChunkDoc[]> {
  const chunks: ChunkDoc[] = [];
  let idx = 0;
  const push = async (tabIndex: number, tabName: string, part: ChunkPart, partIndex: number, payloadJson: string) => {
    const byteSize = bytes(payloadJson);
    if (byteSize > maxBytes) {
      throw new RangeError(`Tab "${tabName}" (${part}) needs ${byteSize} bytes, larger than the ${maxBytes}-byte chunk budget.`);
    }
    chunks.push({
      chunkId: `chunk_${idx}`,
      chunkIndex: idx++,
      tabIndex,
      tabName,
      part,
      partIndex,
      payloadJson,
      byteSize,
      sha256: await sha256Hex(payloadJson),
    });
  };

  for (let tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
    const tab = tabs[tabIndex];
    const name = String(tab?.name ?? `Tab ${tabIndex + 1}`);
    const records: any[] = tab?.kb?.records || [];
    const grid: any[] = Array.isArray(tab?.grid) && tab.grid.length
      ? tab.grid
      : (() => { try { return tab?.gridJson ? JSON.parse(tab.gridJson) : []; } catch { return []; } })();

    const meta = { ...tab, grid: [], gridJson: undefined, kb: { ...(tab?.kb || {}), records: [] } };
    await push(tabIndex, name, 'meta', 0, JSON.stringify(meta));
    const recordParts = packArray(records, maxBytes, `Tab "${name}" records`);
    for (let i = 0; i < recordParts.length; i++) await push(tabIndex, name, 'records', i, recordParts[i]);
    const gridParts = packArray(grid, maxBytes, `Tab "${name}" grid`);
    for (let i = 0; i < gridParts.length; i++) await push(tabIndex, name, 'grid', i, gridParts[i]);
  }
  return chunks;
}

/** Rebuilds the tabs array from chunk documents (any order). Also understands the old "one tab per chunk" format. */
export function assembleTabs(chunkDocs: any[]): any[] {
  const sorted = [...chunkDocs].sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
  const byTab = new Map<number, { meta?: any; records: any[][]; grid: any[][] }>();
  const legacy: any[] = [];

  for (const c of sorted) {
    if (!c.part) { // legacy format: payloadJson holds a whole tab
      try {
        const t = JSON.parse(c.payloadJson);
        if (t.gridJson && (!t.grid || !t.grid.length)) { try { t.grid = JSON.parse(t.gridJson); } catch { t.grid = []; } }
        delete t.gridJson;
        legacy.push(t);
      } catch { /* skip unreadable legacy chunk */ }
      continue;
    }
    const ti = Number(c.tabIndex);
    if (!byTab.has(ti)) byTab.set(ti, { records: [], grid: [] });
    const entry = byTab.get(ti)!;
    const payload = JSON.parse(c.payloadJson);
    if (c.part === 'meta') entry.meta = payload;
    else if (c.part === 'records') entry.records[Number(c.partIndex)] = payload;
    else if (c.part === 'grid') entry.grid[Number(c.partIndex)] = payload;
  }

  const tabs: any[] = [];
  [...byTab.keys()].sort((a, b) => a - b).forEach((ti) => {
    const e = byTab.get(ti)!;
    if (!e.meta) throw new Error(`Tab #${ti} is missing its meta chunk.`);
    const tab = e.meta;
    delete tab.gridJson;
    tab.kb = { ...(tab.kb || {}), records: e.records.flat() };
    tab.grid = e.grid.flat();
    tabs.push(tab);
  });
  return [...tabs, ...legacy];
}

export interface VerifyResult { ok: boolean; problems: string[]; }

/** Compares what we meant to write with what was read back. Never trusts counts alone: checks IDs, bytes and SHA-256. */
export async function verifyChunks(expected: ChunkDoc[], readBack: any[], maxBytes: number = MAX_CHUNK_BYTE_SIZE): Promise<VerifyResult> {
  const problems: string[] = [];
  const got = new Map<string, any>();
  for (const r of readBack) if (r && r.chunkId) got.set(r.chunkId, r);
  for (const e of expected) {
    const r = got.get(e.chunkId);
    if (!r) { problems.push(`${e.chunkId} (${e.tabName}/${e.part}) was not found after writing.`); continue; }
    if (typeof r.payloadJson !== 'string') { problems.push(`${e.chunkId} has no payload.`); continue; }
    const size = bytes(r.payloadJson);
    if (size > maxBytes) problems.push(`${e.chunkId} is ${size} bytes (budget ${maxBytes}).`);
    if (size !== e.byteSize) problems.push(`${e.chunkId} size changed: wrote ${e.byteSize}, read ${size}.`);
    if ((await sha256Hex(r.payloadJson)) !== e.sha256) problems.push(`${e.chunkId} checksum mismatch.`);
  }
  const expectedIds = new Set(expected.map((e) => e.chunkId));
  for (const id of got.keys()) if (!expectedIds.has(id)) problems.push(`Unexpected extra chunk ${id}.`);
  return { ok: problems.length === 0, problems };
}
