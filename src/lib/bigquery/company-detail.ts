/**
 * Company detail — the ONE-CALL payload for the Opportunity Map company drawer.
 *
 * Mirrors how `/api/app/opportunity-detail` feeds the opp drawer: the drawer JS
 * makes a single fetch and gets everything it renders. This composes the EXISTING
 * BigQuery recipient functions (nothing new on the data side — the profile, award
 * history, top agencies, top NAICS, recent awards + the per-firm set-aside
 * eligibility and similar-firms helpers all already exist) into the shape the
 * company drawer consumes.
 *
 * COMPOUND (GOS #9): the company drawer replicates the opp drawer's shell/section
 * layout; this lib supplies the company-accurate CONTENT for those sections —
 * award history (what they've won), top agencies they sell to, NAICS/what they do,
 * set-asides they hold, location, and similar companies.
 *
 * Ground-in-real-data: every dollar / agency / NAICS / set-aside here traces to
 * USASpending award records (via BigQuery) — never an LLM guess. A firm with no
 * set-aside award returns NO set-aside (never a fabricated "Open"/"None").
 */
import {
  getBqContractorHistory,
  getRecipientByUei,
  getSetAsidesForRecipients,
  getSimilarRecipients,
  recipientSlug,
  SET_ASIDE_BUCKET_LABEL,
} from './recipients';
import { getUnifiedAgencyIntelligence } from '@/lib/agency-intelligence';

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
}

/**
 * Build the company drawer payload for a single UEI (the map pin's id).
 * Returns null when the UEI resolves to no contractor (honest miss).
 *
 * liveBq is threaded true by the authed in-app route (the map is signed-in for
 * the Companies dataset), so cold BQ misses actually scan instead of returning
 * [] like the public/unauthed cacheOnly default.
 */
export async function getCompanyDetail(uei: string): Promise<CompanyDetail | null> {
  const cleanUei = (uei || '').trim();
  if (!cleanUei) return null;

  // getBqContractorHistory already composes profile + yearly series + top
  // agencies (with $ + share) + top NAICS + recent awards from BigQuery in one
  // call (liveBq baked in). We reshape it for the drawer and enrich with the two
  // things it doesn't carry: per-firm set-aside eligibility + similar firms.
  // The award-history composite + the raw recipient profile in parallel. The
  // profile carries the firm's HQ city/state/CAGE + first/last action dates that
  // the history block doesn't surface — the drawer's Location + header need them.
  const [history, profile] = await Promise.all([
    getBqContractorHistory({ uei: cleanUei }),
    getRecipientByUei(cleanUei, true),
  ]);
  if (!history || !history.contractor) return null;

  // Set-asides this firm actually holds (real awards, bounded single-UEI lookup —
  // never a state/nationwide scan). Empty = no set-aside won (never fabricated).
  let setAsides: string[] = [];
  try {
    const saMap = await getSetAsidesForRecipients([cleanUei], true);
    setAsides = saMap.get(cleanUei) || [];
  } catch (e) {
    // Non-fatal: a set-aside lookup failure must not sink the whole drawer.
    console.error('[company-detail] set-aside lookup failed:', (e as Error).message);
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
    (a: { agency: string; amount: number; share: number }) => ({
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

  // Similar companies = the opp drawer's "Similar opportunities" analog. Reuses
  // getSimilarRecipients (same top NAICS, actively competing, parent-rolled up,
  // excludes this firm). Only meaningful when we know the firm's lead NAICS.
  const leadNaics = topNaics[0]?.naics || (history.contractor?.naics || [])[0] || '';
  let similar: CompanyDetailSimilar[] = [];
  if (leadNaics) {
    try {
      const sims = await getSimilarRecipients([cleanUei], `single:${cleanUei}`, leadNaics, 6);
      similar = sims.map((s) => ({
        uei: s.recipient_uei,
        name: s.recipient_name,
        slug: recipientSlug(s.recipient_name),
        totalObligated: Number(s.total_obligated || 0),
      }));
    } catch (e) {
      // Non-fatal — omit the similar section rather than fail the drawer.
      console.error('[company-detail] similar lookup failed:', (e as Error).message);
    }
  }

  // City/state: getBqContractorHistory doesn't surface the profile city/state in
  // its contractor block, but the recent-awards carry a pop_state and the map pin
  // already passed city/state through. We pull location from the summary/profile
  // where available; the route also accepts pin-passed city/state as a fallback.
  const name: string = history.contractor.company || profile?.recipient_name || cleanUei;
  const summary = history.summary || {};
  const city = (profile?.city || '').trim() || null;
  const state = (profile?.state || '').trim() || null;
  const location = city && state ? `${city}, ${state}` : state || '';

  // "Know your buyer" — agency intel for the firm's #1 agency (top by $). Reuses the exact
  // getUnifiedAgencyIntelligence the opp drawer's "Know your buyer" section uses. Fail-soft: a
  // lookup error / no-intel agency yields null and the drawer section collapses silently (GOS #9,
  // gap 6 — replicate the opp drawer's proven implementation, keyed on the firm's top agency).
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
      agencyIntel = null; // nice-to-have; never fail the whole drawer for it
    }
  }

  return {
    uei: cleanUei,
    name,
    slug: recipientSlug(name),
    city,
    state,
    location,
    locApprox: !city && !!state, // state-only = an approximate (state-level) location, no confirmed city
    cageCode: profile?.cage_code || null,
    totalObligated: Number(history.contractor.totalContractValue || summary.totalObligations || 0),
    awardCount: Number(history.contractor.contractCount || summary.awardCount || 0),
    distinctAgencyCount: Number(profile?.distinct_agency_count || topAgencies.length),
    distinctNaicsCount: Number(profile?.distinct_naics_count || topNaics.length),
    firstActionDate: profile?.first_action_date || null,
    lastActionDate: history.lastUpdated || profile?.last_action_date || null,
    setAsides,
    setAsideLabels: setAsides.map((b) => SET_ASIDE_BUCKET_LABEL[b] || b),
    topAgencies,
    topNaics,
    recentAwards,
    similar,
    agencyIntel,
  };
}
