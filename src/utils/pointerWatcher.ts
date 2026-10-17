/**
 * Decides when the knowledge base must be reloaded. It watches the small "meta/kb" pointer document:
 * 1) a live Firestore listener (instant, nearly free in reads), and
 * 2) a slow fallback poll + focus/online checks if the listener is unavailable.
 * It is pure logic (no Firebase import) so it can be unit tested.
 */
export interface PointerWatcherOptions {
  subscribe: (onData: (meta: any | null) => void, onError: (e: any) => void) => () => void;
  fetchPointer: () => Promise<any | null | undefined>; // undefined = the check itself failed
  onChange: (meta: any | null) => void;                 // called for the first value and for every later change
  onPermissionDenied?: () => void;
  pollMs?: number;
  minGapMs?: number;
  isVisible?: () => boolean;
  now?: () => number;
  setIntervalFn?: (fn: () => void, ms: number) => any;
  clearIntervalFn?: (id: any) => void;
}

export const pointerKey = (m: any | null | undefined): string =>
  m ? `${m.activeVersionId || ''}:${m.versionChecksum || ''}` : 'none';

export function createPointerWatcher(o: PointerWatcherOptions) {
  const pollMs = o.pollMs ?? 90_000;
  const minGap = o.minGapMs ?? 20_000;
  const isVisible = o.isVisible ?? (() => true);
  const now = o.now ?? (() => Date.now());
  const setI = o.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearI = o.clearIntervalFn ?? ((id: any) => clearInterval(id));

  let lastKey: string | undefined;
  let unsub: (() => void) | null = null;
  let timer: any = null;
  let stopped = false;
  let fallback = false;
  let lastCheck = -Infinity;

  const handle = (meta: any | null) => {
    if (stopped) return;
    const key = pointerKey(meta);
    if (key === lastKey) return;
    lastKey = key;
    o.onChange(meta);
  };

  async function checkNow(force = false) {
    if (stopped) return;
    if (!force && now() - lastCheck < minGap) return;
    lastCheck = now();
    try {
      const meta = await o.fetchPointer();
      if (meta !== undefined) handle(meta);
    } catch { /* ignore: the next check will retry */ }
  }

  function startFallback() {
    if (fallback || stopped) return;
    fallback = true;
    timer = setI(() => { if (isVisible()) void checkNow(true); }, pollMs);
    void checkNow(true);
  }

  function start() {
    stopped = false;
    try {
      unsub = o.subscribe(handle, (e) => {
        const code = e?.code || '';
        if (code === 'permission-denied') { o.onPermissionDenied?.(); return; }
        startFallback();
      });
    } catch { startFallback(); }
  }

  function stop() {
    stopped = true;
    if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; }
    if (timer !== null) { clearI(timer); timer = null; }
  }

  return { start, stop, checkNow, isFallback: () => fallback };
}
