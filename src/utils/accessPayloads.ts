export interface MemberDoc {
  email: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AdminDoc {
  email: string;
  grantedBy: string;
  grantedAt: string;
}

export interface BlockedDoc {
  email: string;
  blockedBy: string;
  blockedAt: string;
}

/**
 * Validates that an object contains strictly only the expected keys and all expected keys.
 */
export function validateDocumentSchema(data: Record<string, any>, expectedKeys: string[]): boolean {
  const keys = Object.keys(data);
  if (keys.length !== expectedKeys.length) return false;
  return expectedKeys.every(k => keys.includes(k) && data[k] !== undefined);
}

/**
 * Helper to build Member document payload (create)
 */
export function buildMemberCreatePayload(email: string, name: string, dateIso: string = new Date().toISOString()): MemberDoc {
  return {
    email: email.trim().toLowerCase(),
    name: name.trim().slice(0, 200),
    firstSeenAt: dateIso,
    lastSeenAt: dateIso,
  };
}

/**
 * Helper to build Admin document payload (grant)
 */
export function buildAdminGrantPayload(email: string, grantedBy: string, dateIso: string = new Date().toISOString()): AdminDoc {
  return {
    email: email.trim().toLowerCase(),
    grantedBy: grantedBy.trim().toLowerCase(),
    grantedAt: dateIso,
  };
}

/**
 * Helper to build Blocked document payload (block)
 */
export function buildBlockedPayload(email: string, blockedBy: string, dateIso: string = new Date().toISOString()): BlockedDoc {
  return {
    email: email.trim().toLowerCase(),
    blockedBy: blockedBy.trim().toLowerCase(),
    blockedAt: dateIso,
  };
}

export const MAIN_ADMIN_EMAIL = 'breadfast.hotfood@gmail.com';

export function isCompanyEmail(email: string): boolean {
  return /^[^@]+@breadfast\.com$/i.test(email.trim());
}

export function isMainAdmin(email: string): boolean {
  return email.trim().toLowerCase() === MAIN_ADMIN_EMAIL;
}

/**
 * True for the Main Admin address AND its Gmail look-alikes (dots, +tags, googlemail.com), so nobody can even try to
 * add the Main Admin (or a variant of it) to the blocked list. The security rules independently ignore the blocked list
 * for the Main Admin, so this is an extra guard in the UI and in the REST helper.
 */
export function isMainAdminAddress(email: string): boolean {
  const norm = (address: string): string => {
    const [local = '', domainRaw = ''] = address.trim().toLowerCase().split('@');
    const domain = domainRaw === 'googlemail.com' ? 'gmail.com' : domainRaw;
    if (domain !== 'gmail.com') return `${local}@${domain}`;
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  };
  return norm(email) === norm(MAIN_ADMIN_EMAIL);
}
