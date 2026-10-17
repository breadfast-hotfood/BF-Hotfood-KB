import assert from 'node:assert/strict';
import { isMainAdminAddress } from '../src/utils/accessPayloads';
import { blockEmail } from '../src/utils/adminManagementRest';

let n = 0; const ok = (m: string) => { n++; console.log('  ✓', m); };
for (const e of ['breadfast.hotfood@gmail.com', ' BreadFast.HotFood@Gmail.com ', 'bread.fast.hotfood@gmail.com', 'breadfast.hotfood+test@gmail.com', 'breadfast.hotfood@googlemail.com', 'b.r.e.a.d.f.a.s.t.h.o.t.f.o.o.d+x@gmail.com']) assert.equal(isMainAdminAddress(e), true, e);
for (const e of ['breadfast.hotfood@breadfast.com', 'other@gmail.com', 'breadfast.hotfood@gmail.com.evil.com', 'hotfood@gmail.com']) assert.equal(isMainAdminAddress(e), false, e);
ok('the Main Admin address and its Gmail look-alikes are recognised; others are not');

let network = 0;
(globalThis as any).fetch = async () => { network++; throw new Error('must not be called'); };
for (const target of ['breadfast.hotfood@gmail.com', 'Breadfast.Hotfood@Gmail.com', 'bread.fast.hotfood+x@gmail.com']) {
  const r = await blockEmail('t', target, 'breadfast.hotfood@gmail.com');
  assert.equal(r.success, false); assert.equal(r.status, 403); assert.match(r.error!, /Main Admin cannot be blocked/);
}
assert.equal(network, 0);
ok('blocking the Main Admin (or a look-alike) is refused before any request is sent');
console.log(`\nALL ${n} TESTS PASSED`);
