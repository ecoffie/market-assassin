/**
 * Company detail — the ONE-CALL payload for the Opportunity Map company drawer.
 *
 * Mirrors how `/api/app/opportunity-detail` feeds the opp drawer: the drawer JS
 * makes a single fetch and gets everything it renders. Award history comes from
 * the shared UEI service (`getContractorHistoryByUei`) — the same aggregates MCP
 * `get_contractor_award_history` consumes — then enriches with set-asides + similar.
 *
 * COMPOUND (GOS #9): the company drawer replicates the opp drawer's shell/section
 * layout; this lib supplies the company-accurate CONTENT for those sections.
 *
 * Ground-in-real-data: every dollar / agency / NAICS / set-aside here traces to
 * USASpending award records (via BigQuery warehouse) — never an LLM guess and never
 * a request-time live USASpending pull.
 */
import {
  getRecipientByUei,
  getSetAsidesForRecipients,
  getSimilarRecipients,
  recipientSlug,
  SET_ASIDE_BUCKET_LABEL,
} from './recipients';
import { getUnifiedAgencyIntelligence } from '@/lib/agency-intelligence';
import {
  getContractorHistoryByUei,
  type ContractorHistoryByUeiResult,
} from '@/lib/contractor/history-by-uei';

export interface CompanyDetailAgency {
  agency: string;
  amount: number;
  share: number; // 0-1 fraction of this firm's total obligated
}

export interface CompanyDetailNaics {
  naics: string;
  description: string | null;
  amount: number;
  count: number;
}

export interface CompanyDetailAward {
  id: string;
  title: string;
  agency: string;
  subAgency: string | null;
  naics: string | null;
  naicsDescription: string | null;
  amount: number;
  startDate: string | null;
  endDate: string | null;
  state: string | null;
  url: string | null;
}

export interface CompanyDetailSimilar {
  uei: string;
  name: string;
  slug: string;
  totalObligated: number;
}

export interface CompanyDetail {
  uei: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  location: string; // "City, ST" (or just state / "—")
  locApprox: boolean; // true when location is state-only (no confirmed city) → drawer discloses it
  cageCode: string | null;
  totalObligated: number;
  awardCount: number;
  distinctAgencyCount: number;
  distinctNaicsCount: number;
  firstActionDate: string | null;
  lastActionDate: string | null;
  setAsides: string[]; // bucket keys, e.g. ['8A','SB']
  setAsideLabels: string[]; // human labels, e.g. ['8(a)','Small Biz']
  topAgencies: CompanyDetailAgency[];
  topNaics: CompanyDetailNaics[];
  recentAwards: CompanyDetailAward[];
  similar: CompanyDetailSimilar[];
  // "Know your buyer" agency intel for the firm's #1 (top-$) agency — the SAME
  // getUnifiedAgencyIntelligence the opp drawer's "Know your buyer" section uses.
  // null when the firm has no agency or the agency has no intel (section collapses silently).
  agencyIntel: { agency: string; priorities: string[]; painPoints: string[] } | null;
  /** Shared-history provenance (BigQuery warehouse ingest — not live USASpending). */
  historySource?: 'bigquery_normalized' | 'local_registry' | null;
  aggregatesCover?: 'bq_ingest' | null;
  historyResolution?: ContractorHistoryByUeiResult['resolution'];
  /** Warehouse/registry as-of stamp from getContractorHistoryByUei — NOT a live pull time. */
  warehouseAsOf?: string | null;
  historyDegraded?: boolean;
  enrichmentStatus?: 'complete' | 'budget_limited' | null;
  enrichmentPartial?: boolean;
}

export type CompanyDetailOutcome =
  | { status: 'ok'; company: CompanyDetail }
  | { status: 'not_found' }
  | { status: 'malformed'; detail?: string }
  | { status: 'unavailable'; detail?: string; degraded: true };

/**
 * Build the company drawer payload for a single UEI (the map pin's id).
 *
 * coldPolicy=always preserves the Map's authorized cold-BQ behavior; both Map and
 * MCP still share getContractorHistoryByUei for identity + aggregates.
 */
