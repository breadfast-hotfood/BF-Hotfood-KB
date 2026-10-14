/**
 * Lists the documents of ONE top-level collection (members, admins, blocked, ...) using the caller's Firebase ID token.
 * Strategy: 1) documents:runQuery (a normal collection query)  2) fallback: REST "list" with nextPageToken paging.
 * It never hides errors: if both fail it throws FirestoreListError with the HTTP status and the real response body
 * of BOTH attempts, so the UI/self-test can show exactly why (and so a rules/IAM problem is visible, not guessed).
 */

export class FirestoreListError extends Error {
  attempts: { method: string; status: number; body: string }[];
  status: number;
  constructor(collection: string, attempts: { method: string; status: number; body: string }[]) {
    const last = attempts[attempts.length - 1];
    super(
      `Cannot list "${collection}": ` +
        attempts.map((a) => `${a.method} -> HTTP ${a.status} ${a.body.slice(0, 300)}`).join(' | ')
    );
    this.name = 'FirestoreListError';
    this.attempts = attempts;
    this.status = last ? last.status : 0;
  }
}

function fromValue(v: any): any {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) {
    const o: Record<string, any> = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fromValue(x);
    return o;
  }
  return null;
}

function decode(doc: any): Record<string, any> {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = fromValue(v);
  // The document id is the last segment of "name": .../documents/<collection>/<id>
  const name: string = doc.name || '';
  o.__id = decodeURIComponent(name.split('/').pop() || '');
  return o;
}

export interface ListOptions {
  projectId: string;
  databaseId: string;
  collection: string;      // top-level collection id, e.g. "members"
  token: string;           // caller's Firebase ID token
  limit?: number;          // default 500
  fetchImpl?: typeof fetch;
}

export async function listCollectionDocs(opts: ListOptions): Promise<Record<string, any>[]> {
  const { projectId, databaseId, collection, token } = opts;
  const limit = opts.limit ?? 500;
  const f = opts.fetchImpl ?? fetch;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const attempts: { method: string; status: number; body: string }[] = [];

  // Attempt 1: runQuery (plain collection query, NOT a collection-group query)
  try {
    const res = await f(`${base}:runQuery`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], limit } }),
    });
    if (res.ok) {
      const rows: any[] = await res.json();
      return rows.filter((r) => r && r.document).map((r) => decode(r.document));
    }
    attempts.push({ method: 'runQuery', status: res.status, body: await res.text() });
  } catch (e: any) {
    attempts.push({ method: 'runQuery', status: 0, body: e?.message || String(e) });
  }

  // Attempt 2: REST list with paging
  try {
    const out: Record<string, any>[] = [];
    let pageToken: string | undefined;
    do {
      const url = `${base}/${collection}?pageSize=100` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await f(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        attempts.push({ method: 'list', status: res.status, body: await res.text() });
        throw new FirestoreListError(collection, attempts);
      }
      const json: any = await res.json();
      for (const d of json.documents || []) out.push(decode(d));
      pageToken = json.nextPageToken || undefined;
    } while (pageToken);
    return out;
  } catch (e: any) {
    if (e instanceof FirestoreListError) throw e;
    attempts.push({ method: 'list', status: 0, body: e?.message || String(e) });
    throw new FirestoreListError(collection, attempts);
  }
}
