import { buildChunks, assembleTabs, verifyChunks, sha256Hex, MAX_CHUNK_BYTE_SIZE } from './kbChunks';
import type { FirestoreRest } from './firestoreRest';

export class KBLoadError extends Error {
  status = 503;
  constructor(message: string) { super(message); this.name = 'KBLoadError'; }
}

export interface PublishInput {
  fs: FirestoreRest;
  token: string;
  workbook: any;                       // { tabs, fileName }
  fileName?: string;
  actor: { uid: string; email: string; name?: string };
  versionId?: string;
  now?: () => string;
}
export interface PublishResult {
  ok: boolean;
  versionId: string;
  totalChunks: number;
  totalRecords: number;
  versionChecksum?: string;
  error?: string;
  details?: any;
}

const discardStaged = async (fs: FirestoreRest, token: string, versionId: string, ids: string[], reason: string) => {
  for (const id of ids) await fs.del(`kbVersions/${versionId}/chunks/${id}`, token); // best effort cleanup
  try { await fs.write(`kbVersions/${versionId}`, { status: 'failed', failureReason: reason.slice(0, 1500) }, token, { merge: true }); } catch { /* ignore */ }
};

/** Stage 1 write -> Stage 2 verify by ID -> Stage 3 flip pointer -> Stage 4 retention. /meta/kb changes ONLY after full verification. */
export async function publishWorkbook(inp: PublishInput): Promise<PublishResult> {
  const { fs, token, workbook, actor } = inp;
  const nowIso = inp.now ? inp.now() : new Date().toISOString();
  const versionId = inp.versionId || `v-${Date.now()}`;
  const fileName = inp.fileName || workbook.fileName || '';
  const totalRecords = workbook.tabs.reduce((a: number, t: any) => a + (t?.kb?.records?.length || 0), 0);

  let chunks;
  try { chunks = await buildChunks(workbook.tabs, MAX_CHUNK_BYTE_SIZE); }
  catch (e: any) { return { ok: false, versionId, totalChunks: 0, totalRecords, error: `Cannot split this workbook into storable chunks: ${e.message}` }; }

  const ids = chunks.map((c) => c.chunkId);
  const chunkChecksums: Record<string, string> = {};
  chunks.forEach((c) => { chunkChecksums[c.chunkId] = c.sha256; });
  const versionChecksum = await sha256Hex(chunks.map((c) => c.sha256).join(':'));

  // STAGE 1
  try {
    await fs.write(`kbVersions/${versionId}`, {
      versionId, fileName, status: 'staging', publishedAt: nowIso, publishedBy: actor.email, publishedByUid: actor.uid, publishedByName: actor.name || '',
      totalTabs: workbook.tabs.length, totalRecords, totalChunks: chunks.length, maxChunkByteSize: MAX_CHUNK_BYTE_SIZE,
      chunkChecksums, versionChecksum, tabNames: workbook.tabs.map((t: any) => t.name),
    }, token);
    for (const c of chunks) {
      await fs.write(`kbVersions/${versionId}/chunks/${c.chunkId}`, {
        chunkId: c.chunkId, chunkIndex: c.chunkIndex, tabIndex: c.tabIndex, tabName: c.tabName, part: c.part,
        partIndex: c.partIndex, payloadJson: c.payloadJson, byteSize: c.byteSize, sha256: c.sha256,
      }, token);
    }
  } catch (e: any) {
    await discardStaged(fs, token, versionId, ids, e.message);
    return { ok: false, versionId, totalChunks: chunks.length, totalRecords, error: `Staging failed: ${e.message}` };
  }

  // STAGE 2: read every chunk back BY ID (no list query, no pagination) and verify bytes + SHA-256
  const read = await fs.readChunksByIds(versionId, ids, token);
  const verdict = await verifyChunks(chunks, read.chunks);
  if (read.failures.length || !verdict.ok) {
    const parts = [
      ...read.failures.map((f) => `${f.chunkId}: HTTP ${f.status}${f.errorText ? ' ' + f.errorText.slice(0, 160) : ''}`),
      ...verdict.problems,
    ];
    const reason = `Verification failed (${parts.length} problem${parts.length === 1 ? '' : 's'}): ${parts.slice(0, 4).join(' | ')}`;
    await discardStaged(fs, token, versionId, ids, reason);
    return { ok: false, versionId, totalChunks: chunks.length, totalRecords, error: `Publish aborted, live data unchanged. ${reason}`, details: { expected: chunks.length, readBack: read.chunks.length, failures: read.failures, problems: verdict.problems } };
  }

  // STAGE 3: activate (only now does /meta/kb change)
  await fs.write('meta/kb', {
    activeVersionId: versionId, fileName, publishedAt: nowIso, publishedBy: actor.email, publishedByName: actor.name || '', totalTabs: workbook.tabs.length,
    totalRecords, totalChunks: chunks.length, versionChecksum,
  }, token);
  await fs.write(`kbVersions/${versionId}`, { status: 'active' }, token, { merge: true });

  // STAGE 4: retention (non-fatal). Needs "list" on kbVersions; if the rules refuse it, publishing still succeeds.
  try {
    const all = await fs.listCollection('kbVersions', token, 100);
    const published = all
      .filter((v) => v.versionId && v.versionId !== versionId && (v.status === 'published' || v.status === 'active'))
      .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
    if (published[0]) await fs.write(`kbVersions/${published[0].versionId}`, { status: 'published' }, token, { merge: true });
    for (const old of published.slice(3)) await fs.write(`kbVersions/${old.versionId}`, { status: 'archived' }, token, { merge: true });
  } catch { /* ignore */ }

  return { ok: true, versionId, totalChunks: chunks.length, totalRecords, versionChecksum };
}

