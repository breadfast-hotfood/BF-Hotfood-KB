/**
 * Minimal Firestore REST client that authenticates with the caller's Firebase ID token.
 * - Reads chunks by document ID (needs only the "get" rule, never "list", never pagination).
 * - Partial updates MUST pass { merge: true } (sends updateMask). A PATCH without a mask REPLACES the whole document.
 */
import { listCollectionDocs } from './firestoreList';

export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) if (v !== undefined) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in val) {
    const o: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) o[k] = fromFirestoreValue(v);
    return o;
  }
  return null;
}

const fieldPath = (k: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + k.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DocGetResult { status: number; found: boolean; data?: Record<string, any>; errorText?: string; }
export interface ChunkReadResult { chunks: Record<string, any>[]; failures: { chunkId: string; status: number; errorText?: string }[]; }

export interface CommitWriteOp {
  update?: {
    name: string;
    fields: Record<string, any>;
  };
  delete?: string;
  updateMask?: {
    fieldPaths: string[];
  };
  currentDocument?: {
    exists?: boolean;
    updateTime?: string;
  };
}

export interface CommitResult {
  ok: boolean;
  status: number;
  data?: any;
  errorText?: string;
}

export function createFirestoreRest(cfg: { projectId: string; databaseId: string }, fetchImpl: typeof fetch = fetch) {
  const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.databaseId}/documents`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function write(docPath: string, data: Record<string, any>, token: string, opts: { merge?: boolean } = {}): Promise<void> {
    if (!token) throw new Error('Cannot write to Firestore: missing authenticated user token.');
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) fields[k] = toFirestoreValue(v);
    const keys = Object.keys(fields);
    let url = `${base}/${docPath}`;
    if (opts.merge) {
      if (!keys.length) throw new Error('Refusing a merge write with no fields (would wipe the document).');
      url += '?' + keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(fieldPath(k))}`).join('&');
    }
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetchImpl(url, { method: 'PATCH', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
      if (res.ok) return;
      const text = await res.text();
      lastErr = `Firestore REST write error (${res.status}) on ${docPath}: ${text}`;
      if (res.status !== 429 && res.status < 500) break;
      await sleep(300 * (attempt + 1));
    }
    throw new Error(lastErr);
  }

  async function get(docPath: string, token: string): Promise<DocGetResult> {
    if (!token) return { status: 401, found: false, errorText: 'No user token' };
    let last: DocGetResult = { status: 0, found: false };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchImpl(`${base}/${docPath}`, { headers: auth(token) });
        if (res.status === 404) return { status: 404, found: false };
        if (res.ok) {
          const json: any = await res.json();
          const data: Record<string, any> = {};
          for (const [k, v] of Object.entries(json.fields || {})) data[k] = fromFirestoreValue(v);
          return { status: 200, found: true, data };
        }
        last = { status: res.status, found: false, errorText: await res.text() };
        if (res.status !== 429 && res.status < 500) return last; // 403 etc: retrying will not help
      } catch (e: any) {
        last = { status: 0, found: false, errorText: e?.message || String(e) };
      }
      await sleep(300 * (attempt + 1));
    }
    return last;
  }

  async function del(docPath: string, token: string): Promise<boolean> {
    try {
      const res = await fetchImpl(`${base}/${docPath}`, { method: 'DELETE', headers: auth(token) });
      return res.ok || res.status === 404;
    } catch { return false; }
  }

  async function commit(writes: CommitWriteOp[], token: string): Promise<CommitResult> {
    if (!token) return { ok: false, status: 401, errorText: 'Missing auth token' };
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.databaseId}/documents:commit`;
    try {
      const res = await fetchImpl(commitUrl, {
        method: 'POST',
        headers: {
          ...auth(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ writes }),
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, status: res.status, data };
      }
      const errText = await res.text();
      return { ok: false, status: res.status, errorText: errText };
    } catch (e: any) {
      return { ok: false, status: 0, errorText: e?.message || String(e) };
    }
  }

  async function readChunksByIds(versionId: string, chunkIds: string[], token: string, concurrency = 4): Promise<ChunkReadResult> {
    const slots: (Record<string, any> | undefined)[] = new Array(chunkIds.length);
    const failures: ChunkReadResult['failures'] = [];
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= chunkIds.length) return;
        const r = await get(`kbVersions/${versionId}/chunks/${chunkIds[i]}`, token);
        if (r.found && r.data) slots[i] = r.data;
        else failures.push({ chunkId: chunkIds[i], status: r.status, errorText: r.errorText });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(chunkIds.length, 1)) }, worker));
    return { chunks: slots.filter(Boolean) as Record<string, any>[], failures };
  }

  /** Lists a collection following nextPageToken. Needs the "list" rule; use only for non-critical things (history, retention). */
  async function listCollection(collectionPath: string, token: string, pageSize = 100): Promise<Record<string, any>[]> {
    // Uses a collection query first (runQuery), then paged REST list; throws with the real status/body on failure.
    return listCollectionDocs({
      projectId: cfg.projectId,
      databaseId: cfg.databaseId,
      collection: collectionPath,
      token,
      limit: Math.max(pageSize, 500),
      fetchImpl,
    });
  }

  return { write, get, del, commit, readChunksByIds, listCollection };
}

export type FirestoreRest = ReturnType<typeof createFirestoreRest>;
