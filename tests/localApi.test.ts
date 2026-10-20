import assert from 'node:assert/strict';
import { createLocalApi, installFetchInterceptor, decodeJwtPayload } from '../src/utils/localApi';
import { SAMPLE_KB } from '../src/utils/sampleKb';
import { toFirestoreValue, fromFirestoreValue } from '../src/utils/firestoreRest';
import { clearWorkbookCache } from '../src/utils/kbPublish';

// ---------- fake Firestore REST (documents, list via runQuery, optional 403 injection) ----------
type Deny = (method: string, path: string) => boolean;
function fakeFirestore(deny: Deny = () => false) {
  const docs = new Map<string, Record<string, any>>();
  const base = '/documents/';
  const R = (status: number, body: any = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as any;
  const enc = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toFirestoreValue(v)]));
  const f: any = async (url: string, init: any = {}) => {
    const u = new URL(url);
    const idx = u.pathname.indexOf(base);
    const path = decodeURIComponent(u.pathname.slice(idx + base.length));
    const method = init.method || 'GET';
    if (url.includes(':runQuery')) {
      const col = JSON.parse(init.body).structuredQuery.from[0].collectionId;
      if (deny('LIST', col)) return R(403, { error: { message: 'denied' } });
      const rows = [...docs.entries()].filter(([k]) => k.startsWith(col + '/') && !k.slice(col.length + 1).includes('/')).map(([k, v]) => ({ document: { name: 'projects/p/databases/d/documents/' + k, fields: enc(v) } }));
      return R(200, rows.length ? rows : [{ readTime: 'x' }]);
    }
    if (deny(method, path)) return R(403, { error: { message: 'Missing or insufficient permissions.' } });
    if (method === 'GET') { const d = docs.get(path); return d ? R(200, { fields: enc(d) }) : R(404); }
    if (method === 'PATCH') {
      const incoming = Object.fromEntries(Object.entries(JSON.parse(init.body).fields).map(([k, v]) => [k, fromFirestoreValue(v)]));
      const mask = u.searchParams.getAll('updateMask.fieldPaths');
      docs.set(path, mask.length ? { ...(docs.get(path) || {}), ...incoming } : incoming);
      return R(200);
    }
    if (method === 'DELETE') { docs.delete(path); return R(200); }
    return R(400);
  };
  return { fetch: f as typeof fetch, docs };
}

