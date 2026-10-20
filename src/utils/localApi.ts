/**
 * Browser-side replacement for the old Express server.
 *
 * The site is now fully static (GitHub Pages / Firebase Hosting). The pages still call /api/... exactly as before;
 * installFetchInterceptor() answers those calls IN THE BROWSER with the same JSON shapes, using Firestore REST with
 * the signed-in user's own Firebase ID token.
 *
 * SECURITY MODEL (important): there is no trusted server any more. The token claims decoded here only decide what the
 * UI shows. The real enforcement is Firestore security rules, which evaluate the user's token on every read and write.
 * Tampering with this code in the browser cannot grant access to data the rules deny.
 */
import { createFirestoreRest } from './firestoreRest';
import { listCollectionDocs } from './firestoreList';
import { publishWorkbook, loadActiveWorkbook as loadFromStore } from './kbPublish';
import { computeKBDryRun } from './kbDiffEngine';
import { withoutDividerAnnotationNotes } from './notesCleanup';
import type { Workbook } from '../types';

export const MAIN_ADMIN_EMAIL = 'breadfast.hotfood@gmail.com';
const COMPANY_RE = /^[^@]+@breadfast\.com$/i;

export interface LocalApiOptions {
  projectId: string;
  databaseId: string;
  fetchImpl?: typeof fetch;
  sample: () => Workbook & { publishedAt?: string };
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}
export interface ApiRequest { method: string; path: string; authorization?: string; body?: any }
export interface ApiResponse { status: number; json: any }

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function b64urlDecode(s: string): string {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

export function decodeJwtPayload(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Malformed ID token');
  try { return JSON.parse(b64urlDecode(parts[1])); } catch { throw new HttpError(401, 'Malformed ID token'); }
}

export function createLocalApi(opts: LocalApiOptions) {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fs = createFirestoreRest({ projectId: opts.projectId, databaseId: opts.databaseId }, opts.fetchImpl);

  function verify(authorization?: string) {
    if (!authorization || !authorization.startsWith('Bearer ')) throw new HttpError(401, 'Missing or malformed Authorization header');
    const token = authorization.slice(7).trim();
    const d = decodeJwtPayload(token);
    if (d.firebase?.sign_in_provider !== 'google.com') throw new HttpError(403, 'Forbidden: only Google OAuth 2.0 authentication is accepted');
    if (d.email_verified !== true) throw new HttpError(403, 'Forbidden: Google account email must be verified');
    const email = String(d.email || '').trim().toLowerCase();
    return { token, decoded: d, email, uid: String(d.user_id || d.sub || '') };
  }

  async function privilege(email: string, token: string) {
    if (email === MAIN_ADMIN_EMAIL) return { isAdmin: true, isMainAdmin: true, role: 'Main Admin' };
    if (!COMPANY_RE.test(email)) return { isAdmin: false, isMainAdmin: false, role: 'Unauthorized' };
    const r = await fs.get(`admins/${encodeURIComponent(email)}`, token);
    if (r.found) return { isAdmin: true, isMainAdmin: false, role: 'Admin' };
    if (r.status === 401) throw new HttpError(401, 'ID token rejected, please retry');
    if (r.status === 404 || r.status === 403) return { isAdmin: false, isMainAdmin: false, role: 'User' };
    // 0 (network), 429 (rate limit), 5xx: do not guess. A wrong guess would demote an Admin or reject a valid user.
    throw new HttpError(503, `Temporary problem while checking your role (HTTP ${r.status}). Please retry.`);
  }

  async function audit(uid: string, email: string, action: string, details: Record<string, any>, token: string) {
    const id = `log-${now().getTime()}-${Math.random().toString(36).slice(2, 7)}`;
    try { await fs.write(`auditLogs/${id}`, { actorUid: uid, actorEmail: email, action, details, timestamp: now().toISOString() }, token); } catch { /* non-blocking */ }
  }

  async function listVersions(token: string, limit = 200): Promise<any[]> {
    try {
      const docs = await listCollectionDocs({ projectId: opts.projectId, databaseId: opts.databaseId, collection: 'kbVersions', token, limit, fetchImpl: opts.fetchImpl });
      return docs.map((d: any) => ({ ...d, versionId: d.versionId || d.__id }));
    } catch { return []; }
  }

  const loadActive = (token: string) => loadFromStore(fs, token, () => ({ ...opts.sample(), isSample: true }));

  // ---------------- endpoints ----------------

  async function authMe(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, decoded, email, uid } = verify(req.authorization);
      if (email === MAIN_ADMIN_EMAIL) {
        return { status: 200, json: { authorized: true, user: { uid, userId: 'MAIN-ADMIN', name: decoded.name || 'Main Admin', email, role: 'Main Admin', enabled: true } } };
      }
      if (!COMPANY_RE.test(email)) {
        return { status: 200, json: { authorized: false, reason: 'unauthorized_domain', email, name: decoded.name || '', message: 'Access restricted to @breadfast.com accounts.' } };
      }
      // Probe: a blocked company account is refused by the rules when it reads the KB pointer.
      let probe = await fs.get('meta/kb', token);
      if (probe.status === 403) { await sleep(700); probe = await fs.get('meta/kb', token); } // confirm before blocking
      if (probe.status === 401) throw new HttpError(401, 'ID token rejected, please retry');
      if (probe.status === 403) {
        return { status: 200, json: { authorized: false, reason: 'blocked', email, name: decoded.name || '', message: 'Your access has been disabled, contact the Main Admin.' } };
      }
      if (probe.status !== 200 && probe.status !== 404) throw new HttpError(503, `Temporary problem while checking access (HTTP ${probe.status}). Please retry.`);
      const priv = await privilege(email, token);
      return { status: 200, json: { authorized: true, user: { uid, userId: email, name: decoded.name || 'Breadfast Employee', email, role: priv.isAdmin ? 'Admin' : 'User', enabled: true } } };
    } catch (e: any) {
      return { status: e.status || 401, json: { authorized: false, error: e.message || 'Authentication failed' } };
    }
  }

  async function authBootstrap(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { email } = verify(req.authorization);
      if (email !== MAIN_ADMIN_EMAIL) return { status: 403, json: { error: 'Forbidden: caller Google account does not match the configured bootstrap email.' } };
      return { status: 200, json: { success: true, message: 'Main Admin established via rules anchor.', email, role: 'Main Admin' } };
    } catch (e: any) {
      return { status: e.status || 401, json: { error: e.message || 'Bootstrap failed' } };
    }
  }

  async function kbActive(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email } = verify(req.authorization);
      if (email !== MAIN_ADMIN_EMAIL && !COMPANY_RE.test(email)) return { status: 403, json: { error: 'Access denied: account not authorized to view KB data.' } };
      const wb: any = await loadActive(token);
      return { status: 200, json: { fileName: wb.fileName, tabs: wb.tabs.map((t: any) => withoutDividerAnnotationNotes(t)), versionId: wb.versionId, isSample: !!wb.isSample } };
    } catch (e: any) {
      return { status: e.status || 503, json: { error: e.message || 'Could not load the Knowledge Base' } };
    }
  }

  async function kbUpload(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email, uid, decoded } = verify(req.authorization);
      const priv = await privilege(email, token);
      if (!priv.isAdmin) return { status: 403, json: { error: 'Forbidden: only Admins can publish Knowledge Base versions.' } };

      const { fileName, parsedWorkbook, explicitConfirmation } = req.body || {};
      const workbook: Workbook = parsedWorkbook;
      if (!workbook || !Array.isArray(workbook.tabs) || workbook.tabs.length === 0) return { status: 400, json: { error: 'Invalid or missing parsed workbook payload.' } };

      let current: any;
      try { current = await loadActive(token); } catch { current = { ...opts.sample(), isSample: true }; }
      const dry = computeKBDryRun(current, workbook);
      if (dry.requiresExplicitConfirmation && explicitConfirmation !== true) {
        return { status: 400, json: { error: 'Explicit confirmation required before publishing.', requiresExplicitConfirmation: true, confirmationWarnings: dry.confirmationWarnings, missingTabs: dry.missingTabs, largeDecreaseDetected: dry.largeDecreaseDetected } };
      }

      // Mark stale staging versions as failed so a retry is clean.
      try {
        for (const v of await listVersions(token)) {
          if (v.status === 'staging' && v.versionId) {
            await fs.write(`kbVersions/${v.versionId}`, { status: 'failed', failureReason: 'Staging superseded by subsequent publish attempt.' }, token, { merge: true });
          }
        }
      } catch { /* non-blocking */ }

      const pub = await publishWorkbook({ fs, token, workbook, fileName: fileName || workbook.fileName, actor: { uid, email, name: decoded.name || '' }, now: () => now().toISOString() });
      if (!pub.ok) return { status: 500, json: { error: pub.error || 'Publishing failed.', details: pub.details } };

      await audit(uid, email, 'KB_VERSION_PUBLISHED', { versionId: pub.versionId, fileName: fileName || workbook.fileName, totalTabs: workbook.tabs.length, totalRecords: pub.totalRecords, totalChunks: pub.totalChunks, versionChecksum: pub.versionChecksum }, token);

      let tabs: any = workbook.tabs;
      try { tabs = ((await loadActive(token)) as any).tabs; } catch { /* fall back to the parsed tabs */ }
      tabs = (tabs as any[]).map((t: any) => withoutDividerAnnotationNotes(t));
      return { status: 200, json: { success: true, versionId: pub.versionId, fileName: fileName || workbook.fileName, totalTabs: workbook.tabs.length, totalRecords: pub.totalRecords, totalChunks: pub.totalChunks, versionChecksum: pub.versionChecksum, tabs } };
    } catch (e: any) {
      return { status: e.status || 500, json: { error: e.message || 'KB upload and ingestion failed' } };
    }
  }

  async function kbVersions(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email } = verify(req.authorization);
      const priv = await privilege(email, token);
      if (!priv.isAdmin) return { status: 403, json: { error: 'Forbidden: only Admins can view version history.' } };

      const versions: any[] = [];
      const ptr = await fs.get('meta/kb', token);
      const activeId: string | null = ptr.found ? (ptr.data?.activeVersionId || null) : null;
      (await listVersions(token))
        .filter((d) => ['active', 'published', 'staging', 'archived'].includes(d.status))
        .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
        .forEach((d) => versions.push({
          versionId: d.versionId, fileName: d.fileName, status: d.status, isActive: !!activeId && d.versionId === activeId, publishedAt: d.publishedAt || null, publishedBy: d.publishedBy || '', publishedByName: d.publishedByName || '', lastActivatedAt: d.lastActivatedAt || null, lastActivatedBy: d.lastActivatedBy || '', lastActivatedByName: d.lastActivatedByName || '',
          totalTabs: d.totalTabs || 0, totalRecords: d.totalRecords || 0, totalChunks: d.totalChunks || 1, versionChecksum: d.versionChecksum || '', tabNames: d.tabNames || [],
        }));

      const s = opts.sample();
      versions.push({
        versionId: s.versionId, fileName: s.fileName, status: 'published', publishedAt: s.publishedAt || null, publishedBy: 'System Sample',
        totalTabs: s.tabs.length, totalRecords: s.tabs.reduce((acc, t) => acc + (t.kb?.records?.length || 0), 0), totalChunks: 1,
        tabNames: s.tabs.map((t) => t.name), isDefault: true, isSample: true, isActive: !activeId || activeId === s.versionId,
      });
      return { status: 200, json: { versions } };
    } catch (e: any) {
      return { status: e.status || 401, json: { error: e.message || 'Failed to fetch versions' } };
    }
  }

  async function kbRollback(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email, uid, decoded } = verify(req.authorization);
      const priv = await privilege(email, token);
      if (!priv.isAdmin) return { status: 403, json: { error: 'Forbidden: only Admins can rollback Knowledge Base versions.' } };

      const targetVersionId: string | undefined = req.body?.targetVersionId;
      if (!targetVersionId) return { status: 400, json: { error: 'Missing targetVersionId.' } };

      const s = opts.sample();
      const current = await readActive(token);
      if (current.ok && (current.activeId ? current.activeId === targetVersionId : targetVersionId === s.versionId)) {
        return { status: 409, json: { error: 'That version is already the active version.' } };
      }
      let targetFileName = s.fileName;
      let vData: Record<string, any> | null = null;
      if (targetVersionId !== s.versionId) {
        const r = await fs.get(`kbVersions/${encodeURIComponent(targetVersionId)}`, token);
        if (!r.found || !r.data) return { status: 404, json: { error: 'Specified version does not exist in retained versions.' } };
        vData = r.data;
        if (vData.status === 'failed' || vData.status === 'deleting') return { status: 400, json: { error: 'Cannot rollback to a failed or invalid version.' } };
        targetFileName = vData.fileName || targetFileName;
        // Never switch the live pointer to a version whose chunks cannot be read.
        const total = Number(vData.totalChunks) || 0;
        if (total > 0) {
          const ids = Array.from({ length: total }, (_, i) => `chunk_${i}`);
          const read = await fs.readChunksByIds(targetVersionId, ids, token);
          if (read.failures.length) return { status: 409, json: { error: `Cannot roll back: ${read.failures.length} of ${total} chunks of that version are unreadable (first: ${read.failures[0].chunkId} HTTP ${read.failures[0].status}).` } };
        }
      }

      const metaUpdate: Record<string, any> = { activeVersionId: targetVersionId, fileName: targetFileName, rolledBackAt: now().toISOString(), rolledBackBy: email, rolledBackByName: decoded.name || '' };
      if (vData) {
        if (vData.totalTabs) metaUpdate.totalTabs = vData.totalTabs;
        if (vData.totalRecords) metaUpdate.totalRecords = vData.totalRecords;
        if (vData.totalChunks) metaUpdate.totalChunks = vData.totalChunks;
        if (vData.versionChecksum) metaUpdate.versionChecksum = vData.versionChecksum;
      }
      await fs.write('meta/kb', metaUpdate, token, { merge: true });
      if (vData) { try { await fs.write(`kbVersions/${targetVersionId}`, { lastActivatedAt: now().toISOString(), lastActivatedBy: email, lastActivatedByName: decoded.name || '' }, token, { merge: true }); } catch { /* history note only */ } }
      await audit(uid, email, 'KB_VERSION_ROLLEDBACK', { targetVersionId, targetFileName }, token);
      return { status: 200, json: { success: true, message: `Successfully rolled back active Knowledge Base to version ${targetVersionId}`, activeVersionId: targetVersionId, fileName: targetFileName } };
    } catch (e: any) {
      return { status: e.status || 500, json: { error: e.message || 'Rollback failed' } };
    }
  }

  // ---------------- version deletion (never the active version) ----------------

  async function readActive(token: string): Promise<{ ok: true; activeId: string | null } | { ok: false }> {
    const r = await fs.get('meta/kb', token);
    if (r.status === 404) return { ok: true, activeId: null };
    if (r.found) return { ok: true, activeId: r.data?.activeVersionId || null };
    return { ok: false };
  }

  /**
   * Deletes one stored version (its chunks first, then its record). The active version is checked three times:
   * before starting, again right after the version is hidden (status "deleting"), and the pointer is never touched.
   * If anything fails midway the version stays hidden ("deleting"), cannot be rolled back to, and a later delete retries.
   */
  async function purgeVersion(versionId: string, token: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const enc = encodeURIComponent(versionId);
    const first = await readActive(token);
    if (!first.ok) return { ok: false, status: 503, error: 'Could not verify which version is active, so nothing was deleted. Please retry.' };
    if (first.activeId === versionId) return { ok: false, status: 409, error: 'The active version cannot be deleted.' };

    const doc = await fs.get(`kbVersions/${enc}`, token);
    if (doc.status === 404) return { ok: false, status: 404, error: 'That version no longer exists.' };
    if (!doc.found || !doc.data) return { ok: false, status: doc.status === 401 ? 401 : 503, error: `Could not read the version (HTTP ${doc.status}). Nothing was deleted.` };
    const previousStatus = doc.data.status || 'published';

    // Hide it and make it impossible to roll back to while it is being removed.
    await fs.write(`kbVersions/${enc}`, { status: 'deleting' }, token, { merge: true });

    const second = await readActive(token);
    if (!second.ok || second.activeId === versionId) {
      try { await fs.write(`kbVersions/${enc}`, { status: previousStatus }, token, { merge: true }); } catch { /* best effort */ }
      return second.ok
        ? { ok: false, status: 409, error: 'The active version cannot be deleted.' }
        : { ok: false, status: 503, error: 'Could not verify which version is active, so nothing was deleted. Please retry.' };
    }

    const total = Number(doc.data.totalChunks) || 0;
    const ids: string[] = [];
    if (total > 0) { for (let i = 0; i < total; i++) ids.push(`chunk_${i}`); }
    else {
      for (let i = 0; i < 500; i++) { // unknown count: walk chunk_0, chunk_1... until the first 404
        const r = await fs.get(`kbVersions/${enc}/chunks/chunk_${i}`, token);
        if (r.status === 404) break;
        if (!r.found) return { ok: false, status: 503, error: `Could not read chunk_${i} (HTTP ${r.status}). The version stays hidden; try again.` };
        ids.push(`chunk_${i}`);
      }
    }
    for (const id of ids) {
      if (!(await fs.del(`kbVersions/${enc}/chunks/${id}`, token))) {
        return { ok: false, status: 500, error: `Could not delete ${id}. The version stays hidden; try again.` };
      }
    }
    if (!(await fs.del(`kbVersions/${enc}`, token))) return { ok: false, status: 500, error: 'Could not delete the version record. It stays hidden; try again.' };
    return { ok: true };
  }

  async function kbDeleteVersion(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email, uid } = verify(req.authorization);
      const priv = await privilege(email, token);
      if (!priv.isAdmin) return { status: 403, json: { error: 'Forbidden: only Admins can delete Knowledge Base versions.' } };
      const versionId = req.body?.versionId;
      if (typeof versionId !== 'string' || !versionId.trim()) return { status: 400, json: { error: 'Missing versionId.' } };
      if (versionId === opts.sample().versionId) return { status: 400, json: { error: 'The built-in sample version is not stored and cannot be deleted.' } };
      const r = await purgeVersion(versionId, token);
      if (!r.ok) return { status: r.status, json: { error: r.error } };
      await audit(uid, email, 'KB_VERSION_DELETED', { versionId }, token);
      return { status: 200, json: { success: true, deletedVersionId: versionId } };
    } catch (e: any) {
      return { status: e.status || 500, json: { error: e.message || 'Delete failed' } };
    }
  }

  async function kbDeleteHistorical(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email, uid } = verify(req.authorization);
      const priv = await privilege(email, token);
      if (!priv.isAdmin) return { status: 403, json: { error: 'Forbidden: only Admins can delete Knowledge Base versions.' } };

      const active = await readActive(token);
      if (!active.ok) return { status: 503, json: { error: 'Could not verify which version is active, so nothing was deleted. Please retry.' } };

      let docs: Record<string, any>[];
      try {
        docs = await listCollectionDocs({ projectId: opts.projectId, databaseId: opts.databaseId, collection: 'kbVersions', token, limit: 500, fetchImpl: opts.fetchImpl });
      } catch (e: any) {
        return { status: 503, json: { error: `Could not list the versions, so nothing was deleted. ${e.message || ''}`.trim() } };
      }
      const sampleId = opts.sample().versionId;
      const targets = docs.map((d) => String(d.versionId || d.__id || '')).filter((id) => id && id !== active.activeId && id !== sampleId);

      const deleted: string[] = [];
      const skipped: string[] = [];
      const failed: { versionId: string; error: string }[] = [];
      for (const id of targets) {
        const r = await purgeVersion(id, token);
        if (r.ok) deleted.push(id);
        else if (r.status === 409 || r.status === 404) skipped.push(id);
        else failed.push({ versionId: id, error: r.error });
      }
      await audit(uid, email, 'KB_VERSIONS_DELETED_ALL', { deleted: deleted.length, failed: failed.length, activeVersionId: active.activeId }, token);
      return { status: 200, json: { success: failed.length === 0, deleted: deleted.length, deletedIds: deleted, skipped, failed, activeVersionId: active.activeId } };
    } catch (e: any) {
      return { status: e.status || 500, json: { error: e.message || 'Delete failed' } };
    }
  }

  async function kbPointer(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { token, email } = verify(req.authorization);
      if (email !== MAIN_ADMIN_EMAIL && !COMPANY_RE.test(email)) return { status: 403, json: { error: 'Access denied: account not authorized to view KB data.' } };
      const r = await fs.get('meta/kb', token);
      if (r.status === 404) return { status: 200, json: { activeVersionId: null, versionChecksum: null } };
      if (!r.found) return { status: r.status === 403 ? 403 : 503, json: { error: `Could not read the KB pointer (HTTP ${r.status}).` } };
      return { status: 200, json: { activeVersionId: r.data?.activeVersionId || null, versionChecksum: r.data?.versionChecksum || null } };
    } catch (e: any) {
      return { status: e.status || 503, json: { error: e.message || 'Could not read the KB pointer' } };
    }
  }

  const routes: Record<string, (r: ApiRequest) => Promise<ApiResponse>> = {
    'GET /api/kb/pointer': kbPointer,
    'POST /api/kb/delete-version': kbDeleteVersion,
    'POST /api/kb/delete-historical': kbDeleteHistorical,
    'GET /api/auth/me': authMe,
    'POST /api/auth/bootstrap': authBootstrap,
    'GET /api/kb/active': kbActive,
    'POST /api/kb/upload': kbUpload,
    'GET /api/kb/versions': kbVersions,
    'POST /api/kb/rollback': kbRollback,
  };

  async function handle(req: ApiRequest): Promise<ApiResponse> {
    const fn = routes[`${req.method.toUpperCase()} ${req.path}`];
    if (!fn) return { status: 404, json: { error: `Unknown API route ${req.method} ${req.path}` } };
    return fn(req);
  }

  return { handle };
}

