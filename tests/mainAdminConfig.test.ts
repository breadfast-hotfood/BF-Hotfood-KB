import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_ADMIN_EMAIL, isMainAdminAddress } from '../src/utils/accessPayloads';

let n = 0;
const ok = (message: string) => { n++; console.log('  ✓', message); };

{
  const rules = readFileSync('firestore.rules', 'utf8');
  const mentions = rules.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const externalAccountMentions = mentions.filter(email => !/@breadfast\.com$/i.test(email));
  assert.ok(externalAccountMentions.length > 0, 'Firestore rules include a Main Admin address');
  assert.ok(externalAccountMentions.every(email => email === MAIN_ADMIN_EMAIL), 'all Main Admin email literals in rules match the app constant');
  ok('Firestore rules keep the same Main Admin address as the app constant');
}

{
  const root = 'src';
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  const matches = files.flatMap(path => {
    const content = readFileSync(path, 'utf8');
    return [...content.matchAll(/breadfast\.hotfood@gmail\.com/gi)].map(() => path.replace(/\\/g, '/'));
  });
  assert.deepEqual(matches, ['src/utils/accessPayloads.ts'], 'the address has one definition in src');
  ok('the Main Admin address has one source definition in src');
}

{
  for (const email of [
    'breadfast.hotfood@gmail.com',
    ' BreadFast.HotFood@Gmail.com ',
    'bread.fast.hotfood@gmail.com',
    'breadfast.hotfood+test@gmail.com',
    'breadfast.hotfood@googlemail.com',
    'b.r.e.a.d.f.a.s.t.h.o.t.f.o.o.d+x@gmail.com',
  ]) assert.equal(isMainAdminAddress(email), true, email);
  for (const email of ['breadfast.hotfood@breadfast.com', 'other@gmail.com', 'breadfast.hotfood@gmail.com.evil.com', 'hotfood@gmail.com']) {
    assert.equal(isMainAdminAddress(email), false, email);
  }
  ok('Main Admin Gmail dot, plus-tag, googlemail and look-alike behavior stays unchanged');
}

{
  const panel = readFileSync('src/components/AdminPanel.tsx', 'utf8');
  assert.match(panel, /\{isMainAdmin\s*&&\s*\([\s\S]*?<span>Rules Self-Test<\/span>[\s\S]*?<\/button>\s*\)\}/);
  assert.match(panel, /activeTab === 'rules-selftest' && isMainAdmin && \(/);
  assert.match(panel, /if \(!isMainAdmin && activeTab === 'rules-selftest'\) setActiveTab\('kb-manage'\)/);
  const testPanel = readFileSync('src/components/RulesSelfTestPanel.tsx', 'utf8');
  assert.match(testPanel, /if \(!isMainAdmin\) return;/);
  assert.match(testPanel, /if \(!isMainAdmin\) return <p[^>]*>Main Admin only\./);
  ok('self-test tab and panel execution are gated to Main Admin');
}

console.log(`\nALL ${n} TESTS PASSED`);
