import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { orderVersions, visibleVersions, isDeletable, deletableVersions, canRollback, DEFAULT_VISIBLE_VERSIONS } from '../src/utils/versionList';
import { shouldCloseOnBackdrop } from '../src/utils/backdropClose';
import { withoutDividerAnnotationNotes } from '../src/utils/notesCleanup';
import { tabLabel } from '../src/utils/tabLabel';
import { shouldCollapse, COLLAPSE_MAX_CHARS, COLLAPSE_MAX_WORDS, COLLAPSE_MAX_LINES } from '../src/utils/collapse';

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
// ----- tab labels are always one line -----
{
  assert.equal(tabLabel('KPIs', 0), 'KPIs');
  assert.equal(tabLabel('  Customer Requests  ', 1), 'Customer Requests');
  assert.equal(tabLabel('Snooze Proccess & Templates\nSnooze Process & Templates', 8), 'Snooze Proccess & Templates Snooze Process & Templates');
  assert.equal(tabLabel('A\r\nB\tC\u2028D\u00A0E\u000BF', 0), 'A B C D E F');
  assert.equal(tabLabel('Soc\u200Bial', 0), 'Social');
  assert.equal(tabLabel('   \n ', 4), 'Sheet 5');
  assert.equal(tabLabel(undefined, 0), 'Sheet 1');
  assert.equal(/[\n\r\u2028\u2029]/.test(tabLabel('x\ny', 0)), false);
  ok('tab labels collapse line breaks / odd whitespace into one line and fall back to "Sheet N"');
}
{
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const bar = css.match(/\.tabbar \{[^}]*\}/)![0];
  assert.ok(/align-items:\s*center/.test(bar), 'tabbar must not stretch tabs');
  const tab = css.match(/\n\.tab \{[^}]*\}/)![0];
  assert.ok(/white-space:\s*nowrap/.test(tab));
  const active = css.match(/\.tab\.active \{[^}]*\}/)![0];
  assert.ok(/color-mix/.test(active) && !/background:\s*var\(--accent-dim\)/.test(active), 'active tab uses the light tint');
  assert.ok(/--accent:/.test(css) && /html\[data-theme="dark"\][^{]*\{[^}]*--accent:/.test(css), 'accent var exists in light and dark themes');
  ok('tab bar CSS: centered items, nowrap, light active pill built only from theme variables (light + dark)');
}
// ----- long field values collapse in the case drawer -----
{
  assert.equal([COLLAPSE_MAX_CHARS, COLLAPSE_MAX_WORDS, COLLAPSE_MAX_LINES].join(','), '600,120,12');
  assert.equal(shouldCollapse(''), false);
  assert.equal(shouldCollapse('short value'), false);
  assert.equal(shouldCollapse('x'.repeat(600)), false);
  assert.equal(shouldCollapse('x'.repeat(601)), true);                              // characters
  assert.equal(shouldCollapse(Array(120).fill('w').join(' ')), false);
  assert.equal(shouldCollapse(Array(121).fill('w').join(' ')), true);               // words
  assert.equal(shouldCollapse(Array(12).fill('l').join('\n')), false);
  assert.equal(shouldCollapse(Array(13).fill('l').join('\n')), true);               // lines
  assert.equal(shouldCollapse(Array(13).fill('l').join('\r\n')), true);
  assert.equal(shouldCollapse('\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n'), false);       // only blank lines: nothing to hide
  assert.equal(shouldCollapse(Array(125).fill('كلمة').join(' ')), true);            // Arabic words
  assert.equal(shouldCollapse('العميل اشتكى\n\nCase 1'), false);
  ok('collapse thresholds: >600 chars, >120 words or >12 lines (Arabic and English); short values stay open');
}
{
  const rd = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const drawer = rd('../src/components/Drawer.tsx');
  assert.ok(/<CollapsibleValue[^>]*text=\{val\}/.test(drawer), 'drawer wraps each field value');
  assert.ok(/handleCopy\(f\.key, val\)/.test(drawer), 'Copy still copies the FULL value');
  assert.ok(/linkify\(esc\(line\)\)/.test(drawer), 'values are still escaped before linkify');
  const cv = rd('../src/components/CollapsibleValue.tsx');
  assert.ok(/See more/.test(cv) && /Show less/.test(cv) && /aria-expanded/.test(cv));
  assert.ok(/\{children\}/.test(cv), 'full text always stays in the DOM (clipped by CSS only)');
  const css = rd('../src/index.css');
  const body = css.match(/\.drawer-body \{[^}]*\}/)![0];
  assert.ok(/overflow-y:\s*auto/.test(body) && /min-height:\s*0/.test(body), 'drawer body scrolls to its end');
  assert.ok(/\.drawer-head \{[^}]*flex-shrink:\s*0/.test(css), 'drawer header does not shrink');
  assert.ok(/\.fval-clip\.collapsed \{[^}]*max-height/.test(css) && /\.fval-clip\.collapsed::after/.test(css), 'collapsed clip + fade exist');
  assert.ok(/var\(--fade-bg\)/.test(css));
  ok('drawer wiring: Copy copies full text, values escaped, links stay in DOM, body scrolls to the end, header fixed');
}
console.log(`\nALL ${n} TESTS PASSED`);
