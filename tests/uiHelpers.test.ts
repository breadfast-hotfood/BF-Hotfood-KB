import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { orderVersions, visibleVersions, isDeletable, deletableVersions, canRollback, DEFAULT_VISIBLE_VERSIONS } from '../src/utils/versionList';
import { shouldCloseOnBackdrop } from '../src/utils/backdropClose';
import { withoutDividerAnnotationNotes } from '../src/utils/notesCleanup';

let n = 0; const ok = (m: string) => { n++; console.log('  ✓', m); };
const v = (id: string, extra: any = {}) => ({ versionId: id, publishedAt: `2026-10-${String(extra.day ?? 1).padStart(2, '0')}T10:00:00.000Z`, ...extra });

// ----- version list rules -----
{
  const list = [v('old', { day: 1 }), v('mid', { day: 5 }), v('new', { day: 9 }), v('active-old', { day: 2, isActive: true }), v('older', { day: 0 + 1 }), { versionId: 'sample', isSample: true, isDefault: true, publishedAt: '2026-01-01T00:00:00.000Z' }];
  const ordered = orderVersions(list);
  assert.deepEqual(ordered.map((x) => x.versionId).slice(0, 4), ['active-old', 'new', 'mid', 'old']);
  assert.equal(ordered[0].isActive, true);
  assert.equal(DEFAULT_VISIBLE_VERSIONS, 3);
  assert.deepEqual(visibleVersions(ordered, false).map((x) => x.versionId), ['active-old', 'new', 'mid']);
  assert.equal(visibleVersions(ordered, true).length, 6);
  assert.equal(visibleVersions(ordered.slice(0, 2), false).length, 2);
  ok('active version first, only 3 shown by default, "show more" reveals the rest; the active version is always visible');
}
{
  const active = v('a', { isActive: true }), hist = v('h'), sample = { versionId: 's', isSample: true, isDefault: true };
  assert.equal(isDeletable(active), false); assert.equal(isDeletable(sample), false); assert.equal(isDeletable(hist), true);
  assert.deepEqual(deletableVersions([active, hist, sample, v('h2')]).map((x) => x.versionId), ['h', 'h2']);
  assert.equal(canRollback(active), false); assert.equal(canRollback(hist), true); assert.equal(canRollback(sample), true);
  assert.equal(canRollback(v('f', { status: 'failed' })), false); assert.equal(canRollback(v('d', { status: 'deleting' })), false);
  ok('the active version is never deletable or a rollback target; the sample is never deletable; "delete all" targets only historical versions');
}
// ----- click outside to close -----
{
  const wrapper = {}, card = {}, other = {};
  assert.equal(shouldCloseOnBackdrop(wrapper, wrapper, wrapper), true);   // press + click on the empty area
  assert.equal(shouldCloseOnBackdrop(card, card, wrapper), false);        // click inside the window
  assert.equal(shouldCloseOnBackdrop(card, wrapper, wrapper), false);     // press inside, release outside (text selection)
  assert.equal(shouldCloseOnBackdrop(wrapper, card, wrapper), false);     // press outside, release inside
  assert.equal(shouldCloseOnBackdrop(null, wrapper, wrapper), false);
  assert.equal(shouldCloseOnBackdrop(other, other, wrapper), false);
  ok('a modal closes only when the empty area outside it is pressed and clicked; never from inside or while selecting text');
}
// ----- notes cleanup for versions published before the parser fix -----
{
  const tab: any = {
    name: 'T',
    kb: {
      importantNotes: ['Real note one', 'Customer Support Experience › Retention Team Call: Quality Team Validation', 'Late Orders › Unknown Column: keep me', 'A › B › C: not generated', 'Note with › arrow'],
      fieldOrder: [{ key: 'Category' }, { key: 'Retention Team Call\nمكالمة' }],
      records: [{ _section: 'Late Orders' }, { _section: 'Customer Support Experience' }],
    },
  };
  const cleaned = withoutDividerAnnotationNotes(tab);
  assert.deepEqual(cleaned.kb.importantNotes, ['Real note one', 'Late Orders › Unknown Column: keep me', 'A › B › C: not generated', 'Note with › arrow']);
  assert.equal(tab.kb.importantNotes.length, 5); // the input is not mutated
  const clean: any = { kb: { importantNotes: ['x'], fieldOrder: [], records: [] } };
  assert.equal(withoutDividerAnnotationNotes(clean), clean);
  assert.equal(withoutDividerAnnotationNotes({} as any).kb, undefined);
  ok('only the exact generated "<section> › <column>: <text>" note is removed from already-published data; every other note is kept');
}
// ----- favicon -----
{
  const html = readFileSync('index.html', 'utf8');
  const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 3, 'icon links present');
  for (const h of hrefs) assert.ok(existsSync('public' + h), `${h} exists in /public`);
  assert.ok(hrefs.includes('/favicon.svg') && hrefs.includes('/favicon.ico') && hrefs.includes('/apple-touch-icon.png'));
  assert.match(html, /<meta name="theme-color"/);
  ok('index.html links the favicon (svg, png, ico, apple-touch) and every referenced file exists in /public');
}
console.log(`\nALL ${n} TESTS PASSED`);
