/**
 * Per-opportunity intelligence — reuses existing engines (predecessor history, agency
 * intel, GSA pricing) and shapes them for the map detail drawer.
 *
 * SHARED lib: the detail API and the precompute backfill/cron both call buildOppIntel(),
 * so the stored data and any live fallback are identical. (The store-then-read pattern
 * mirrors sow_text / seo_summary / map_lat.)
 *
 * Fail-soft + time-boxed: a slow/failed tool yields that section null, never hangs.
 * Field names validated against real tool output.
 */
import { findPredecessorAward } from '@/lib/usaspending/find-predecessor';
import { getUnifiedAgencyIntelligence } from '@/lib/agency-intelligence';
import { getPricingIntel } from '@/mcp/tools/pricing-intel';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';
import { getComparableAwardRange } from '@/lib/opportunities/value-range';

export type OppIntel = {
  predecessor: { incumbent: string | null; incumbentState: string | null; value: string | null; expires: string | null; vehicle: string | null; confidence: string | null } | null;
  agency: { painPoints: string[]; priorities: string[] } | null;
  pricing: { rates: Array<{ labor_category: string; hourly_rate: number | null; size: string | null }>; summary: string | null } | null;
  // Grounded $ value range — the card "price" hook, branded M-Estimate(TM). Predecessor value
  // preferred; else comparable awards (median + 25th–75th pct from USASpending). null when neither
  // is available (never faked). `distribution` powers the chart — optional (see value-range.ts).
  valueRange: {
    low: number; median: number; high: number; label: string; source: 'predecessor' | 'comparable_awards';
    distribution?: { min: number; max: number; count: number }[];
  } | null;
};

