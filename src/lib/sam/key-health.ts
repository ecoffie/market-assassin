/**
 * Process-lifetime SAM key health (2026-11-25 outage: production SAM_API_KEY and SAM_API_KEY_2 returned
 * 401 Invalid Credentials; the opportunity sync failed over only on 429, died on _2 and never reached the live _3;
 * no opportunity was written for ~21 hours).
 *
 * A key that SAM REJECTS (401/403) is dead until the process restarts (a redeploy picks up replaced env values),
 * so every rotation path skips it after the first rejection instead of re-trying it on every call. A throttled
 * key (429) is only exhausted for the day; it is skipped for the current run by the callers' own fail-over.
 *
 * Logs name the env SLOT (SAM_API_KEY_2), never the value.
 */

/** Distinct keys with the env slot each came from, in the shared rotation order (numbered, base, backup). */
export function samKeySlots(env: NodeJS.ProcessEnv = process.env): Array<{ slot: string; key: string }> {
  const out: Array<{ slot: string; key: string }> = [];
  const seen = new Set<string>();
  const push = (slot: string, v: string | undefined) => {
    const k = (v || '').trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ slot, key: k });
  };
  for (let i = 1; i <= 10; i++) push(`SAM_API_KEY_${i}`, env[`SAM_API_KEY_${i}`]);
  push('SAM_API_KEY', env.SAM_API_KEY);
  push('SAM_API_KEY_BACKUP', env.SAM_API_KEY_BACKUP);
  return out;
}

const dead = new Map<string, { status: number; slot: string; at: string; until: number | null }>();

/** A status that means the KEY is unusable (not the request): rejected or throttled. */
export function isKeyUnusableStatus(status: number | undefined | null): boolean {
  return status === 401 || status === 403 || status === 429;
}

/** A 403 without a credential body may be a transient edge block (Akamai), so its dead mark expires (Agent 4). */
export const TRANSIENT_403_TTL_MS = 60 * 60 * 1000;
const CREDENTIAL_BODY = /900901|API_KEY_INVALID|invalid credentials|api key.*(invalid|expired)/i;

/**
 * Record a rejected key. 401 = SAM rejected the credential → dead for the process (a redeploy picks up replaced
 * env values). 403 → dead for the process only when the response body confirms a credential error; otherwise the
 * mark expires after TRANSIENT_403_TTL_MS. 429 is never recorded: quota returns.
 */
export function markSamKeyRejected(key: string, status: number, body?: string | null): void {
  if (!key || (status !== 401 && status !== 403)) return;
  if (isSamKeyRejected(key)) return;
  const permanent = status === 401 || (!!body && CREDENTIAL_BODY.test(body));
  const slot = samKeySlots().find((s) => s.key === key)?.slot ?? 'unknown slot';
  dead.set(key, { status, slot, at: new Date().toISOString(), until: permanent ? null : Date.now() + TRANSIENT_403_TTL_MS });
  console.error(`[SAM keys] ${slot} rejected by SAM (${status}) — skipped ${permanent ? 'for this process; replace it in the environment' : 'for 1h (403 without a credential body)'}`);
}

export function isSamKeyRejected(key: string): boolean {
  const d = dead.get(key);
  if (!d) return false;
  if (d.until !== null && Date.now() >= d.until) { dead.delete(key); return false; }
  return true;
}

/** Slots (never values) currently known dead in this process — for health payloads and alerts. */
export function rejectedSamKeySlots(): Array<{ slot: string; status: number; at: string }> {
  return [...dead.entries()].filter(([k]) => isSamKeyRejected(k)).map(([, { slot, status, at }]) => ({ slot, status, at }));
}

/** Drop known-dead keys. If EVERY key is dead, returns [] so callers fail loudly ("no usable key"), never silently. */
export function withoutRejected(keys: string[]): string[] {
  return keys.filter((k) => !isSamKeyRejected(k));
}

/** The key-unusable status (429 / 401 / 403) carried in an upstream error message, else null. */
export function keyStatusFromError(message: string): 429 | 401 | 403 | null {
  // Anchored to the status forms our callers produce ("SAM.gov API error: 401 - …", "HTTP 403", "noticedesc 429"), so a
  // 401/403/429 elsewhere in a message (an id, a count) is never read as a key status (Agent 4 review of #2490).
  const m = String(message).match(/(?:API error:|\bHTTP|\bnoticedesc)\s*(429|401|403)\b/i);
  return m ? (Number(m[1]) as 429 | 401 | 403) : null;
}

/**
 * Walks the SAM keys for one run: current() skips keys rejected in this process; fail(status) records why the
 * current key was unusable (marking 401/403 dead) and moves on; message() is the loud all-keys-dead text (slots +
 * statuses, never values). Used by the opportunity sync; the 2026-11-25 outage was a walk that stopped at 401.
 */
export class SamKeyWalker {
  private idx = 0;
  readonly failures: Array<{ slot: string; status: number }> = [];
  constructor(private readonly slots: Array<{ slot: string; key: string }> = samKeySlots()) {}
  get size(): number { return this.slots.length; }
  reset(): void { this.idx = 0; this.failures.length = 0; }
  current(): string {
    while (this.idx < this.slots.length && isSamKeyRejected(this.slots[this.idx].key)) this.idx++;
    return this.slots[this.idx]?.key || '';
  }
  currentSlot(): string | null { return this.current() ? this.slots[this.idx].slot : null; }
  /** Returns false when no usable key remains. */
  fail(status: number, body?: string | null): boolean {
    const cur = this.slots[this.idx];
    if (cur) {
      this.failures.push({ slot: cur.slot, status });
      markSamKeyRejected(cur.key, status, body);
    }
    this.idx++;
    const next = this.current();
    if (next) console.warn(`[SAM keys] ${cur?.slot ?? 'key'} unusable (${status}) → failing over to ${this.slots[this.idx].slot}`);
    return !!next;
  }
  message(lastStatus: number): string {
    const tried = this.failures.map((f) => `${f.slot}=${f.status}`).join(', ') || 'none configured';
    return `SAM.gov API error: every SAM key is unusable (last ${lastStatus}; tried ${tried}) — replace the rejected SAM_API_KEY* values`;
  }
}

/** Test hook. */
export function __resetSamKeyHealthForTests(): void {
  dead.clear();
}
