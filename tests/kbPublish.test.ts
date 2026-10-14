import assert from 'node:assert/strict';
import { buildChunks, assembleTabs, MAX_CHUNK_BYTE_SIZE } from '../src/utils/kbChunks';
import { createFirestoreRest, toFirestoreValue, fromFirestoreValue } from '../src/utils/firestoreRest';
import { publishWorkbook, loadActiveWorkbook, clearWorkbookCache, KBLoadError } from '../src/utils/kbPublish';

// ---------- In-memory fake of the Firestore REST API (same semantics as the real one) ----------
interface Opts { dropChunk?: string; corruptChunk?: string; forbidGet?: boolean; forbidListChunks?: boolean; forbidListVersions?: boolean }
function fakeFirestore(opts: Opts = {}) {
  const docs = new Map<string, Record<string, any>>();
  const base = 'https://firestore.googleapis.com/v1/projects/p/databases/db/documents/';
  const log: string[] = [];
  const f: any = async (url: string, init: any = {}) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.split('/documents/')[1] || '');
    const method = init.method || 'GET';
    const isDoc = path.split('/').length % 2 === 0;
    const R = (status: number, body: any = {}) => ({ ok: status < 300, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) }) as any;
    log.push(`${method} ${path}${u.search ? ' ' + u.search.slice(0, 40) : ''}`);
    if (!isDoc) { // LIST
      if ((/\/chunks$/.test(path) && opts.forbidListChunks) || (path === 'kbVersions' && opts.forbidListVersions)) return R(403, { error: { message: 'Missing or insufficient permissions.' } });
      const prefix = path + '/';
      const documents = [...docs.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([k, v]) => ({ name: k, fields: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, toFirestoreValue(b)])) }));
      return R(200, { documents });
    }
    if (method === 'GET') {
      if (opts.forbidGet && path.includes('/chunks/')) return R(403, { error: { message: 'Missing or insufficient permissions.' } });
      if (opts.dropChunk && path.endsWith('/' + opts.dropChunk)) return R(404);
      const d = docs.get(path); if (!d) return R(404);
      const copy: any = { ...d };
      if (opts.corruptChunk && path.endsWith('/' + opts.corruptChunk)) copy.payloadJson = copy.payloadJson.slice(0, -1) + 'X';
      return R(200, { fields: Object.fromEntries(Object.entries(copy).map(([a, b]) => [a, toFirestoreValue(b)])) });
    }
    if (method === 'PATCH') {
      const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([a, b]) => [a, fromFirestoreValue(b)]));
      const mask = u.searchParams.getAll('updateMask.fieldPaths');
      if (opts.dropChunk && path.endsWith('/' + opts.dropChunk)) return R(200); // silently lost write
      if (mask.length) docs.set(path, { ...(docs.get(path) || {}), ...incoming });
      else docs.set(path, incoming); // NO MASK = FULL REPLACE (real Firestore behaviour)
      return R(200);
    }
    if (method === 'DELETE') { docs.delete(path); return R(200); }
    return R(400);
  };
  return { fetch: f as typeof fetch, docs, log };
}