export async function resolveCompanyDetail(uei: string): Promise<CompanyDetailOutcome> {
  const cleanUei = (uei || '').trim().toUpperCase();
  if (!cleanUei) return { status: 'malformed', detail: 'uei required' };

  const hist = await getContractorHistoryByUei({
    uei: cleanUei,
    coldPolicy: 'always',
  });

  if (hist.resolution === 'malformed') {
    return { status: 'malformed', detail: hist.detail };
  }
  if (hist.resolution === 'unavailable') {
    return { status: 'unavailable', detail: hist.detail, degraded: true };
  }
  if (hist.resolution === 'not_found' || !hist.history?.contractor) {
    return { status: 'not_found' };
  }

  const history = hist.history;

  // Profile for HQ city/state/CAGE — warm-first then cold (Map-authorized).
  let profile = await getRecipientByUei(cleanUei, false).catch(() => null);
  if (!profile) {
    profile = await getRecipientByUei(cleanUei, true).catch(() => null);
  }

  let setAsides: string[] = [];
  if (hist.resolution === 'found') {
    try {
      const saMap = await getSetAsidesForRecipients([cleanUei], true);
      setAsides = saMap.get(cleanUei) || [];
    } catch (e) {
      console.error('[company-detail] set-aside lookup failed:', (e as Error).message);
    }
  }

  const topNaics: CompanyDetailNaics[] = (history.topNaics || []).map(
    (n: { naics: string; description: string | null; amount: number; count: number }) => ({
      naics: n.naics,
      description: n.description ?? null,
      amount: Number(n.amount || 0),
      count: Number(n.count || 0),
    }),
  );

  const topAgencies: CompanyDetailAgency[] = (history.topAgencies || []).map(
    (a: { agency: string; amount: number; share?: number }) => ({
      agency: a.agency,
      amount: Number(a.amount || 0),
      share: Number(a.share || 0),
    }),
  );

  const recentAwards: CompanyDetailAward[] = (history.recentAwards || []).map(
    (r: {
      id: string; title: string; agency: string; subAgency: string | null;
      naics: string | null; naicsDescription: string | null; amount: number;
      startDate: string | null; endDate: string | null; state: string | null; url: string | null;
    }) => ({
      id: r.id,
      title: r.title,
      agency: r.agency,
      subAgency: r.subAgency ?? null,
      naics: r.naics ?? null,
      naicsDescription: r.naicsDescription ?? null,
      amount: Number(r.amount || 0),
      startDate: r.startDate ?? null,
      endDate: r.endDate ?? null,
      state: r.state ?? null,
      url: r.url ?? null,
    }),
  );

  const leadNaics = topNaics[0]?.naics || (history.contractor?.naics || [])[0] || '';
  let similar: CompanyDetailSimilar[] = [];
  if (leadNaics && hist.resolution === 'found') {
    try {
      const sims = await getSimilarRecipients([cleanUei], `single:${cleanUei}`, leadNaics, 6);
      similar = sims.map((s) => ({
        uei: s.recipient_uei,
        name: s.recipient_name,
        slug: recipientSlug(s.recipient_name),
        totalObligated: Number(s.total_obligated || 0),
      }));
    } catch (e) {
      console.error('[company-detail] similar lookup failed:', (e as Error).message);
    }
  }

  const name: string = hist.name || history.contractor.company || profile?.recipient_name || cleanUei;
  const summary = history.summary || {};
  const city = (profile?.city || '').trim() || null;
  const state = (profile?.state || '').trim() || null;
  const location = city && state ? `${city}, ${state}` : state || '';

  let agencyIntel: { agency: string; priorities: string[]; painPoints: string[] } | null = null;
  const topAgencyName = topAgencies[0]?.agency || '';
  if (topAgencyName) {
    try {
      const intel = await getUnifiedAgencyIntelligence(topAgencyName);
      if (intel && (intel.priorities.length || intel.painPoints.length)) {
        agencyIntel = { agency: topAgencyName, priorities: intel.priorities.slice(0, 5), painPoints: intel.painPoints.slice(0, 5) };
      }
    } catch (e) {
      console.error('[company-detail] agency intel lookup failed:', (e as Error).message);
      agencyIntel = null;
    }
  }

  return {
    status: 'ok',
    company: {
      uei: cleanUei,
      name,
      slug: recipientSlug(name),
      city,
      state,
      location,
      locApprox: !city && !!state,
      cageCode: profile?.cage_code || null,
      totalObligated: Number(history.contractor.totalContractValue || summary.totalObligations || 0),
      awardCount: Number(history.contractor.contractCount || summary.awardCount || 0),
      distinctAgencyCount: Number(profile?.distinct_agency_count || topAgencies.length),
      distinctNaicsCount: Number(profile?.distinct_naics_count || topNaics.length),
      firstActionDate: profile?.first_action_date || null,
      lastActionDate: history.lastUpdated || profile?.last_action_date || hist.asOf || null,
      setAsides,
      setAsideLabels: setAsides.map((b) => SET_ASIDE_BUCKET_LABEL[b] || b),
      topAgencies,
      topNaics,
      recentAwards,
      similar,
      agencyIntel,
      historySource: hist.source,
      aggregatesCover: hist.aggregates_cover,
      historyResolution: hist.resolution,
      warehouseAsOf: hist.asOf,
      historyDegraded: hist.degraded,
      enrichmentStatus: history?.enrichment_status ?? null,
      enrichmentPartial: history?.partial === true,
    },
  };
}

/** Convenience: CompanyDetail or null (not_found / malformed). Unavailable throws so routes can 503. */
export async function getCompanyDetail(uei: string): Promise<CompanyDetail | null> {
  const r = await resolveCompanyDetail(uei);
  if (r.status === 'ok') return r.company;
  if (r.status === 'unavailable') {
    const err = new Error(r.detail || 'Warehouse history temporarily unavailable');
    (err as Error & { code?: string }).code = 'company_detail_unavailable';
    throw err;
  }
  return null;
}
