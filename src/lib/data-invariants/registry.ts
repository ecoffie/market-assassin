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
import { INDUSTRY_PRESETS } from '@/lib/industry-presets';
import { normalizeNAICSForPersist } from '@/lib/utils/naics-expansion';
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
    id: 'naics.family_blowout_profiles',
    label: 'Alert-receiving profiles holding a near-complete NAICS FAMILY',
    severity: 'critical',
    threshold: 2,
    compare: 'lte',
    means:
      'A persist path stored a whole NAICS family again. One industry-preset click should store a curated set (~5-8 codes), never a 51-code family. See normalizeNAICSForPersist; remediate with scripts/fix-naics-mixed-blowout.ts.',
    probe: async (db) => {
      // Counts the DEFECT, not a proxy for it.
      //
      // This invariant used to be "% of profiles with >25 codes". That metric did its
      // job while the blow-out was live, but after remediation it kept breaching on
      // users who are simply broad: 157 of the 162 remaining had NO family run at all,
      // averaging 9 distinct subsectors × ~5 curated codes ≈ 45 codes. Nine preset
      // clicks is the system working, not a bug — so the old metric was measuring
      // legitimate breadth and would have been "fixed" by raising a threshold, i.e.
      // normalising a breach (Eric chose this rewrite, 2026-07-27).
      //
      // A near-complete FAMILY RUN is the actual fingerprint: a user picks industries,
      // never 15+ consecutive members of one subsector. Threshold 2 sits just under the
      // measured 10 so the number must come DOWN.
      const rows = await scanProfiles(
        db,
        'naics_codes, alerts_enabled, total_alerts_sent',
        (rs) =>
          rs
            .filter(
              (r) => r.alerts_enabled === true && Number(r.total_alerts_sent ?? 0) > 0,
            )
            .map(codesOf)
            .filter((c) => c.length > 0),
      );
      const FAMILY_RUN = 15; // members of ONE 3-digit subsector on a single profile
      return rows.filter((codes) => {
        const bySubsector = new Map<string, number>();
        for (const c of codes) {
          if (c.length < 6) continue;
          const f = c.slice(0, 3);
          bySubsector.set(f, (bySubsector.get(f) ?? 0) + 1);
        }
        return [...bySubsector.values()].some((n) => n >= FAMILY_RUN);
      }).length;
    },
  },
  {
    id: 'naics.unknown_duplicate_cluster',
    label: 'Largest identical NAICS array NOT explainable by the industry presets',
    severity: 'critical',
    threshold: 20,
    compare: 'lte',
    means:
      'Many profiles share a NAICS array that cannot be produced by clicking industry presets — the fingerprint of a bulk write or a preset exploding. 710 identical arrays is how the 2026-07 blow-out looked.',
    probe: async (db) => {
      // STRUCTURAL, not an enumerated allowlist (Eric's call, 2026-07-27).
      //
      // Remediation makes users CONVERGE: everyone who clicked Cybersecurity +
      // Professional Services collapses onto the same 9 codes, so 31 profiles shared
      // one array and this invariant flagged its own fix as an anomaly. Enumerating
      // each combination in KNOWN_GOOD_ARRAYS would mean chasing them forever as more
      // users re-save.
      //
      // Instead: build the universe of codes the industry picker can produce (each
      // preset run through normalizeNAICSForPersist) and IGNORE any cluster made
      // entirely of those — by definition preset output, not a bulk write.
      //
      // Tested both directions before shipping, because the naive versions failed
      // BACKWARDS: a curated-prefix-only universe flagged the benign 31 (518210 is a
      // preset code but not a curated-prefix output) while silencing the real 7,909
      // enrolment seed. The preset-derived universe fixes the first but still absorbs
      // the seed, so the explicit KNOWN_GOOD_ARRAYS check is KEPT for the two real
      // bulk-written seeds. Measured cluster sizes show a clean break: 7,909 and 710
      // (seeds, allowlisted) then a cliff to 31 and below (preset convergence).
      const rows = await scanProfiles(db, 'naics_codes', (rs) => rs.map(codesOf));
      const allow = new Set(KNOWN_GOOD_ARRAYS.map((a) => arrayKey(a.split(','))));

      const presetUniverse = new Set<string>();
      for (const preset of INDUSTRY_PRESETS) {
        for (const c of normalizeNAICSForPersist(preset.codes)) {
          if (c.length >= 6) presetUniverse.add(c);
        }
      }

      const counts = new Map<string, number>();
      for (const codes of rows) {
        if (codes.length < 2) continue;
        const key = arrayKey(codes);
        if (allow.has(key)) continue;
        // Entirely composed of preset-producible codes → convergence, not a bulk write.
        if (codes.every((c) => presetUniverse.has(c))) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
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
  {
    id: 'cron.long_job_never_confirmed',
    label: 'Long jobs whose last run is still unconfirmed (dispatched, never observed)',
    severity: 'warn',
    threshold: 2,
    compare: 'lte',
    means:
      'The dispatcher fire-and-forgets jobs whose timeout_ms exceeds its await cap: it records "dispatched" at ~12s with http_status NULL and the watchdog deliberately IGNORES that status. A long job that fires and then FAILS therefore looks identical to one that succeeds — no error, no alert, forever. Verified 2026-07-27 that the current dispatched jobs DID do their work (104 weekly briefings, 75 profile reminders), so this is a visibility gap rather than an outage; it trips when unconfirmed runs pile up.',
    probe: async (db) => {
      const { data, error } = await db
        .from('cron_jobs')
        .select('job_name, enabled, last_status, last_run_at')
        .eq('enabled', true)
        .eq('last_status', 'dispatched');
      if (error) throw new Error(error.message);
      // Only count jobs that have been sitting unconfirmed for over a week — a job
      // dispatched this morning is normal, one unconfirmed since June is not.
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return (data || []).filter((r) => {
        const t = (r as { last_run_at?: string }).last_run_at;
        return !t || new Date(t).getTime() < cutoff;
      }).length;
    },
  },
];
export function passes(inv: Invariant, measured: number): boolean {
  return inv.compare === 'lt' ? measured < inv.threshold : measured <= inv.threshold;
}
