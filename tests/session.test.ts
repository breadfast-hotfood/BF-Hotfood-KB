import assert from 'node:assert/strict';
import { fetchSession, fetchActiveKb } from '../src/utils/session';

const R = (status: number, body: any, asText = false) => ({ ok: status < 300, status, json: async () => { if (asText) throw new Error('not json'); return body; } }) as any;
const noSleep = async () => {};
let n = 0; const ok = (m: string) => { n++; console.log('  ✓', m); };
const user = { email: 'a@breadfast.com', role: 'User' };

{
  const calls: boolean[] = [];
  const r = await fetchSession({ getToken: async (f) => { calls.push(f); return 't'; }, fetchFn: (async () => R(200, { authorized: true, user })) as any, sleep: noSleep });
  assert.equal(r.kind, 'authorized'); assert.deepEqual(calls, [false]);
  ok('authorized on the first attempt, no forced token refresh');
}
{
  let i = 0; const sleeps: number[] = [];
  const f: any = async () => { i++; if (i === 1) throw new TypeError('Failed to fetch'); if (i === 2) return R(503, { authorized: false, error: 'Temporary problem' }); if (i === 3) return R(200, null, true); return R(200, { authorized: true, user }); };
  const r = await fetchSession({ getToken: async () => 't', fetchFn: f, sleep: async (ms) => { sleeps.push(ms); }, attempts: 5 });
  assert.equal(r.kind, 'authorized'); assert.equal(i, 4); assert.deepEqual(sleeps, [600, 1200, 2400]);
  ok('network error, HTTP 503 and a non-JSON answer are retried with backoff until it works');
}
{
  const forced: boolean[] = []; let i = 0;
  const f: any = async () => (++i === 1 ? R(401, { authorized: false, error: 'ID token rejected' }) : R(200, { authorized: true, user }));
  const r = await fetchSession({ getToken: async (force) => { forced.push(force); return 't'; }, fetchFn: f, sleep: noSleep });
  assert.equal(r.kind, 'authorized'); assert.deepEqual(forced, [false, true]);
  ok('a rejected token (401) is refreshed and retried');
}
{
  for (const reason of ['unauthorized_domain', 'blocked'] as const) {
    let i = 0; const f: any = async () => { i++; return R(200, { authorized: false, reason, email: 'x@gmail.com', name: 'X' }); };
    const r: any = await fetchSession({ getToken: async () => 't', fetchFn: f, sleep: noSleep });
    assert.equal(r.kind, 'denied'); assert.equal(r.reason, reason); assert.equal(r.email, 'x@gmail.com'); assert.equal(i, 1);
  }
  ok('"unauthorized_domain" and "blocked" verdicts are returned immediately and are the only way to show the restricted screens');
}
{
  let i = 0;
  const r: any = await fetchSession({ getToken: async () => 't', fetchFn: (async () => { i++; return R(500, { error: 'boom' }); }) as any, sleep: noSleep, attempts: 3 });
  assert.equal(r.kind, 'error'); assert.equal(r.message, 'boom'); assert.equal(i, 3);
  const t: any = await fetchSession({ getToken: async () => { throw new Error('offline'); }, fetchFn: (async () => R(200, {})) as any, sleep: noSleep, attempts: 2 });
  assert.equal(t.kind, 'error'); assert.equal(t.message, 'offline');
  ok('a persistent failure becomes a retryable error (never "Access restricted")');
}
{
  let i = 0;
  const f: any = async () => (++i < 3 ? R(503, { error: 'Cannot read chunks' }) : R(200, { fileName: 'k.xlsx', tabs: [{ name: 'A' }], versionId: 'v1', isSample: false }));
  const r: any = await fetchActiveKb({ getToken: async () => 't', fetchFn: f, sleep: noSleep });
  assert.equal(r.ok, true); assert.equal(r.data.versionId, 'v1'); assert.equal(i, 3);
  const d: any = await fetchActiveKb({ getToken: async () => 't', fetchFn: (async () => R(403, { error: 'Access denied: account not authorized to view KB data.' })) as any, sleep: noSleep });
  assert.equal(d.ok, false); assert.equal(d.forbidden, true);
  const e: any = await fetchActiveKb({ getToken: async () => 't', fetchFn: (async () => R(503, { error: 'down' })) as any, sleep: noSleep, attempts: 2 });
  assert.equal(e.ok, false); assert.equal(e.forbidden, false); assert.equal(e.message, 'down');
  ok('KB loading retries transient failures, stops on a real 403, and reports the reason when it gives up');
}
console.log(`\nALL ${n} TESTS PASSED`);
