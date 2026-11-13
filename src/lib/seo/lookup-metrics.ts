/**
 * Daily usage metrics for the SEO cold-lookup budgets (2026-11-13, operational measurement).
 *
 * The budgets themselves only kept an attempts counter per UTC day (it increments on refused
 * requests too, and expires after ~26h), which cannot tell one-time demand (cache invalidation,
 * backlog) from recurring demand. This records, per kind and UTC day:
 *   - allowed vs refused budget decisions (counters)
 *   - unique IDs requested and unique IDs actually looked up (HyperLogLog: ~12 KB per key, ±0.8%)
 *   - outcomes of the lookups that ran: found / missing / failed
 * Keys live 4 days; /api/cron/seo-lookup-demand persists each day to data_sources before expiry.
 *
 * Best-effort by contract: a metrics write must never change a page's response or a budget
 * decision, so every call swallows its own errors.
 */
import { kv } from '@vercel/kv';

export type LookupKind = 'award' | 'contractor' | 'contracts';
export type LookupOutcome = 'found' | 'missing' | 'failed';

const TTL_SECONDS = 4 * 24 * 60 * 60;
export const utcDay = (d: Date = new Date()) => d.toISOString().slice(0, 10);
const base = (kind: LookupKind, day: string) => `seo-cold-metrics:${kind}:${day}`;
export const metricKeys = (kind: LookupKind, day: string) => ({
  allowed: `${base(kind, day)}:allowed`,
  refused: `${base(kind, day)}:refused`,
  uniqueRequested: `${base(kind, day)}:hll:requested`,
  uniqueLookedUp: `${base(kind, day)}:hll:looked-up`,
  outcome: (o: LookupOutcome) => `${base(kind, day)}:outcome:${o}`,
});
/** The budget's own attempts counter (pre-existing keys, unchanged). */
export const attemptsKey = (kind: LookupKind, day: string) =>
  kind === 'award' ? `rl:seo-award-cold:${day}` : `rl:seo-cold:${kind}:${day}`;

export async function recordColdDecision(kind: LookupKind, allowed: boolean, id?: string, now: Date = new Date()): Promise<void> {
  try {
    const k = metricKeys(kind, utcDay(now));
    const p = kv.pipeline();
    const counter = allowed ? k.allowed : k.refused;
    p.incr(counter);
    p.expire(counter, TTL_SECONDS);
    if (id) {
      p.pfadd(k.uniqueRequested, id);
      p.expire(k.uniqueRequested, TTL_SECONDS);
      if (allowed) {
        p.pfadd(k.uniqueLookedUp, id);
        p.expire(k.uniqueLookedUp, TTL_SECONDS);
      }
    }
    await p.exec();
  } catch {
    /* metrics are best-effort */
  }
}

export async function recordColdOutcome(kind: LookupKind, outcome: LookupOutcome, now: Date = new Date()): Promise<void> {
  try {
    const key = metricKeys(kind, utcDay(now)).outcome(outcome);
    const p = kv.pipeline();
    p.incr(key);
    p.expire(key, TTL_SECONDS);
    await p.exec();
  } catch {
    /* metrics are best-effort */
  }
}

export interface KindDay {
  attempts: number;
  allowed: number;
  refused: number;
  uniqueRequested: number;
  uniqueLookedUp: number;
  outcomes: Record<LookupOutcome, number>;
}

export async function readKindDay(kind: LookupKind, day: string): Promise<KindDay> {
  const k = metricKeys(kind, day);
  const num = async (key: string) => Number((await kv.get<number>(key)) ?? 0);
  const [attempts, allowed, refused, uniqueRequested, uniqueLookedUp, found, missing, failed] = await Promise.all([
    num(attemptsKey(kind, day)), num(k.allowed), num(k.refused),
    kv.pfcount(k.uniqueRequested), kv.pfcount(k.uniqueLookedUp),
    num(k.outcome('found')), num(k.outcome('missing')), num(k.outcome('failed')),
  ]);
  return { attempts, allowed, refused, uniqueRequested, uniqueLookedUp, outcomes: { found, missing, failed } };
}

export const DEMAND_OPEN = '[seo-lookup-demand:v1]';
export const DEMAND_CLOSE = '[/seo-lookup-demand]';
const KEEP_DAYS = 60;

/** Rolling daily history stored in data_sources.notes: one entry per date, newest last, 60 days. */
export function mergeDemandHistory<E extends { date: string }>(prevNotes: string | null | undefined, entry: E): Array<{ date: string }> {
  let history: Array<{ date: string }> = [];
  const i = prevNotes?.indexOf(DEMAND_OPEN) ?? -1;
  const j = prevNotes?.indexOf(DEMAND_CLOSE) ?? -1;
  if (prevNotes && i !== -1 && j > i) {
    try { history = JSON.parse(prevNotes.slice(i + DEMAND_OPEN.length, j).trim()).history ?? []; } catch { history = []; }
  }
  return [...history.filter((h) => h.date !== entry.date), entry].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-KEEP_DAYS);
}
