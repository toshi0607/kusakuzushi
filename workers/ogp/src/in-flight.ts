/**
 * The age-checked Map index.ts keeps its shared in-flight entries in. Lives
 * outside index.ts because workerd treats every named export of the entry
 * module as a handler and refuses to start on a constant (the e2e run on
 * 2026-10-03 caught exactly that), while the tests need the bound by name.
 */

/**
 * How old a shared in-flight entry may be before a later request treats it
 * as abandoned and starts its own work in its place. An entry is removed
 * when its promise settles, so one that never settles would pin its key for
 * the isolate's lifetime and every later request for that key would wait
 * forever. That can still happen after the upstream and font deadlines: a
 * rate-limit binding that never answers, a `cache.put` that never settles,
 * or the request that created the entry being cut off (waitUntil's 30 s cap
 * after a client disconnect, or the CPU limit) — in which case its timers
 * are gone too, so only a check made by a later, live request can notice.
 *
 * 30 s: above the slowest healthy entry (limiter, then the 10 s upstream
 * fetch and the 10 s font load in parallel, then a cold render of about
 * 4 s and the cache write — roughly 15 s), and equal to the longest a
 * cut-off request can have kept its entry alive; past it, nobody is
 * working on the entry any more.
 */
export const IN_FLIGHT_MAX_AGE_MS = 30_000;

/**
 * A Map whose lookups refuse an entry that is `IN_FLIGHT_MAX_AGE_MS` or
 * older: see that constant. `release` is the compare-and-delete the
 * settle callbacks use; it never evicts on age, so a stale callback can
 * only remove its own entry.
 */
export class InFlightMap<T> {
  private readonly entries = new Map<string, { value: T; startedAt: number }>();

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    const age = Date.now() - entry.startedAt;
    if (age >= IN_FLIGHT_MAX_AGE_MS) {
      console.error("abandoned in-flight entry replaced", key, `${age}ms old`);
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, startedAt: Date.now() });
  }

  release(key: string, value: T): void {
    if (this.entries.get(key)?.value === value) {
      this.entries.delete(key);
    }
  }
}
