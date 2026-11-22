/**
 * Assets a style is still fetching (Memory's scenes, Echo's moves). Offline
 * renders (the harness, exports) can wait for them before rendering, since a
 * tight render loop never yields long enough for a fetch to finish.
 */
const pending = new Set<Promise<unknown>>();

/** Register an asset load; returns it. */
export function trackAsset<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  void p.finally(() => pending.delete(p));
  return p;
}

/** Resolves once every asset load started so far has settled. */
export async function assetsSettled(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
