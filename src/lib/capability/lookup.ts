/**
 * Fetch capability profiles for a batch of contractors (PRD Phase 4 — the surfacing layer).
 * docs/PRD-contractor-capability-profiles.md
 *
 * SUPABASE ONLY — never BigQuery. The profiles were batch-built by
 * scripts/build-capability-profiles.ts precisely so that read paths stay off the 63M-row awards
 * table; a per-request BQ read is how the June-2026 $2,075 spike happened
 * (tasks/bigquery-cost-spike-2026-06.md).
 *
 * THE UEI JOIN PROBLEM: contractor search returns per-UEI rows (recipient_uei), but profiles are
 * keyed on the ROLLUP company (rollup_uei) because one company holds many UEIs — measured 104,594
 * child UEIs across 71,101 profiles (LOCKHEED MARTIN CORP alone has 181). So a search hit's UEI is
 * usually a CHILD, not the rollup key. We therefore resolve in two passes:
 *   1. direct hit on rollup_uei
 *   2. for whatever is still unmatched, a contains-match on the child_ueis[] array
 * Pass 2 is what makes the panel actually light up — without it most rows would silently show no
 * capability at all.
 */
import { getReadClient } from '@/lib/supabase/server-clients';

export interface CapabilityProfile {
  rollup_uei: string;
  rollup_name: string;
  capability_label: string | null;
  capability_summary: string | null;
  specialty_tier: 'specialist' | 'focused' | 'diversified' | null;
  specialty_score: number | null;
  top_pscs: Array<{ code?: string; description?: string; awards?: number; obligated?: number; share?: number }> | null;
  top_agencies: Array<{ agency?: string; awards?: number; obligated?: number; share?: number }> | null;
  set_asides_won: string[] | null;
  award_count: number;
  total_obligated: number;
}

const COLS =
  'rollup_uei, rollup_name, capability_label, capability_summary, specialty_tier, specialty_score, top_pscs, top_agencies, set_asides_won, award_count, total_obligated, child_ueis';

/**
 * Minimum top-PSC dollar share for a PARENT's capability to be inherited by a child UEI.
 *
 * Below this the parent is a holding company whose top code says nothing about any given
 * subsidiary, and inheriting it produces a confidently WRONG label. Measured boundary:
 *   ALASKA NATIVE GOVERNMENT SERVICES  0.114  → mislabeled its cyber subsidiary "Small craft"
 *   LOCKHEED MARTIN CORP               0.304  → "Fixed-wing aircraft" is genuinely apt
 * 0.20 sits between them. Only applies to the child-UEI fallback; a firm with its own profile
 * always shows it (pass 1), whatever its concentration.
 */
const MIN_INHERITABLE_SHARE = 0.2;

/**
 * Map a batch of UEIs (rollup OR child) → their capability profile.
 * Returns a Map keyed by the UEI **as passed in**, so callers can look up by the UEI they already
 * hold without knowing anything about rollups.
 *
 * Never throws: capability data is decoration on an existing panel, so a failure here must degrade
 * to "no capability shown", never take down contractor search.
 */
