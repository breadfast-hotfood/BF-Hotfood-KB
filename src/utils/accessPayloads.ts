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