export async function buildOppIntel(naics: string | null, agency: string | null, title: string | null, perToolMs = 14000, subAgency: string | null = null, psc: string | null = null, opts: { estimate?: boolean } = {}): Promise<OppIntel> {
  const guard = <T>(p: Promise<T>, ms = perToolMs): Promise<T | null> => Promise.race([
    p.then((v) => v).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), ms)),
  ]);
  const agencyKey = agency ? normalizeAgencyKey(agency) : '';
  // The DERIVED M-Estimate (predecessor inference + comparable-award band) is for OPEN opportunities
  // ONLY (Eric 2026-08-03: "do it for opps not recompetes"). A recompete/awarded listing already
  // carries its OWN real contract value — deriving one is both wasteful AND the source of the
  // wrong-predecessor bug class (a small buy inheriting a giant unrelated award's ceiling). So the
  // caller opts OUT with estimate:false; the recompete-detail drawer only wants agency + pricing.
  const wantEstimate = opts.estimate !== false;
  // PSC is the "what was BOUGHT" signal — it OUTRANKS NAICS for product buys (Eric 2026-08-03:
  // a BOP APX-radio buy carries broad NAICS 541519 "IT services" but PSC 6940 = comms hardware;
  // NAICS-only matching pulled a $3.8B Army IT IDV as the "incumbent"). Thread it to BOTH the
  // predecessor matcher AND the comparable-award range so the M-Estimate is product-scoped.
  const [predecessor, agencyIntel, pricing, cmpRange] = await Promise.all([
    wantEstimate ? guard(findPredecessorAward({ naicsCode: naics || undefined, pscCode: psc || undefined, agencyName: agency || undefined, keyword: title || undefined })) : Promise.resolve(null),
    agencyKey ? guard(getUnifiedAgencyIntelligence(agencyKey)) : Promise.resolve(null),
    naics ? guard(getPricingIntel({ naics })) : Promise.resolve(null),
    (wantEstimate && naics) ? guard(getComparableAwardRange(naics, agency, { psc, subAgency, timeoutMs: perToolMs })) : Promise.resolve(null),
  ]);

  const fmt = (n?: number | null) => (typeof n === 'number' && n > 0)
    ? (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pred = predecessor as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = agencyIntel as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pr = pricing as any;
  const topVendors = (pr && pr._meta?.grounded && pr.pricing?.topVendors) ? pr.pricing.topVendors : [];
  const asText = (x: unknown): string | null => (typeof x === 'string' ? x : (x && typeof x === 'object' ? ((x as Record<string, string>).text || (x as Record<string, string>).title || (x as Record<string, string>).description) : null)) || null;

  return {
    predecessor: (pred && pred.recipientName) ? {
      incumbent: pred.recipientName || null,
      incumbentState: pred.recipientState || null,
      value: fmt(pred.ceiling ?? pred.currentValue ?? pred.obligated),
      expires: (pred.popPotentialEnd || pred.popEnd) ? String(pred.popPotentialEnd || pred.popEnd).slice(0, 10) : null,
      vehicle: pred.parentIdvPiid || null,
      confidence: pred.matchConfidence || null,
    } : null,
    agency: ai ? {
      painPoints: (ai.painPoints || []).slice(0, 4).map(asText).filter(Boolean) as string[],
      priorities: (ai.priorities || []).slice(0, 3).map(asText).filter(Boolean) as string[],
    } : null,
    pricing: topVendors.length ? {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rates: topVendors.slice(0, 4).map((v: any) => ({
        labor_category: v.name,
        hourly_rate: (typeof v.avgRate === 'number') ? Math.round(v.avgRate) : null,
        size: v.businessSize || null,
      })),
      summary: `${pr.pricing.topVendors.length} vendors analyzed via GSA CALC`,
    } : null,
    // $ value range: the predecessor's own contract value is the strongest anchor WHEN the match is
    // trustworthy; else the comparable-award median/IQR; else null. (Eric 2026-08-03, variance C — the
    // M-Estimate oracle sweep.) A predecessor ANCHORS the estimate only when it passes a SANITY GATE,
    // because the matcher can find the right WORK on a program that dwarfs a small buy: "Sole Source —
    // Teal Drones" matched Raytheon's $1.06B drone program (right work, 1000× too big); "Drug Field
    // Test Kits" a $1.35B award vs a $0.5M market. The gate:
    //   • confidence must NOT be 'low' (a shaky match shouldn't set the price), AND
    //   • the predecessor value must be within 10× the comparable-award median (a real single
    //     opportunity isn't 100–2700× its own market — that's a mega-program mis-scoped to a small buy).
    // Fail either → use the comparable band (the honest market answer, already computed in parallel).
    valueRange: (() => {
      const cr = cmpRange as { low: number; median: number; high: number; n: number; basis: string; distribution?: { min: number; max: number; count: number }[] } | null;
      const predVal = pred ? (pred.ceiling ?? pred.currentValue ?? pred.obligated) : null;
      const conf = pred ? pred.matchConfidence : null;
      const cmpMed = cr && cr.median > 0 ? cr.median : null;
      const predPlausible =
        typeof predVal === 'number' && predVal > 0 &&
        conf !== 'low' &&
        // within 10× the market median; if we have no comparable to check against, allow it (the
        // predecessor is the only signal) — the matcher's own PSC/work gate already rejected the worst.
        (cmpMed == null || predVal <= cmpMed * 10);
      if (predPlausible) {
        return { low: Math.round((predVal as number) * 0.85), median: Math.round(predVal as number), high: Math.round((predVal as number) * 1.15), label: 'based on the prior contract', source: 'predecessor' as const };
      }
      if (cr) {
        return {
          low: cr.low, median: cr.median, high: cr.high,
          label: `${cr.n} comparable ${cr.basis} contracts`, source: 'comparable_awards' as const,
          ...(cr.distribution ? { distribution: cr.distribution } : {}),
        };
      }
      return null;
    })(),
  };
}

/** True when the intel has at least one non-empty section worth storing/showing. */
export function intelHasContent(i: OppIntel): boolean {
  return !!(i.predecessor || (i.agency && (i.agency.painPoints.length || i.agency.priorities.length)) || (i.pricing && i.pricing.rates.length));
}