// ---------- Realistic data: 9 tabs, Large Tab ~368k chars of mixed Arabic/English ----------
const AR = 'نص تجريبي عام يستخدم لاختبار الأحجام فقط '.repeat(8);
const EN = 'Generic placeholder text used only for size tests. '.repeat(8);
const cell = (v: string) => ({ v, l: '', rs: 1, cs: 1 });
function makeTab(name: string, nRecords: number, textLen: number): any {
  const records: any[] = [], grid: any[][] = [[cell('Complaint Type'), cell('Description'), cell('Script')]];
  for (let i = 0; i < nRecords; i++) {
    const d = (EN + AR).repeat(Math.ceil(textLen / (EN.length + AR.length))).slice(0, textLen);
    records.push({ _section: 'S' + (i % 4), _row: i + 1, fields: { 'Complaint Type': `${name} case ${i}`, Description: d, Script: AR } });
    grid.push([cell(`${name} case ${i}`), cell(d), cell(AR)]);
  }
  return { name, kind: 'cases', view: 'smart', skip: {}, grid, kb: { importantNotes: ['note "quoted"\nline2'], primaryKey: 'Complaint Type', descKey: 'Description', fieldOrder: [{ key: 'Complaint Type', group: '', cols: [0], link: '' }], records, hasGroup: false, hasSections: true } };
}
const realistic = () => ({ fileName: 'sample.xlsx', tabs: [
  makeTab('Table A', 12, 900), makeTab('Table B', 10, 300), makeTab('Table C', 15, 700),
  makeTab('Large Tab', 83, 4400), makeTab('Tab D', 10, 1200), makeTab('Tab E', 15, 900),
  makeTab('Tab F', 12, 800), makeTab('Tab G', 32, 600), makeTab('Tab H', 18, 700),
] });
const norm = (t: any) => JSON.parse(JSON.stringify({ ...t, gridJson: undefined }));
const cfg = { projectId: 'p', databaseId: 'db' };
const actor = { uid: 'u1', email: 'breadfast.hotfood@gmail.com' };
const sample = () => ({ tabs: [], fileName: 'sample', versionId: 'test-v1-initial', isSample: true });
let passed = 0; const ok = (name: string) => { passed++; console.log('  ✓', name); };

// 1. chunking is byte-accurate and lossless
{
  const wb = realistic();
  const chunks = await buildChunks(wb.tabs);
  const biggest = Math.max(...chunks.map((c) => c.byteSize));
  assert.ok(biggest <= MAX_CHUNK_BYTE_SIZE, `biggest chunk ${biggest}`);
  const rebuilt = assembleTabs(chunks.map((c) => ({ ...c })));
  assert.equal(rebuilt.length, 9);
  assert.deepEqual(rebuilt.map(norm), wb.tabs.map(norm));
  console.log(`  chunks: ${chunks.length}, biggest ${biggest} bytes, Large Tab chunks: ${chunks.filter((c) => c.tabName === 'Large Tab').length}`);
  ok('chunks fit the budget and the round trip is lossless (9 tabs, one Large Tab tab)');
}

// 2. THE PRODUCTION CASE: list on chunks is forbidden (403) but get works -> publish + load must still succeed
{
  clearWorkbookCache();
  const fk = fakeFirestore({ forbidListChunks: true }); const fs = createFirestoreRest(cfg, fk.fetch);
  const wb = realistic();
  const r = await publishWorkbook({ fs, token: 't', workbook: wb, actor, versionId: 'v-1' });
  assert.equal(r.ok, true, r.error);
  assert.equal(fk.docs.get('meta/kb')!.activeVersionId, 'v-1');
  const v = fk.docs.get('kbVersions/v-1')!;
  assert.equal(v.status, 'active'); assert.equal(v.versionId, 'v-1'); assert.equal(v.totalChunks, r.totalChunks); assert.ok(v.chunkChecksums && v.fileName);
  assert.ok(!fk.log.some((l) => l.startsWith('GET kbVersions/v-1/chunks ')), 'must never LIST the chunks collection');
  const loaded = await loadActiveWorkbook(fs, 't', sample);
  assert.equal(loaded.isSample, false); assert.equal(loaded.tabs.length, 9);
  assert.deepEqual(loaded.tabs.map(norm), wb.tabs.map(norm));
  ok('publishes and loads with LIST forbidden (403), version doc keeps all fields after activation');
}

