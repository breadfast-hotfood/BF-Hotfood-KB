import firebaseConfig from '../../firebase-applet-config.json';
import { createFirestoreRest, toFirestoreValue } from './firestoreRest';
import { listCollectionDocs } from './firestoreList';
import {
  MemberDoc,
  AdminDoc,
  BlockedDoc,
  buildMemberCreatePayload,
  buildAdminGrantPayload,
  buildBlockedPayload,
  MAIN_ADMIN_EMAIL,
  isCompanyEmail,
} from './accessPayloads';

export const fsClient = createFirestoreRest({
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
});

const DOCS_BASE = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

/**
 * Register or update member in members/{email} collection.
 * - If 404, creates with full 4 fields (PATCH with currentDocument.exists=false).
 * - If exists, updates lastSeenAt (and name if changed) at most once every 6 hours (updateMask).
 * - Never registers Main Admin.
 */
export async function registerOrUpdateMember(
  token: string,
  email: string,
  name: string
): Promise<{ status: 'created' | 'updated' | 'skipped_main_admin' | 'skipped_throttled' | 'error'; error?: string }> {
  const normEmail = email.trim().toLowerCase();
  if (normEmail === MAIN_ADMIN_EMAIL.toLowerCase()) {
    return { status: 'skipped_main_admin' };
  }
  if (!isCompanyEmail(normEmail)) {
    return { status: 'error', error: 'Not a company email' };
  }

  const url = `https://firestore.googleapis.com/v1/${DOCS_BASE}/members/${encodeURIComponent(normEmail)}`;

  try {
    // 1. GET members/{email}
    const getRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const now = new Date();
    const nowIso = now.toISOString();

    if (getRes.status === 404) {
      // 2. Create with full 4 fields (precondition exists=false)
      const payload = buildMemberCreatePayload(normEmail, name || 'Breadfast Employee', nowIso);
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(payload)) {
        fields[k] = toFirestoreValue(v);
      }

      const createRes = await fetch(`${url}?currentDocument.exists=false`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        return { status: 'error', error: `Create member failed (${createRes.status}): ${errText}` };
      }
      return { status: 'created' };
    }

    if (getRes.ok) {
      const existingDoc = await getRes.json();
      const lastSeenRaw = existingDoc.fields?.lastSeenAt?.stringValue;
      const existingName = existingDoc.fields?.name?.stringValue;

      // Throttle: only update if > 6 hours or name changed
      let shouldUpdate = true;
      if (lastSeenRaw) {
        const lastSeenDate = new Date(lastSeenRaw);
        const hoursDiff = (now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60);
        if (hoursDiff < 6 && existingName === (name || existingName)) {
          shouldUpdate = false;
        }
      }

      if (!shouldUpdate) {
        return { status: 'skipped_throttled' };
      }

      // Update mask with exactly name and lastSeenAt
      const fieldsToUpdate: Record<string, any> = {
        lastSeenAt: toFirestoreValue(nowIso),
      };
      const queryParams = ['updateMask.fieldPaths=lastSeenAt'];

      if (name && name !== existingName) {
        fieldsToUpdate.name = toFirestoreValue(name.trim().slice(0, 200));
        queryParams.push('updateMask.fieldPaths=name');
      }

      const updateRes = await fetch(`${url}?${queryParams.join('&')}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: fieldsToUpdate }),
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        return { status: 'error', error: `Update member failed (${updateRes.status}): ${errText}` };
      }
      return { status: 'updated' };
    }

    return { status: 'error', error: `Unexpected get status: ${getRes.status}` };
  } catch (err: any) {
    return { status: 'error', error: err.message || String(err) };
  }
}

/**
 * Fetch all admins
 */
export async function fetchAdmins(token: string): Promise<AdminDoc[]> {
  try {
    const raw = await listCollectionDocs({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      collection: 'admins',
      token,
    });
    return raw.map((d: any) => ({
      email: (d.email || d.__id || '').trim().toLowerCase(),
      grantedBy: (d.grantedBy || '').trim().toLowerCase(),
      grantedAt: d.grantedAt || '',
    }));
  } catch (err: any) {
    const is403 = err?.message?.includes('403') || err?.message?.includes('PERMISSION_DENIED');
    if (!is403) console.warn('fetchAdmins notice:', err);
    throw err;
  }
}

/**
 * Fetch all members
 */
export async function fetchMembers(token: string): Promise<MemberDoc[]> {
  try {
    const raw = await listCollectionDocs({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      collection: 'members',
      token,
    });
    return raw.map((d: any) => ({
      email: (d.email || d.__id || '').trim().toLowerCase(),
      name: d.name || '',
      firstSeenAt: d.firstSeenAt || '',
      lastSeenAt: d.lastSeenAt || '',
    }));
  } catch (err: any) {
    const is403 = err?.message?.includes('403') || err?.message?.includes('PERMISSION_DENIED');
    if (!is403) console.warn('fetchMembers notice:', err);
    throw err;
  }
}

/**
 * Fetch blocked emails (Main Admin only)
 */
export async function fetchBlocked(token: string): Promise<BlockedDoc[]> {
  try {
    const raw = await listCollectionDocs({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      collection: 'blocked',
      token,
    });
    return raw.map((d: any) => ({
      email: (d.email || d.__id || '').trim().toLowerCase(),
      blockedBy: (d.blockedBy || '').trim().toLowerCase(),
      blockedAt: d.blockedAt || '',
    }));
  } catch (err: any) {
    const is403 = err?.message?.includes('403') || err?.message?.includes('PERMISSION_DENIED');
    if (!is403) console.warn('fetchBlocked notice:', err);
    throw err;
  }
}

/**
 * Grant Admin to a company user
 * PATCH admins/{email}?currentDocument.exists=false
 */
export async function grantAdmin(token: string, targetEmail: string, callerEmail: string): Promise<{ success: boolean; status: number; error?: string }> {
  const normTarget = targetEmail.trim().toLowerCase();
  const payload = buildAdminGrantPayload(normTarget, callerEmail);
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    fields[k] = toFirestoreValue(v);
  }

  const url = `https://firestore.googleapis.com/v1/${DOCS_BASE}/admins/${encodeURIComponent(normTarget)}?currentDocument.exists=false`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }
    const errText = await res.text();
    return { success: false, status: res.status, error: errText };
  } catch (err: any) {
    return { success: false, status: 0, error: err.message };
  }
}

/**
 * Revoke Admin
 * DELETE admins/{email}
 */
export async function revokeAdmin(token: string, targetEmail: string): Promise<{ success: boolean; status: number; error?: string }> {
  const normTarget = targetEmail.trim().toLowerCase();
  const url = `https://firestore.googleapis.com/v1/${DOCS_BASE}/admins/${encodeURIComponent(normTarget)}`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }
    const errText = await res.text();
    return { success: false, status: res.status, error: errText };
  } catch (err: any) {
    return { success: false, status: 0, error: err.message };
  }
}

