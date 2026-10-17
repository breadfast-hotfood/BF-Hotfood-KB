/**
 * Session and KB loading with retries, so a transient problem (network blip, rate limit, expired token) is never shown
 * to the user as "Access restricted". Only an explicit server verdict (unauthorized_domain / blocked) denies access.
 */
export type SessionResult =
  | { kind: 'authorized'; user: any }
  | { kind: 'denied'; reason: 'unauthorized_domain' | 'blocked'; email: string; name: string }
  | { kind: 'error'; message: string };

export interface RetryDeps {
  getToken: (forceRefresh: boolean) => Promise<string>;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  baseDelayMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchSession(deps: RetryDeps): Promise<SessionResult> {
  const f = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = deps.attempts ?? 4;
  const base = deps.baseDelayMs ?? 600;
  let force = false;
  let lastMessage = 'Could not verify your session.';
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await deps.getToken(force);
      force = false;
      const res = await f('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      let data: any = null;
      try { data = await res.json(); } catch { data = null; }
      if (data && data.authorized === true && data.user) return { kind: 'authorized', user: data.user };
      if (data && data.authorized === false && (data.reason === 'unauthorized_domain' || data.reason === 'blocked')) {
        return { kind: 'denied', reason: data.reason, email: data.email || '', name: data.name || '' };
      }
      lastMessage = (data && data.error) || `Server answered HTTP ${res.status}`;
      if (res.status === 401) force = true; // token problem: get a fresh one on the next attempt
    } catch (e: any) {
      lastMessage = e?.message || String(e);
      force = true;
    }
    if (i < attempts - 1) await sleep(base * Math.pow(2, i));
  }
  return { kind: 'error', message: lastMessage };
}

export type KbLoadResult =
  | { ok: true; data: { fileName: string; tabs: any[]; versionId: string; isSample: boolean } }
  | { ok: false; forbidden: boolean; message: string };

export async function fetchActiveKb(deps: RetryDeps): Promise<KbLoadResult> {
  const f = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = deps.attempts ?? 4;
  const base = deps.baseDelayMs ?? 600;
  let force = false;
  let lastMessage = 'Could not load the Knowledge Base.';
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await deps.getToken(force);
      force = false;
      const res = await f('/api/kb/active', { headers: { Authorization: `Bearer ${token}` } });
      let data: any = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && data && Array.isArray(data.tabs)) return { ok: true, data };
      if (res.status === 403 && data?.error && /denied|not authorized/i.test(data.error)) return { ok: false, forbidden: true, message: data.error };
      lastMessage = (data && data.error) || `Server answered HTTP ${res.status}`;
      if (res.status === 401) force = true;
    } catch (e: any) {
      lastMessage = e?.message || String(e);
      force = true;
    }
    if (i < attempts - 1) await sleep(base * Math.pow(2, i));
  }
  return { ok: false, forbidden: false, message: lastMessage };
}
