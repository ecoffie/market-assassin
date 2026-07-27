/**
 * Data invariants — the shape checks that catch "the software produced a
 * wrong-but-VALID outcome".
 *
 * WHY THIS EXISTS: the NAICS family blow-out (fixed 2026-07-27) ran for ~4 months
 * and corrupted 1,144 profiles while every existing check reported healthy. The
 * dispatcher watchdog said the jobs ran. db-health-watch said the DB was fast.
 * check-data-freshness said the data was current. All true — and the data was
 * still wrong, because nothing was looking at its SHAPE.
 *
 * Unit tests didn't catch it either: they asserted expandNAICSCodes('541512',
 * false) === ['541512'], which is correct. The bug lived in an input shape nobody
 * thought to test. Tests check the cases you imagined; invariants check the shape
 * of reality.
 *
 * Every invariant here was breached by that incident and is computable from tables
 * we already have. See tasks/PRD-data-invariants-watch.md.
 *
 * ADDING ONE: append an object below. That is the whole job — the registry is data
 * so the cost of adding a check after the NEXT incident is ~6 lines, not a route.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CREDIT_PACKAGES } from '@/lib/mcp/packages';
import { getStripe } from '@/lib/stripe';
import { referencedPriceIds, referencedPaymentLinks, KNOWN_EXTERNAL_LINKS } from './stripe-refs';

export type Severity = 'warn' | 'critical';

export interface Invariant {
  /** Stable id, used as the KV key for transition tracking. */
  id: string;
  /** Human sentence for the Slack line. */
  label: string;
  severity: Severity;
  /** Measure the current value. */
  probe: (db: SupabaseClient) => Promise<number>;
  threshold: number;
  /** How `measured` is compared to `threshold` for a PASS. */
  compare: 'lte' | 'lt';
  /** What it means if this trips — goes straight into the alert. */
  means: string;
  /** Optional: render the measured value (e.g. as a percentage). */
  format?: (n: number) => string;
}

/**
 * Known-good identical NAICS arrays. Measured 2026-07-27 — both large clusters are
 * INTENDED seeds, not bugs:
 *   7,908 profiles — DEFAULT_NAICS from scripts/batch-enroll-alerts.js
 *     709 profiles — output of the 2026-07-27 remediation (curated 541 set)
 * Without this allowlist the duplicate-array check fires forever on 7,908 rows and
 * gets muted within a week — the classic way a good alarm dies.
 */
export const KNOWN_GOOD_ARRAYS: string[] = [
  // batch-enroll-alerts.js DEFAULT_NAICS
  '541330,541512,541611,541990,561210',
  // curated coverage sets from normalizeNAICSForPersist (sorted)
  '541330,541511,541512,541519,541611,541618,541690,541990',
  '561110,561210,561320,561410,561612,561720,561730,561990',
  '236115,236116,236118,236210,236220',
  '621111,621210,621399,621410,621610,621999',
];

/** Normalized key for an array so ordering never creates a false "distinct" shape. */
export function arrayKey(codes: string[] | null | undefined): string {
  if (!Array.isArray(codes) || codes.length === 0) return '';
  return [...codes].sort().join(',');
}