function readHeader(h: any, name: string): string | undefined {
  if (!h) return undefined;
  if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(name) ?? undefined;
  if (Array.isArray(h)) { const f = h.find((x) => String(x[0]).toLowerCase() === name.toLowerCase()); return f ? String(f[1]) : undefined; }
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? String(h[k]) : undefined;
}

/** Routes fetch('/api/...') calls to the in-browser API; every other request goes to the real fetch untouched. */
export function installFetchInterceptor(api: { handle(req: ApiRequest): Promise<ApiResponse> }, realFetch: typeof fetch, target: { fetch: typeof fetch } = window as any, origin: string = typeof location !== 'undefined' ? location.origin : '') {
  target.fetch = (async (input: any, init?: any) => {
    const urlStr: string = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? '');
    let path: string | null = null;
    if (urlStr.startsWith('/api/')) path = urlStr.split('?')[0];
    else if (origin && urlStr.startsWith(origin + '/api/')) path = urlStr.slice(origin.length).split('?')[0];
    if (!path) return realFetch(input, init);

    const reqObj = typeof input === 'object' && input && !(input instanceof URL) ? input : null;
    const method = String(init?.method || reqObj?.method || 'GET');
    const authorization = readHeader(init?.headers, 'Authorization') ?? readHeader(reqObj?.headers, 'Authorization');
    let rawBody: any = init?.body;
    if (rawBody === undefined && reqObj && typeof reqObj.text === 'function' && method.toUpperCase() !== 'GET') rawBody = await reqObj.text();
    let body: any = undefined;
    if (typeof rawBody === 'string' && rawBody) { try { body = JSON.parse(rawBody); } catch { body = undefined; } }

    const out = await api.handle({ method, path, authorization, body });
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}