const cache = new Map<string, any>();

/** Loads the active workbook. Returns the sample ONLY when nothing has been published. Never silently falls back to the sample on errors. */
export async function loadActiveWorkbook(fs: FirestoreRest, token: string | undefined, sample: () => any): Promise<any> {
  if (!token) return sample();
  const metaRes = await fs.get('meta/kb', token);
  if (metaRes.status === 404) return sample();
  if (!metaRes.found || !metaRes.data) throw new KBLoadError(`Cannot read meta/kb (HTTP ${metaRes.status}${metaRes.errorText ? ': ' + metaRes.errorText.slice(0, 160) : ''}).`);
  const meta = metaRes.data;
  const versionId: string | undefined = meta.activeVersionId;
  const sampleWb = sample();
  if (!versionId || versionId === sampleWb.versionId) return sampleWb;

  const key = `${versionId}:${meta.versionChecksum || ''}`;
  if (cache.has(key)) return cache.get(key);

  let total = Number(meta.totalChunks) || 0;
  if (!total) {
    const v = await fs.get(`kbVersions/${versionId}`, token);
    total = Number(v.data?.totalChunks) || 0;
  }
  let docs: any[] = [];
  if (total > 0) {
    const ids = Array.from({ length: total }, (_, i) => `chunk_${i}`);
    const read = await fs.readChunksByIds(versionId, ids, token);
    if (read.failures.length) throw new KBLoadError(`Cannot read ${read.failures.length} of ${total} chunks of ${versionId} (first: ${read.failures[0].chunkId} HTTP ${read.failures[0].status}).`);
    docs = read.chunks;
  } else {
    for (let i = 0; i < 500; i++) { // unknown count: walk chunk_0, chunk_1... until the first 404
      const r = await fs.get(`kbVersions/${versionId}/chunks/chunk_${i}`, token);
      if (r.status === 404) break;
      if (!r.found || !r.data) throw new KBLoadError(`Cannot read chunk_${i} of ${versionId} (HTTP ${r.status}).`);
      docs.push(r.data);
    }
  }
  if (!docs.length) throw new KBLoadError(`Version ${versionId} has no readable chunks.`);
  for (const d of docs) {
    if (typeof d.payloadJson !== 'string' || (d.sha256 && (await sha256Hex(d.payloadJson)) !== d.sha256)) throw new KBLoadError(`Chunk ${d.chunkId} failed its checksum.`);
  }
  const wb = { tabs: assembleTabs(docs), fileName: meta.fileName || '', versionId, isSample: false };
  cache.set(key, wb);
  while (cache.size > 3) cache.delete(cache.keys().next().value as string);
  return wb;
}
export const clearWorkbookCache = () => cache.clear();