// 3. a silently lost chunk write aborts the publish, live data unchanged, staged chunks cleaned
{
  const fk = fakeFirestore({ dropChunk: 'chunk_5' }); const fs = createFirestoreRest(cfg, fk.fetch);
  const r = await publishWorkbook({ fs, token: 't', workbook: realistic(), actor, versionId: 'v-x' });
  assert.equal(r.ok, false); assert.match(r.error!, /chunk_5/);
  assert.equal(fk.docs.has('meta/kb'), false);
  assert.equal(fk.docs.get('kbVersions/v-x')!.status, 'failed'); assert.equal(fk.docs.get('kbVersions/v-x')!.versionId, 'v-x');
  assert.ok(![...fk.docs.keys()].some((k) => k.startsWith('kbVersions/v-x/chunks/')), 'staged chunks removed');
  ok('missing chunk -> aborted, meta/kb untouched, staged chunks deleted, version marked failed');
}

// 4. corrupted chunk (checksum) aborts
{
  const fk = fakeFirestore({ corruptChunk: 'chunk_2' }); const fs = createFirestoreRest(cfg, fk.fetch);
  const r = await publishWorkbook({ fs, token: 't', workbook: realistic(), actor, versionId: 'v-c' });
  assert.equal(r.ok, false); assert.match(r.error!, /checksum/);
  assert.equal(fk.docs.has('meta/kb'), false);
  ok('corrupted chunk -> checksum mismatch aborts');
}

// 5. 403 on get is reported with the real HTTP status (never "count mismatch" with no reason)
{
  const fk = fakeFirestore({ forbidGet: true }); const fs = createFirestoreRest(cfg, fk.fetch);
  const r = await publishWorkbook({ fs, token: 't', workbook: realistic(), actor, versionId: 'v-g' });
  assert.equal(r.ok, false); assert.match(r.error!, /HTTP 403/); assert.match(r.error!, /insufficient permissions/i);
  assert.equal(fk.docs.has('meta/kb'), false);
  ok('403 on read-back is reported clearly with HTTP status and Firestore message');
}

// 6. oversize single record fails cleanly BEFORE any write
{
  const fk = fakeFirestore(); const fs = createFirestoreRest(cfg, fk.fetch);
  const wb = realistic(); wb.tabs[0].kb.records[0].fields.Description = 'x'.repeat(MAX_CHUNK_BYTE_SIZE + 10);
  const r = await publishWorkbook({ fs, token: 't', workbook: wb, actor, versionId: 'v-big' });
  assert.equal(r.ok, false); assert.match(r.error!, /single item/); assert.equal(fk.docs.size, 0);
  ok('single record larger than the budget -> clear error, nothing written');
}

// 7. empty tabs and tabs with only a grid
{
  const fk = fakeFirestore(); const fs = createFirestoreRest(cfg, fk.fetch);
  const wb = { fileName: 'e.xlsx', tabs: [{ name: 'Empty', kind: 'table', view: 'table', skip: {}, grid: [], kb: { importantNotes: [], fieldOrder: [], records: [], primaryKey: '', descKey: '' } }, makeTab('A', 2, 50)] };
  const r = await publishWorkbook({ fs, token: 't', workbook: wb, actor, versionId: 'v-e' });
  assert.equal(r.ok, true, r.error);
  const loaded = await loadActiveWorkbook(fs, 't', sample);
  assert.deepEqual(loaded.tabs.map(norm), wb.tabs.map(norm));
  ok('empty tab and normal tab round-trip');
}

// 8. retention: newest active, previous published, max 3 published, older archived, no metadata wiped
{
  const fk = fakeFirestore(); const fs = createFirestoreRest(cfg, fk.fetch);
  for (let i = 1; i <= 6; i++) { const r = await publishWorkbook({ fs, token: 't', workbook: { fileName: `f${i}`, tabs: [makeTab('A', 2, 50)] }, actor, versionId: `v-${i}`, now: () => new Date(2026, 9, i).toISOString() }); assert.equal(r.ok, true, r.error); }
  const st = (i: number) => fk.docs.get(`kbVersions/v-${i}`)!;
  assert.equal(st(6).status, 'active'); assert.equal(st(5).status, 'published');
  assert.equal(st(1).status, 'archived');
  for (let i = 1; i <= 6; i++) { assert.equal(st(i).versionId, `v-${i}`); assert.ok(st(i).fileName && st(i).totalChunks); }
  ok('retention statuses correct and version metadata never wiped');
}