/** Page through a table applying a predicate — PostgREST caps a page at 1000. */
async function scanProfiles<T>(
  db: SupabaseClient,
  columns: string,
  fn: (rows: Record<string, unknown>[]) => T[],
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('user_notification_settings')
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`scan failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...fn(data as unknown as Record<string, unknown>[]));
    if (data.length < PAGE) break;
  }
  return out;
}

const codesOf = (r: Record<string, unknown>): string[] =>
  Array.isArray(r.naics_codes) ? (r.naics_codes as string[]) : [];
const kwOf = (r: Record<string, unknown>): string[] =>
  Array.isArray(r.keywords) ? (r.keywords as string[]) : [];

export const INVARIANTS: Invariant[] = [
  {
    id: 'naics.bloated_profiles_pct',
    label: 'Profiles with >25 NAICS codes',
    severity: 'critical',
    threshold: 3,
    compare: 'lt',
    format: (n) => `${n.toFixed(1)}%`,
    means:
      'A persist path is storing whole NAICS families again. One preset click should store a curated set (~8 codes), never a 51-code family. See normalizeNAICSForPersist.',
    probe: async (db) => {
      const rows = await scanProfiles(db, 'naics_codes', (rs) =>
        rs.map(codesOf).filter((c) => c.length > 0),
      );
      if (rows.length === 0) return 0;
      return (rows.filter((c) => c.length > 25).length / rows.length) * 100;
    },
  },
  {
    id: 'naics.unknown_duplicate_cluster',
    label: 'Largest UNRECOGNISED identical NAICS array (profiles sharing it)',
    severity: 'critical',
    threshold: 20,
    compare: 'lte',
    means:
      'Many profiles share a NAICS array that is not a known seed or curated set — the fingerprint of a bulk write or a preset exploding. 710 identical arrays is how the 2026-07 blow-out looked.',
    probe: async (db) => {
      const keys = await scanProfiles(db, 'naics_codes', (rs) =>
        rs.map((r) => arrayKey(codesOf(r))).filter((k) => k.split(',').length >= 2),
      );
      const allow = new Set(KNOWN_GOOD_ARRAYS.map((a) => arrayKey(a.split(','))));
      const counts = new Map<string, number>();
      for (const k of keys) {
        if (allow.has(k)) continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return counts.size ? Math.max(...counts.values()) : 0;
    },
  },
  {
    id: 'naics.bare_stub_profiles',
    label: 'Profiles holding an unusable 2-3 digit NAICS code',
    severity: 'warn',
    threshold: 5,
    compare: 'lte',
    means:
      'A short prefix leaked onto profiles. A 2-3 digit code can never match an opportunity\'s 6-digit NAICS, so those entries silently match nothing. Usually means a new industry preset has no family entry.',
    probe: async (db) => {
      const hits = await scanProfiles(db, 'naics_codes', (rs) =>
        rs.filter((r) => codesOf(r).some((c) => c.length >= 2 && c.length <= 3)),
      );
      return hits.length;
    },
  },
  {
    id: 'naics.zero_matchable_codes',
    label: 'Profiles with NAICS set but ZERO matchable (6-digit) codes',
    severity: 'critical',
    threshold: 5,
    compare: 'lte',
    means:
      'These users think they have targeting configured, but nothing they hold can ever match an opportunity. Worst case: they get no alerts and no error.',
    probe: async (db) => {
      const hits = await scanProfiles(db, 'naics_codes', (rs) =>
        rs.filter((r) => {
          const c = codesOf(r);
          return c.length > 0 && !c.some((x) => x.length >= 6);
        }),
      );
      return hits.length;
    },
  },
  {
    id: 'alerts.volume_concentration_pct',
    label: 'Share of all alerts sent to the top 10% of profiles',
    severity: 'critical',
    threshold: 40,
    compare: 'lt',
    format: (n) => `${n.toFixed(0)}%`,
    means:
      'A small set of profiles is absorbing most alert volume — the distribution tell of over-broad targeting. During the 2026-07 blow-out, 12% of profiles drove 82% of sends.',
    probe: async (db) => {
      const sends = await scanProfiles(db, 'total_alerts_sent', (rs) =>
        rs.map((r) => Number(r.total_alerts_sent ?? 0)).filter((n) => n > 0),
      );
      if (sends.length === 0) return 0;
      sends.sort((a, b) => b - a);
      const total = sends.reduce((s, n) => s + n, 0);
      if (total === 0) return 0;
      const topN = Math.max(1, Math.ceil(sends.length * 0.1));
      const top = sends.slice(0, topN).reduce((s, n) => s + n, 0);
      return (top / total) * 100;
    },
  },
  {
    id: 'alerts.dead_engagement_telemetry_pct',
    label: 'Alert-enabled users with ZERO engagement telemetry',
    severity: 'warn',
    threshold: 90,
    compare: 'lt',
    format: (n) => `${n.toFixed(0)}%`,
    means:
      'alerts_opened_30d / last_click_at are not being written, so we cannot measure whether alerts land. BREACHED ON PURPOSE at build time (100%) to make the dead columns visible instead of letting them rot. Fix by wiring open/click tracking, or delete the columns.',
    probe: async (db) => {
      const rows = await scanProfiles(db, 'alerts_enabled, alerts_opened_30d, last_click_at', (rs) =>
        rs.filter((r) => r.alerts_enabled === true),
      );
      if (rows.length === 0) return 0;
      const dead = rows.filter(
        (r) => !Number(r.alerts_opened_30d ?? 0) && !r.last_click_at,
      ).length;
      return (dead / rows.length) * 100;
    },
  },
  {
    id: 'alerts.enabled_but_unmatchable',
    label: 'Alerts ON but no NAICS and no keywords',
    severity: 'warn',
    threshold: 50,
    compare: 'lte',
    means:
      'These users have alerts enabled and nothing to match on — they will receive nothing, forever, with no error shown. Measured 279 at build time; the number should go DOWN.',
    probe: async (db) => {
      const hits = await scanProfiles(
        db,
        'alerts_enabled, naics_codes, keywords',
        (rs) =>
          rs.filter(
            (r) =>
              r.alerts_enabled === true &&
              codesOf(r).length === 0 &&
              kwOf(r).length === 0,
          ),
      );
      return hits.length;
    },
  },
  {
    id: 'billing.stale_refill_package',
    label: 'Auto-recharge rows pointing at a RETIRED credit package',
    severity: 'warn',
    threshold: 0,
    compare: 'lte',
    means:
      'A stored refill_package id no longer exists in CREDIT_PACKAGES. The charge still succeeds (packFor falls back to the current SKU) but SILENTLY, and the /mcp/account dropdown renders blank because no <option> matches — so the drift is invisible until someone reads the row. Found 2026-07-27: the only auto-recharge row was stuck on the retired "plus" pack since the 07-19 repricing. Migrate the row to a live package id.',
    probe: async (db) => {
      const valid = new Set(CREDIT_PACKAGES.map((p) => p.id));
      const { data, error } = await db
        .from('mcp_autorecharge')
        .select('user_email, refill_package, enabled');
      if (error) throw new Error(error.message);
      return (data || []).filter(
        (r) => r.enabled === true && !valid.has(String((r as { refill_package?: string }).refill_package ?? '')),
      ).length;
    },
  },
  {
    id: 'billing.dead_stripe_price',
    label: 'Stripe price ids in code that are archived or missing in Stripe',
    severity: 'critical',
    threshold: 0,
    compare: 'lte',
    means:
      'A price id hardcoded in the app no longer exists (or is archived) in Stripe. Nothing throws — the webhook simply stops recognising that price, so a real payment grants NOTHING, or a checkout 404s. Scanned from source, not a hand-kept list, so the check cannot itself drift.',
    probe: async () => {
      const stripe = getStripe();
      const ids = referencedPriceIds();
      let bad = 0;
      for (const id of ids) {
        try {
          const price = await stripe.prices.retrieve(id);
          if (!price.active) bad++;
        } catch {
          bad++; // deleted / wrong account / typo
        }
      }
      return bad;
    },
  },
  {
    id: 'billing.dead_payment_link',
    label: 'Stripe payment links in code that are deactivated or unknown',
    severity: 'critical',
    threshold: 0,
    compare: 'lte',
    means:
      'A buy.stripe.com link in the app is deactivated in Stripe (or belongs to no known link). The button still renders and the customer hits a dead checkout — silent lost revenue. This is how the archived $49 MCP top-up would have been caught. Known-external links are allowlisted in stripe-refs.ts.',
    probe: async () => {
      const stripe = getStripe();
      const urls = referencedPaymentLinks().filter((u) => !KNOWN_EXTERNAL_LINKS.has(u));
      const live = new Map<string, boolean>();
      for await (const link of stripe.paymentLinks.list({ limit: 100 })) {
        live.set(link.url, link.active);
      }
      return urls.filter((u) => live.get(u) !== true).length;
    },
  },
];
export function passes(inv: Invariant, measured: number): boolean {
  return inv.compare === 'lt' ? measured < inv.threshold : measured <= inv.threshold;
}