export async function getCapabilityProfilesByUei(
  ueis: Array<string | null | undefined>,
): Promise<Map<string, CapabilityProfile>> {
  const out = new Map<string, CapabilityProfile>();
  const clean = [...new Set(ueis.filter((u): u is string => !!u && u.trim().length > 0).map((u) => u.trim().toUpperCase()))];
  if (!clean.length) return out;

  try {
    const sb = getReadClient();

    // Pass 1 — direct rollup_uei hits.
    const { data: direct, error: e1 } = await sb
      .from('contractor_capability_profiles')
      .select(COLS)
      .in('rollup_uei', clean);
    if (e1) { console.error('[capability] rollup lookup failed:', e1.message); return out; }

    const matched = new Set<string>();
    for (const row of (direct || []) as Array<CapabilityProfile & { child_ueis?: string[] }>) {
      out.set(row.rollup_uei, row);
      matched.add(row.rollup_uei);
    }

    // Pass 2 — the remainder are child UEIs. `overlaps` on the text[] column resolves them to
    // their parent company in ONE query rather than N.
    const remaining = clean.filter((u) => !matched.has(u));
    if (remaining.length) {
      const { data: viaChild, error: e2 } = await sb
        .from('contractor_capability_profiles')
        .select(COLS)
        .overlaps('child_ueis', remaining);
      if (e2) { console.error('[capability] child lookup failed:', e2.message); return out; }

      for (const row of (viaChild || []) as Array<CapabilityProfile & { child_ueis?: string[] }>) {
        // ⚠️ HOLDING-COMPANY GUARD. A child UEI inherits its PARENT's profile, which is wrong
        // when the parent is a diversified holding company: COPPER RIVER CYBER SOLUTIONS
        // (UEI KLNECW2C6JK6) is one of 8 subsidiaries of ALASKA NATIVE GOVERNMENT SERVICES,
        // so it inherited the parent's top PSC and rendered as "Small craft" — a confidently
        // wrong capability claim for a cyber firm.
        //
        // Rule: only inherit when the parent is actually FOCUSED (specialist/focused). A
        // diversified parent's top PSC says nothing about which subsidiary does what, so we
        // show NOTHING rather than something misleading (a wrong label is worse than none).
        // A subsidiary with its own profile still matches directly in pass 1 and is unaffected.
        // Inherit only when the parent's top PSC is MEANINGFUL for its family. The signal is
        // specialty_score (top-PSC dollar share), not child count — measured:
        //   LOCKHEED MARTIN CORP  0.304 over 448 PSCs, 181 children → "Fixed-wing aircraft" is
        //                         genuinely what they're known for. KEEP.
        //   ALASKA NATIVE GOV SVCS 0.114 over 111 PSCs, 8 children → "Small craft" is noise, and
        //                         it mislabeled subsidiary COPPER RIVER CYBER SOLUTIONS. DROP.
        // So child count is the wrong discriminator (Lockheed has 22x more children than the
        // holding company that caused the bug); dollar concentration is the right one.
        //
        // NOTE: a first attempt required the requested UEI to equal rollup_uei, which blocked
        // Lockheed entirely (0/10) — search returns CHILD UEIs, so that test never passed for
        // exactly the large firms whose own profile is correct and wanted.
        const share = row.specialty_score ?? 0;
        if (share < MIN_INHERITABLE_SHARE) continue;

        for (const child of row.child_ueis || []) {
          if (remaining.includes(child)) out.set(child, row);
        }
      }
    }
  } catch (err) {
    // Degrade silently — the panel still renders its award data.
    console.error('[capability] lookup threw:', (err as Error).message);
  }

  return out;
}

/** The compact shape the UI actually renders — keeps the API payload small. */
export interface CapabilityBadge {
  label: string | null;
  summary: string | null;
  tier: 'specialist' | 'focused' | 'diversified' | null;
  /** Top-PSC dollar share as a 0-100 integer, for "82% of contract dollars". */
  sharePct: number | null;
  /** Primary buyer, only when >= 40% concentrated (below that "top" agency is noise). */
  topAgency: string | null;
  topAgencyPct: number | null;
  /** True when the firm has won work under ANY real set-aside. Behavior, NOT a certification —
   *  recipient_certifications (SAM) is the source of truth for actual certs. */
  wonSetAside: boolean;
}

export function toCapabilityBadge(p: CapabilityProfile | undefined): CapabilityBadge | null {
  if (!p || !p.capability_label) return null;
  const topAgency = p.top_agencies?.[0];
  const agencyShare = topAgency?.share ?? 0;
  const sa = (p.set_asides_won || []).filter((s) => s && !/NO SET ASIDE/i.test(s));
  return {
    label: p.capability_label,
    summary: p.capability_summary,
    tier: p.specialty_tier,
    sharePct: p.specialty_score == null ? null : Math.round(p.specialty_score * 100),
    topAgency: agencyShare >= 0.4 ? topAgency?.agency ?? null : null,
    topAgencyPct: agencyShare >= 0.4 ? Math.round(agencyShare * 100) : null,
    wonSetAside: sa.length > 0,
  };
}