// ---------- fake Google ID tokens (unsigned: the browser API never trusts them for data access) ----------
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = new Date('2026-10-12T10:00:00Z');
function tok(email: string, extra: Record<string, any> = {}) {
  const payload = { email, email_verified: true, name: 'Test Person', user_id: 'uid-' + email, firebase: { sign_in_provider: 'google.com' }, exp: Math.floor(NOW.getTime() / 1000) + 3600, ...extra };
  return 'Bearer ' + `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}
const MAIN = 'breadfast.hotfood@gmail.com';

const cell = (v: string) => ({ v, l: '', rs: 1, cs: 1 });
function makeTab(name: string, n: number) {
  const records: any[] = []; const grid: any[][] = [[cell('Complaint Type'), cell('Description')]];
  for (let i = 0; i < n; i++) { records.push({ _section: '', _row: i + 1, fields: { 'Complaint Type': `${name} item ${i}`, Description: `Placeholder ${i}` } }); grid.push([cell(`${name} item ${i}`), cell(`Placeholder ${i}`)]); }
  return { name, kind: 'cases' as const, view: 'smart' as const, skip: {}, grid, kb: { importantNotes: [], primaryKey: 'Complaint Type', descKey: 'Description', fieldOrder: [{ key: 'Complaint Type', group: '', cols: [0], link: '' }, { key: 'Description', group: '', cols: [1], link: '' }], records, hasGroup: false, hasSections: false } };
}
const wbOf = (names: string[], n = 8) => ({ fileName: 'upload.xlsx', tabs: names.map((x) => makeTab(x, n)) });

function setup(deny?: Deny) {
  const fk = fakeFirestore(deny);
  const api = createLocalApi({ projectId: 'p', databaseId: 'd', fetchImpl: fk.fetch, sample: () => SAMPLE_KB, now: () => NOW, sleep: async () => {} });
  const call = (method: string, path: string, authorization?: string, body?: any) => api.handle({ method, path, authorization, body });
  return { fk, call };
}
let n = 0; const ok = (m: string) => { n++; console.log('  ✓', m); };

// 1. token checks
{
  const { call } = setup();
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', 'Bearer not.a.jwt')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', tok('a@breadfast.com', { firebase: { sign_in_provider: 'password' } }))).status, 403);
  assert.equal((await call('GET', '/api/auth/me', tok('a@breadfast.com', { email_verified: false }))).status, 403);
  assert.equal((await call('GET', '/api/auth/me', tok('a@breadfast.com', { exp: 1 }))).status, 200); // expiry is managed by Firebase; the browser never judges it
  assert.equal(decodeJwtPayload(tok('é@breadfast.com', { name: 'محمد' }).slice(7)).name, 'محمد');
  ok('missing/malformed tokens, non-Google provider and unverified email are refused; UTF-8 names decode');
}
// 2. /api/auth/me
{
  const { fk, call } = setup();
  const m = await call('GET', '/api/auth/me', tok(MAIN));
  assert.equal(m.json.authorized, true); assert.equal(m.json.user.role, 'Main Admin'); assert.equal(fk.docs.size, 0);
  const g = await call('GET', '/api/auth/me', tok('someone@gmail.com'));
  assert.equal(g.status, 200); assert.equal(g.json.authorized, false); assert.equal(g.json.reason, 'unauthorized_domain');
  for (const bad of ['x@breadfast.com.evil.com', 'x@sub.breadfast.com', 'x@breadfast-fake.com', 'BREADFAST.HOTFOOD@GMAIL.COM.evil.com']) assert.equal((await call('GET', '/api/auth/me', tok(bad))).json.authorized, false, bad);
  const u = await call('GET', '/api/auth/me', tok('Emp@Breadfast.com'));
  assert.equal(u.json.authorized, true); assert.equal(u.json.user.role, 'User'); assert.equal(u.json.user.email, 'emp@breadfast.com');
  fk.docs.set('admins/emp@breadfast.com', { email: 'emp@breadfast.com', grantedBy: MAIN, grantedAt: 'x' });
  assert.equal((await call('GET', '/api/auth/me', tok('emp@breadfast.com'))).json.user.role, 'Admin');
  ok('Main Admin, non-company, look-alike domains, company user and Admin are classified correctly');
}
// 3. blocked account
{
  const { call } = setup((m, p) => p === 'meta/kb');
  const r = await call('GET', '/api/auth/me', tok('left@breadfast.com'));
  assert.equal(r.json.authorized, false); assert.equal(r.json.reason, 'blocked');
  ok('a company account refused by the rules (403 on meta/kb) is reported as blocked');
}
// 4. bootstrap
{
  const { call } = setup();
  assert.equal((await call('POST', '/api/auth/bootstrap', tok(MAIN))).json.role, 'Main Admin');
  assert.equal((await call('POST', '/api/auth/bootstrap', tok('a@breadfast.com'))).status, 403);
  ok('bootstrap is a no-op for the Main Admin and refused for everyone else');
}
// 5. kb/active before publishing = placeholder sample; non-company refused
{
  const { call } = setup();
  const r = await call('GET', '/api/kb/active', tok('a@breadfast.com'));
  assert.equal(r.status, 200); assert.equal(r.json.isSample, true); assert.equal(r.json.versionId, 'test-v1-initial');
  assert.equal((await call('GET', '/api/kb/active', tok('x@gmail.com'))).status, 403);
  assert.ok(!JSON.stringify(r.json).match(/EGP|@|http/i), 'placeholder sample contains no company data');
  ok('before any publish the placeholder sample is served; outsiders get 403; sample has no company data');
}
// 6. upload: permissions, validation, publish, read back
{
  const { fk, call } = setup();
  assert.equal((await call('POST', '/api/kb/upload', tok('user@breadfast.com'), { parsedWorkbook: wbOf(['A']) })).status, 403);
  assert.equal((await call('POST', '/api/kb/upload', tok('x@gmail.com'), { parsedWorkbook: wbOf(['A']) })).status, 403);
  assert.equal((await call('POST', '/api/kb/upload', tok(MAIN), { parsedWorkbook: { tabs: [] } })).status, 400);
  const up = await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'kb.xlsx', parsedWorkbook: wbOf(['Tab A', 'Tab B']) });
  assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.totalTabs, 2); assert.equal(up.json.totalRecords, 16);
  assert.equal(fk.docs.get('meta/kb')!.fileName, 'kb.xlsx');
  assert.ok([...fk.docs.keys()].some((k) => k.startsWith('auditLogs/')), 'audit log written');
  const act = await call('GET', '/api/kb/active', tok('user@breadfast.com'));
  assert.equal(act.json.isSample, false); assert.deepEqual(act.json.tabs.map((t: any) => t.name), ['Tab A', 'Tab B']); assert.equal(act.json.tabs[0].kb.records.length, 8);
  ok('only admins can publish; a published KB is served to every company user, tabs and records intact; audit log written');
}
// 7. explicit confirmation when a tab is missing
{
  const { call } = setup();
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'one.xlsx', parsedWorkbook: wbOf(['Tab A', 'Tab B', 'Tab C'], 10) });
  const r = await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'two.xlsx', parsedWorkbook: wbOf(['Tab A'], 10) });
  assert.equal(r.status, 400); assert.equal(r.json.requiresExplicitConfirmation, true); assert.deepEqual(r.json.missingTabs.sort(), ['Tab B', 'Tab C']);
  const r2 = await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'two.xlsx', parsedWorkbook: wbOf(['Tab A'], 10), explicitConfirmation: true });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  ok('missing tabs require explicit confirmation before publishing');
}
// 8. versions + rollback
{
  const { fk, call } = setup();
  assert.equal((await call('GET', '/api/kb/versions', tok('user@breadfast.com'))).status, 403);
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'v1.xlsx', parsedWorkbook: wbOf(['Tab A'], 10) });
  await new Promise((r) => setTimeout(r, 5));
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'v2.xlsx', parsedWorkbook: wbOf(['Tab A'], 12) });
  const v = await call('GET', '/api/kb/versions', tok(MAIN));
  assert.equal(v.status, 200); assert.ok(v.json.versions.length >= 3); assert.ok(v.json.versions.some((x: any) => x.isSample));
  const first = v.json.versions.find((x: any) => x.fileName === 'v1.xlsx');
  assert.equal((await call('POST', '/api/kb/rollback', tok('user@breadfast.com'), { targetVersionId: first.versionId })).status, 403);
  assert.equal((await call('POST', '/api/kb/rollback', tok(MAIN), {})).status, 400);
  assert.equal((await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: 'nope' })).status, 404);
  const rb = await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: first.versionId });
  assert.equal(rb.status, 200, JSON.stringify(rb.json));
  assert.equal(fk.docs.get('meta/kb')!.activeVersionId, first.versionId); assert.equal(fk.docs.get('meta/kb')!.totalChunks, first.totalChunks);
  assert.equal((await call('GET', '/api/kb/active', tok(MAIN))).json.tabs[0].kb.records.length, 10);
  const toSample = await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: 'test-v1-initial' });
  assert.equal(toSample.status, 200); assert.equal((await call('GET', '/api/kb/active', tok(MAIN))).json.isSample, true);
  ok('version history, rollback permissions, rollback to an older version and back to the placeholder');
}
// 9. rollback refuses a version whose chunks are unreadable
{
  const { fk, call } = setup();
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'v1.xlsx', parsedWorkbook: wbOf(['Tab A'], 10) });
  const vid = fk.docs.get('meta/kb')!.activeVersionId as string;
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'v2.xlsx', parsedWorkbook: wbOf(['Tab A'], 12) });
  fk.docs.delete(`kbVersions/${vid}/chunks/chunk_0`);
  const r = await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: vid });
  assert.equal(r.status, 409);
  assert.notEqual(fk.docs.get('meta/kb')!.activeVersionId, vid);
  ok('rollback is refused (409) when the target version has unreadable chunks; the live pointer is unchanged');
}
// 10. read failure is an error, never a silent placeholder
{
  const { fk, call } = setup();
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'v1.xlsx', parsedWorkbook: wbOf(['Tab A'], 10) });
  fk.docs.delete('kbVersions/' + fk.docs.get('meta/kb')!.activeVersionId + '/chunks/chunk_0');
  clearWorkbookCache(); // the loader keeps an in-memory cache per version; clear it to simulate a fresh page load
  const r = await call('GET', '/api/kb/active', tok('user@breadfast.com'));
  assert.equal(r.status, 503); assert.ok(r.json.error);
  ok('an unreadable active version returns 503 with the reason instead of silently showing the placeholder');
}
// 11. interceptor
{
  const { fk } = setup();
  const target: any = { fetch: undefined };
  const seen: string[] = [];
  const realFetch: any = async (u: any) => { seen.push(String(u)); return new Response('real', { status: 200 }); };
  const api = createLocalApi({ projectId: 'p', databaseId: 'd', fetchImpl: fk.fetch, sample: () => SAMPLE_KB, now: () => NOW });
  installFetchInterceptor(api, realFetch, target, 'https://x.github.io');
  const a = await target.fetch('/api/auth/me', { headers: { Authorization: tok(MAIN) } });
  assert.equal(a.status, 200); assert.equal((await a.json()).user.role, 'Main Admin');
  const b = await target.fetch('https://x.github.io/api/kb/active?x=1', { headers: new Headers({ authorization: tok('u@breadfast.com') }) });
  assert.equal((await b.json()).isSample, true);
  const p = await target.fetch('/api/kb/upload', { method: 'POST', headers: [['Authorization', tok(MAIN)]], body: JSON.stringify({ fileName: 'z.xlsx', parsedWorkbook: wbOf(['T'], 3) }) });
  assert.equal(p.status, 200);
  assert.equal((await target.fetch('/api/nope', { headers: { Authorization: tok(MAIN) } })).status, 404);
  await target.fetch('https://firestore.googleapis.com/v1/x'); await target.fetch('/assets/app.js');
  assert.deepEqual(seen, ['https://firestore.googleapis.com/v1/x', '/assets/app.js']);
  ok('fetch interceptor answers /api/* locally (header styles, query strings, POST bodies) and passes everything else through');
}

// 12. a single transient 403 must NOT lock a valid user out; a persistent one is "blocked"
{
  let calls = 0;
  const { call } = setup((m, p) => { if (m === 'GET' && p === 'meta/kb') { calls++; return calls === 1; } return false; });
  const r = await call('GET', '/api/auth/me', tok('emp@breadfast.com'));
  assert.equal(r.json.authorized, true); assert.equal(calls, 2);
  ok('one transient 403 on the access probe is re-checked and the user is NOT reported as blocked');
}
// 13. Firestore errors are retryable errors, never verdicts
{
  const a = setup((m, p) => m === 'GET' && p === 'meta/kb');
  assert.equal((await a.call('GET', '/api/auth/me', tok('emp@breadfast.com'))).json.reason, 'blocked');
  const rate = (code: number) => async () => ({ ok: false, status: code, json: async () => ({}), text: async () => '{}' }) as any;
  const mk = (code: number) => createLocalApi({ projectId: 'p', databaseId: 'd', fetchImpl: rate(code) as any, sample: () => SAMPLE_KB, now: () => NOW, sleep: async () => {} });
  const r429 = await mk(429).handle({ method: 'GET', path: '/api/auth/me', authorization: tok('emp@breadfast.com') });
  assert.equal(r429.status, 503); assert.equal(r429.json.authorized, false); assert.ok(r429.json.error);
  const r401 = await mk(401).handle({ method: 'GET', path: '/api/auth/me', authorization: tok('emp@breadfast.com') });
  assert.equal(r401.status, 401);
  const up = await mk(429).handle({ method: 'POST', path: '/api/kb/upload', authorization: tok('emp@breadfast.com'), body: { parsedWorkbook: wbOf(['A']) } });
  assert.equal(up.status, 503); // an admin is never mistaken for a plain user because of a rate limit
  const main = await mk(429).handle({ method: 'GET', path: '/api/auth/me', authorization: tok(MAIN) });
  assert.equal(main.json.authorized, true); // the Main Admin never depends on Firestore to sign in
  ok('rate limits (429), failures and rejected tokens (401) are retryable errors; the Main Admin always signs in');
}
// 14. who changed the KB, and when, is stored on each version and survives the admin losing admin rights
{
  const { fk, call } = setup();
  fk.docs.set('admins/lead@breadfast.com', { email: 'lead@breadfast.com', grantedBy: MAIN, grantedAt: 'x' });
  const up = await call('POST', '/api/kb/upload', tok('lead@breadfast.com', { name: 'Lead Person' }), { fileName: 'a.xlsx', parsedWorkbook: wbOf(['T'], 4) });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  fk.docs.delete('admins/lead@breadfast.com'); // the admin is removed afterwards
  await new Promise((r) => setTimeout(r, 3));
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'b.xlsx', parsedWorkbook: wbOf(['T'], 5) }); // a.xlsx becomes a historical version
  const v = await call('GET', '/api/kb/versions', tok(MAIN));
  const row = v.json.versions.find((x: any) => x.fileName === 'a.xlsx');
  assert.equal(row.publishedByName, 'Lead Person'); assert.equal(row.publishedBy, 'lead@breadfast.com'); assert.equal(row.publishedAt, NOW.toISOString());
  assert.equal(fk.docs.get(`kbVersions/${row.versionId}`)!.publishedByName, 'Lead Person');
  const rb = await call('POST', '/api/kb/rollback', tok(MAIN, { name: 'Main Person' }), { targetVersionId: row.versionId });
  assert.equal(rb.status, 200);
  const v2 = await call('GET', '/api/kb/versions', tok(MAIN));
  const row2 = v2.json.versions.find((x: any) => x.versionId === row.versionId);
  assert.equal(row2.lastActivatedByName, 'Main Person'); assert.ok(row2.lastActivatedAt);
  ok('each version keeps its publish time and the publisher name + email (even after the admin is removed); rollbacks are recorded too');
}
// 15. cheap pointer endpoint for fallback polling
{
  const { call } = setup();
  assert.equal((await call('GET', '/api/kb/pointer', tok('emp@breadfast.com'))).json.activeVersionId, null);
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'p.xlsx', parsedWorkbook: wbOf(['T'], 3) });
  const r = await call('GET', '/api/kb/pointer', tok('emp@breadfast.com'));
  assert.ok(r.json.activeVersionId && r.json.versionChecksum);
  assert.equal((await call('GET', '/api/kb/pointer', tok('x@gmail.com'))).status, 403);
  ok('pointer endpoint reports the active version cheaply and refuses outsiders');
}

// 16. the version marked "active" is the one the pointer really uses (also after rollbacks)
{
  const { call } = setup();
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'one.xlsx', parsedWorkbook: wbOf(['T'], 3) });
  await new Promise((r) => setTimeout(r, 5));
  await call('POST', '/api/kb/upload', tok(MAIN), { fileName: 'two.xlsx', parsedWorkbook: wbOf(['T'], 4) });
  const active = async () => (await call('GET', '/api/kb/versions', tok(MAIN))).json.versions.filter((x: any) => x.isActive).map((x: any) => x.fileName);
  assert.deepEqual(await active(), ['two.xlsx']);
  const one = (await call('GET', '/api/kb/versions', tok(MAIN))).json.versions.find((x: any) => x.fileName === 'one.xlsx');
  await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: one.versionId });
  assert.deepEqual(await active(), ['one.xlsx']);
  await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: 'test-v1-initial' });
  assert.deepEqual(await active(), ['Sample_KB.xlsx']);
  ok('exactly one version is flagged active and it follows publishes and rollbacks');
}

// ---------- version management: delete, delete all, safeguards ----------
const keysOf = (fk: any, id: string) => [...fk.docs.keys()].filter((k: string) => k === `kbVersions/${id}` || k.startsWith(`kbVersions/${id}/`));
async function publishN(call: any, names: string[]) {
  for (const [i, name] of names.entries()) {
    const r = await call('POST', '/api/kb/upload', tok(MAIN), { fileName: name, parsedWorkbook: wbOf(['T'], 3 + i) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    await new Promise((res) => setTimeout(res, 3));
  }
}
const versionsOf = async (call: any) => (await call('GET', '/api/kb/versions', tok(MAIN))).json.versions as any[];

// 17. delete one historical version: permissions, safeguards, data really removed
{
  const { fk, call } = setup();
  await publishN(call, ['v1.xlsx', 'v2.xlsx', 'v3.xlsx']);
  const vs = await versionsOf(call);
  const v1 = vs.find((x) => x.fileName === 'v1.xlsx'), v3 = vs.find((x) => x.fileName === 'v3.xlsx');
  assert.equal(v3.isActive, true);
  const del = (id: any, who = tok(MAIN)) => call('POST', '/api/kb/delete-version', who, { versionId: id });
  assert.equal((await del(v1.versionId, tok('user@breadfast.com'))).status, 403);
  assert.equal((await call('POST', '/api/kb/delete-version', tok(MAIN), {})).status, 400);
  assert.equal((await del('test-v1-initial')).status, 400);
  assert.equal((await del('nope')).status, 404);
  const activeBefore = keysOf(fk, v3.versionId).length;
  const refused = await del(v3.versionId);
  assert.equal(refused.status, 409); assert.match(refused.json.error, /active version cannot be deleted/);
  assert.equal(keysOf(fk, v3.versionId).length, activeBefore); assert.equal(fk.docs.get('meta/kb')!.activeVersionId, v3.versionId);
  assert.ok(keysOf(fk, v1.versionId).length > 1);
  const ok1 = await del(v1.versionId);
  assert.equal(ok1.status, 200, JSON.stringify(ok1.json));
  assert.equal(keysOf(fk, v1.versionId).length, 0);
  assert.ok(!(await versionsOf(call)).some((x) => x.versionId === v1.versionId));
  assert.equal(fk.docs.get('meta/kb')!.activeVersionId, v3.versionId);
  const act = await call('GET', '/api/kb/active', tok('user@breadfast.com'));
  assert.equal(act.json.isSample, false); assert.equal(act.json.tabs[0].kb.records.length, 5);
  assert.ok([...fk.docs.keys()].some((k) => k.startsWith('auditLogs/')));
  ok('delete one version: only admins; the active version and the built-in sample are refused; chunks + record are removed; the site keeps working');
}
// 18. a concurrent rollback to the version being deleted is caught (409) and the version is restored untouched
{
  const fk = fakeFirestore(); let armed = false, metaGets = 0, target = '';
  const wrapped: any = async (url: any, init: any) => {
    if (armed && (init?.method || 'GET') === 'GET' && String(url).endsWith('/documents/meta/kb') && ++metaGets === 2) {
      fk.docs.set('meta/kb', { ...fk.docs.get('meta/kb'), activeVersionId: target });
    }
    return fk.fetch(url, init);
  };
  const api = createLocalApi({ projectId: 'p', databaseId: 'd', fetchImpl: wrapped, sample: () => SAMPLE_KB, now: () => NOW, sleep: async () => {} });
  const call = (m: string, p: string, a?: string, b?: any) => api.handle({ method: m, path: p, authorization: a, body: b });
  await publishN(call, ['v1.xlsx', 'v2.xlsx']);
  const v1 = (await versionsOf(call)).find((x) => x.fileName === 'v1.xlsx');
  target = v1.versionId; armed = true;
  const r = await call('POST', '/api/kb/delete-version', tok(MAIN), { versionId: v1.versionId });
  assert.equal(r.status, 409);
  assert.ok(keysOf(fk, v1.versionId).length > 1, 'chunks untouched');
  assert.notEqual(fk.docs.get(`kbVersions/${v1.versionId}`)!.status, 'deleting');
  ok('if the version becomes active while it is being deleted, deletion stops (409) and the version is restored');
}
// 19. delete ALL historical versions: everything except the active one (also failed / half-deleted leftovers)
{
  const { fk, call } = setup();
  await publishN(call, ['v1.xlsx', 'v2.xlsx', 'v3.xlsx', 'v4.xlsx']);
  fk.docs.set('kbVersions/v-junk', { versionId: 'v-junk', status: 'failed', fileName: 'x' });
  fk.docs.set('kbVersions/v-stuck', { versionId: 'v-stuck', status: 'deleting', fileName: 'y', totalChunks: 1 });
  fk.docs.set('kbVersions/v-stuck/chunks/chunk_0', { chunkId: 'chunk_0', payloadJson: '[]' });
  const before = await versionsOf(call);
  const active = before.find((x) => x.isActive);
  assert.equal(active.fileName, 'v4.xlsx'); assert.ok(before.length >= 4);
  assert.equal((await call('POST', '/api/kb/delete-historical', tok('user@breadfast.com'), {})).status, 403);
  const r = await call('POST', '/api/kb/delete-historical', tok(MAIN), {});
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.success, true); assert.equal(r.json.deleted, 5);
  assert.equal(r.json.activeVersionId, active.versionId);
  const remaining = [...fk.docs.keys()].filter((k) => k.startsWith('kbVersions/'));
  assert.ok(remaining.length > 0 && remaining.every((k) => k.startsWith(`kbVersions/${active.versionId}`)), remaining.join(','));
  assert.equal(fk.docs.get('meta/kb')!.activeVersionId, active.versionId);
  assert.equal((await call('GET', '/api/kb/active', tok('user@breadfast.com'))).json.tabs[0].kb.records.length, 6);
  const again = await call('POST', '/api/kb/delete-historical', tok(MAIN), {});
  assert.equal(again.json.deleted, 0);
  const after = await versionsOf(call);
  assert.deepEqual(after.filter((x) => !x.isSample).map((x) => x.versionId), [active.versionId]);
  ok('delete all: every historical record (incl. failed / half-deleted leftovers) is removed; the active version and the working site are untouched; repeatable');
}
// 20. if the active version cannot be verified, NOTHING is deleted
{
  let blockMeta = false;
  const { fk, call } = setup((m, p) => blockMeta && m === 'GET' && p === 'meta/kb');
  await publishN(call, ['v1.xlsx', 'v2.xlsx']);
  const v1 = (await versionsOf(call)).find((x) => x.fileName === 'v1.xlsx');
  const notAudit = (k: string) => !k.startsWith('auditLogs/');
  const snapshot = [...fk.docs.keys()].filter(notAudit).sort();
  blockMeta = true;
  assert.equal((await call('POST', '/api/kb/delete-version', tok(MAIN), { versionId: v1.versionId })).status, 503);
  assert.equal((await call('POST', '/api/kb/delete-historical', tok(MAIN), {})).status, 503);
  assert.deepEqual([...fk.docs.keys()].filter(notAudit).sort(), snapshot); // not a single document was touched
  assert.ok(keysOf(fk, v1.versionId).length > 1);
  ok('when the active version cannot be verified, nothing is deleted (503)');
}
// 21. rollback safeguards + the list shows every stored version
{
  const { fk, call } = setup();
  await publishN(call, ['a.xlsx', 'b.xlsx', 'c.xlsx', 'd.xlsx', 'e.xlsx']);
  const vs = await versionsOf(call);
  assert.equal(vs.filter((x) => !x.isSample).length, 5);           // not capped at 3 or 10: the UI decides what to show
  assert.equal(vs.filter((x) => x.isActive).length, 1);
  const active = vs.find((x) => x.isActive);
  const same = await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: active.versionId });
  assert.equal(same.status, 409); assert.match(same.json.error, /already the active version/);
  const old = vs.find((x) => x.fileName === 'a.xlsx');
  fk.docs.set(`kbVersions/${old.versionId}`, { ...fk.docs.get(`kbVersions/${old.versionId}`)!, status: 'deleting' });
  assert.equal((await call('POST', '/api/kb/rollback', tok(MAIN), { targetVersionId: old.versionId })).status, 400);
  fk.docs.set('kbVersions/v-failed', { versionId: 'v-failed', status: 'failed', fileName: 'f', publishedAt: NOW.toISOString() });
  const shown = await versionsOf(call);
  assert.ok(!shown.some((x) => x.versionId === 'v-failed' || x.versionId === old.versionId), 'failed and half-deleted versions are hidden');
  ok('rollback to the active or a half-deleted version is refused; the list returns every usable version with exactly one active');
}
console.log(`\nALL ${n} TESTS PASSED`);
