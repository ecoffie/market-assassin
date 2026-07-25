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

export type OppIntel = {
  predecessor: { incumbent: string | null; incumbentState: string | null; value: string | null; expires: string | null; vehicle: string | null; confidence: string | null } | null;
  agency: { painPoints: string[]; priorities: string[] } | null;
  pricing: { rates: Array<{ labor_category: string; hourly_rate: number | null; size: string | null }>; summary: string | null } | null;
};

export async function buildOppIntel(naics: string | null, agency: string | null, title: string | null, perToolMs = 14000): Promise<OppIntel> {
  const guard = <T>(p: Promise<T>, ms = perToolMs): Promise<T | null> => Promise.race([
    p.then((v) => v).catch(() => null),
    new Promise<null>((res) => setTimeout(() => res(null), ms)),
  ]);
  const agencyKey = agency ? normalizeAgencyKey(agency) : '';
  const [predecessor, agencyIntel, pricing] = await Promise.all([
    guard(findPredecessorAward({ naicsCode: naics || undefined, agencyName: agency || undefined, keyword: title || undefined })),
    agencyKey ? guard(getUnifiedAgencyIntelligence(agencyKey)) : Promise.resolve(null),
    naics ? guard(getPricingIntel({ naics })) : Promise.resolve(null),
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
  };
}

/** True when the intel has at least one non-empty section worth storing/showing. */
export function intelHasContent(i: OppIntel): boolean {
  return !!(i.predecessor || (i.agency && (i.agency.painPoints.length || i.agency.priorities.length)) || (i.pricing && i.pricing.rates.length));
}
