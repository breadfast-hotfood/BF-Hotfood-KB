import assert from 'node:assert/strict';
import { createPointerWatcher, pointerKey } from '../src/utils/pointerWatcher';

let n = 0; const ok = (m: string) => { n++; console.log('  ✓', m); };
const m = (id: string, sum = 'c') => ({ activeVersionId: id, versionChecksum: sum });
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(extra: any = {}) {
  const changes: any[] = []; let emit: (x: any) => void = () => {}; let fail: (e: any) => void = () => {}; let unsubCalled = 0;
  let pointer: any = m('v1'); let t = 0; const timers: { fn: () => void; ms: number; id: number }[] = []; const cleared: number[] = [];
  let denied = 0;
  const w = createPointerWatcher({
    subscribe: (onData, onError) => { emit = onData; fail = onError; return () => { unsubCalled++; }; },
    fetchPointer: async () => (typeof pointer === 'function' ? pointer() : pointer),
    onChange: (x) => changes.push(x), onPermissionDenied: () => { denied++; },
    now: () => t, setIntervalFn: (fn, ms) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; }, clearIntervalFn: (id) => { cleared.push(id); },
    ...extra,
  });
  return { w, changes, emit: (x: any) => emit(x), fail: (e: any) => fail(e), setPointer: (x: any) => { pointer = x; }, advance: (ms: number) => { t += ms; }, timers, cleared, get unsub() { return unsubCalled; }, get denied() { return denied; } };
}

{
  const h = harness(); h.w.start();
  h.emit(m('v1')); h.emit(m('v1')); h.emit(m('v2')); h.emit(m('v2', 'other')); h.emit(null); h.emit(null);
  assert.deepEqual(h.changes.map(pointerKey), ['v1:c', 'v2:c', 'v2:other', 'none']);
  ok('listener: first value and each real change are reported once; duplicates are ignored');
}
{
  const h = harness({ pollMs: 1000 }); h.w.start();
  h.fail({ code: 'unavailable' }); await tick();
  assert.equal(h.w.isFallback(), true); assert.equal(h.timers[0].ms, 1000);
  assert.deepEqual(h.changes.map(pointerKey), ['v1:c']);
  h.setPointer(m('v2')); h.timers[0].fn(); await tick();
  assert.deepEqual(h.changes.map(pointerKey), ['v1:c', 'v2:c']);
  ok('if the live listener fails the watcher falls back to polling and still detects changes');
}
{
  const h = harness({ isVisible: () => false }); h.w.start(); h.fail({ code: 'unavailable' }); await tick();
  const before = h.changes.length; h.setPointer(m('v9')); h.timers[0].fn(); await tick();
  assert.equal(h.changes.length, before);
  ok('background tabs do not poll (saves reads)');
}
{
  const h = harness(); h.w.start(); h.fail({ code: 'permission-denied' });
  assert.equal(h.denied, 1); assert.equal(h.w.isFallback(), false);
  ok('permission-denied triggers the access re-check instead of polling');
}
{
  let calls = 0; const h = harness({ minGapMs: 20000 }); h.setPointer(() => { calls++; return m('v1'); }); h.w.start();
  await h.w.checkNow(); await h.w.checkNow(); assert.equal(calls, 1);
  h.advance(25000); await h.w.checkNow(); assert.equal(calls, 2);
  h.setPointer(() => { throw new Error('net'); }); h.advance(25000); await h.w.checkNow();
  h.setPointer(() => undefined); h.advance(25000); await h.w.checkNow();
  ok('focus/online checks are throttled and a failed check is ignored');
}
{
  const h = harness(); h.w.start(); h.fail({ code: 'unavailable' }); await tick();
  h.w.stop(); assert.equal(h.unsub, 1); assert.deepEqual(h.cleared, [1]);
  h.emit(m('v5')); assert.ok(!h.changes.map(pointerKey).includes('v5:c'));
  ok('stop() unsubscribes, clears the timer and ignores late events');
}
console.log(`\nALL ${n} TESTS PASSED`);