/**
 * Block email (Main Admin only)
 * PATCH blocked/{email}?currentDocument.exists=false
 */
export async function blockEmail(token: string, targetEmail: string, callerEmail: string): Promise<{ success: boolean; status: number; error?: string }> {
  const normTarget = targetEmail.trim().toLowerCase();
  const payload = buildBlockedPayload(normTarget, callerEmail);
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    fields[k] = toFirestoreValue(v);
  }

  const url = `https://firestore.googleapis.com/v1/${DOCS_BASE}/blocked/${encodeURIComponent(normTarget)}?currentDocument.exists=false`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }
    const errText = await res.text();
    return { success: false, status: res.status, error: errText };
  } catch (err: any) {
    return { success: false, status: 0, error: err.message };
  }
}

/**
 * Unblock email (Main Admin only)
 * DELETE blocked/{email}
 */
export async function unblockEmail(token: string, targetEmail: string): Promise<{ success: boolean; status: number; error?: string }> {
  const normTarget = targetEmail.trim().toLowerCase();
  const url = `https://firestore.googleapis.com/v1/${DOCS_BASE}/blocked/${encodeURIComponent(normTarget)}`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }
    const errText = await res.text();
    return { success: false, status: res.status, error: errText };
  } catch (err: any) {
    return { success: false, status: 0, error: err.message };
  }
}
