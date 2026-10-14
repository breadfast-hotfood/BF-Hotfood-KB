import assert from 'node:assert/strict';
import {
  buildMemberCreatePayload,
  buildAdminGrantPayload,
  buildBlockedPayload,
  validateDocumentSchema,
  isCompanyEmail,
  isMainAdmin,
  MAIN_ADMIN_EMAIL,
} from '../src/utils/accessPayloads';

console.log('--- RUNNING PHASE 5 ACCESS MODEL AUTOMATED TESTS ---');

// 1. Test member create payload against rules requirements:
// hasOnly(['email', 'name', 'firstSeenAt', 'lastSeenAt'])
// hasAll(['email', 'name', 'firstSeenAt', 'lastSeenAt'])
// email == target, name is string >0 <=200, firstSeenAt is string, lastSeenAt is string
{
  const email = 'employee.one@breadfast.com';
  const name = 'Employee One';
  const iso = new Date().toISOString();
  const payload = buildMemberCreatePayload(email, name, iso);

  assert.equal(payload.email, 'employee.one@breadfast.com');
  assert.equal(payload.name, 'Employee One');
  assert.equal(payload.firstSeenAt, iso);
  assert.equal(payload.lastSeenAt, iso);

  const expectedMemberKeys = ['email', 'name', 'firstSeenAt', 'lastSeenAt'];
  assert.equal(validateDocumentSchema(payload, expectedMemberKeys), true, 'Member payload schema matches exactly');
  assert.equal(typeof payload.name, 'string');
  assert.equal(payload.name.length > 0 && payload.name.length <= 200, true);
  console.log('✓ Member create payload builder complies strictly with rules schema');
}

// 2. Test admin grant payload against rules requirements:
// hasOnly(['email', 'grantedBy', 'grantedAt'])
// hasAll(['email', 'grantedBy', 'grantedAt'])
// email == target, grantedBy == callerEmail, grantedAt is string
{
  const targetEmail = 'lead.agent@breadfast.com';
  const caller = 'breadfast.hotfood@gmail.com';
  const iso = new Date().toISOString();
  const payload = buildAdminGrantPayload(targetEmail, caller, iso);

  assert.equal(payload.email, 'lead.agent@breadfast.com');
  assert.equal(payload.grantedBy, 'breadfast.hotfood@gmail.com');
  assert.equal(payload.grantedAt, iso);

  const expectedAdminKeys = ['email', 'grantedBy', 'grantedAt'];
  assert.equal(validateDocumentSchema(payload, expectedAdminKeys), true, 'Admin payload schema matches exactly');
  assert.equal(isCompanyEmail(payload.email), true, 'Admin target is company email');
  console.log('✓ Admin grant payload builder complies strictly with rules schema');
}

// 3. Test blocked payload against rules requirements:
// hasOnly(['email', 'blockedBy', 'blockedAt'])
// hasAll(['email', 'blockedBy', 'blockedAt'])
// email == target, blockedBy == callerEmail, blockedAt is string
{
  const targetEmail = 'departed.user@breadfast.com';
  const caller = 'breadfast.hotfood@gmail.com';
  const iso = new Date().toISOString();
  const payload = buildBlockedPayload(targetEmail, caller, iso);

  assert.equal(payload.email, 'departed.user@breadfast.com');
  assert.equal(payload.blockedBy, 'breadfast.hotfood@gmail.com');
  assert.equal(payload.blockedAt, iso);

  const expectedBlockedKeys = ['email', 'blockedBy', 'blockedAt'];
  assert.equal(validateDocumentSchema(payload, expectedBlockedKeys), true, 'Blocked payload schema matches exactly');
  console.log('✓ Blocked payload builder complies strictly with rules schema');
}

// 4. Test company domain regex matcher strictly against rules specification:
// e.matches('[^@]+@breadfast[.]com')
{
  // Allowed company emails
  assert.equal(isCompanyEmail('user@breadfast.com'), true);
  assert.equal(isCompanyEmail('first.last@breadfast.com'), true);
  assert.equal(isCompanyEmail('user_123@breadfast.com'), true);
  assert.equal(isCompanyEmail('USER@BREADFAST.COM'), true);

  // Rejected emails: subdomains, look-alikes, other providers
  assert.equal(isCompanyEmail('user@sub.breadfast.com'), false, 'Subdomains not allowed');
  assert.equal(isCompanyEmail('user@breadfast.com.evil.com'), false, 'Look-alike prefix domain rejected');
  assert.equal(isCompanyEmail('user@breadfast-fake.com'), false, 'Hyphenated domain rejected');
  assert.equal(isCompanyEmail('breadfast.hotfood@gmail.com'), false, 'Gmail is not company email');
  assert.equal(isCompanyEmail('attacker@evil.com'), false);
  assert.equal(isCompanyEmail('@breadfast.com'), false, 'Empty user part rejected');
  console.log('✓ Company domain matcher enforces exact @breadfast.com regex (no sub-domains or look-alikes)');
}

// 5. Test Main Admin identity anchor
{
  assert.equal(isMainAdmin('breadfast.hotfood@gmail.com'), true);
  assert.equal(isMainAdmin('BREADFAST.HOTFOOD@GMAIL.COM'), true);
  assert.equal(isMainAdmin('breadfast.hotfood@breadfast.com'), false);
  assert.equal(isMainAdmin('other@gmail.com'), false);
  console.log('✓ Main Admin anchor uniquely identifies breadfast.hotfood@gmail.com');
}

// 6. Test schema validator rejects missing or extra keys
{
  const badWithExtra = {
    email: 'test@breadfast.com',
    grantedBy: 'admin@breadfast.com',
    grantedAt: new Date().toISOString(),
    extraField: 'forbidden',
  };
  assert.equal(validateDocumentSchema(badWithExtra, ['email', 'grantedBy', 'grantedAt']), false, 'Extra field caught');

  const badWithMissing = {
    email: 'test@breadfast.com',
    grantedBy: 'admin@breadfast.com',
  };
  assert.equal(validateDocumentSchema(badWithMissing, ['email', 'grantedBy', 'grantedAt']), false, 'Missing field caught');
  console.log('✓ Schema validator rejects extra or missing keys strictly');
}

console.log('ALL PHASE 5 ACCESS MODEL TESTS PASSED SUCCESFULLY');