// 9. loader: nothing published -> sample; published but unreadable -> error (NOT the sample)
{
  clearWorkbookCache();
  const empty = fakeFirestore(); const fs0 = createFirestoreRest(cfg, empty.fetch);
  assert.equal((await loadActiveWorkbook(fs0, 't', sample)).isSample, true);
  const fk = fakeFirestore(); const fs = createFirestoreRest(cfg, fk.fetch);
  await publishWorkbook({ fs, token: 't', workbook: realistic(), actor, versionId: 'v-ok' });
  clearWorkbookCache();
  const bad = fakeFirestore({ forbidGet: true }); bad.docs.set('meta/kb', { activeVersionId: 'v-ok', totalChunks: 3 });
  await assert.rejects(() => loadActiveWorkbook(createFirestoreRest(cfg, bad.fetch), 't', sample), (e: any) => e instanceof KBLoadError && /HTTP 403/.test(e.message));
  ok('loader serves the sample only when nothing is published; read failures are errors, not silent samples');
}

// 10. merge write with no fields is refused (would wipe the document)
{
  const fs = createFirestoreRest(cfg, fakeFirestore().fetch);
  await assert.rejects(() => fs.write('kbVersions/x', {}, 't', { merge: true }), /Refusing/);
  ok('empty merge write refused');
}

// 11. more chunks than one page of list results (e.g. 105 chunks across tabs)
{
  clearWorkbookCache();
  const fk = fakeFirestore(); const fs = createFirestoreRest(cfg, fk.fetch);
  // Generate 105 small tabs -> 105 chunks
  const manyTabs = Array.from({ length: 105 }, (_, i) => makeTab(`Tab_${i}`, 2, 50));
  const wb = { fileName: 'large_count.xlsx', tabs: manyTabs };
  const r = await publishWorkbook({ fs, token: 't', workbook: wb, actor, versionId: 'v-105' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.totalChunks >= 105, true);
  const loaded = await loadActiveWorkbook(fs, 't', sample);
  assert.equal(loaded.tabs.length, 105);
  ok('more chunks than one page of list results (>100 chunks) publishes and loads cleanly by ID');
}

// 12. retry after a failure (failed staging cleans up, next attempt succeeds)
{
  clearWorkbookCache();
  let failFirst = true;
  const docs = new Map<string, Record<string, any>>();
  const baseFk = fakeFirestore();
  // Wrap fetch to drop a chunk ONLY on the first attempt
  const customFetch = async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    if (failFirst && url.includes('/chunks/chunk_3') && method === 'GET') {
      return { ok: false, status: 404, statusText: '404', json: async () => ({}), text: async () => 'Not found' } as any;
    }
    return baseFk.fetch(url, init);
  };
  const fs = createFirestoreRest(cfg, customFetch as typeof fetch);

  // Attempt 1: fails on chunk_3
  const wb = realistic();
  const r1 = await publishWorkbook({ fs, token: 't', workbook: wb, actor, versionId: 'v-attempt-1' });
  assert.equal(r1.ok, false);
  assert.equal(baseFk.docs.has('meta/kb'), false);
  assert.equal(baseFk.docs.get('kbVersions/v-attempt-1')?.status, 'failed');

  // Attempt 2 (retry): failure condition resolved
  failFirst = false;
  const r2 = await publishWorkbook({ fs, token: 't', workbook: wb, actor, versionId: 'v-attempt-2' });
  assert.equal(r2.ok, true, r2.error);
  assert.equal(baseFk.docs.get('meta/kb')?.activeVersionId, 'v-attempt-2');
  assert.equal(baseFk.docs.get('kbVersions/v-attempt-2')?.status, 'active');
  ok('retry after failure: staged documents cleaned, version marked failed, retry succeeds and flips pointer');
}

console.log(`\nALL ${passed} TESTS PASSED`);
