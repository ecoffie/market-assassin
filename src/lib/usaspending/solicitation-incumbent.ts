/**
 * Resolve a SAM solicitation (by sol #, notice UUID, or description-held
 * identifier) and find the LIKELY prior award (incumbent + $) behind it.
 *
 * Why this exists: users paste RFQ numbers like 140L6226Q0013 into Chat / the
 * header lookup. Those are NOT USASpending PIIDs — get_award_detail fails. Chat
 * previously had no one-step tool that chains live SAM → USASpending predecessor.
 *
 * Sources (in order):
 *   1. sam_opportunities cache (fast)
 *   2. Live SAM.gov Opportunities API (solnum / noticeid)
 *   3. Public sam.gov search index (no key — recovers when API rate-limits)
 *
 * Predecessor = best-matching recent USASpending award by title keywords +
 * NAICS/agency, scored for relevance (NOT certified link — label "likely").
 */
import { fetchAwardDetail, type AwardDetail } from '@/lib/usaspending/award-detail';
import {
  deriveSolicitationStatus,
  resolveCanonicalSolicitation,
  selectCanonicalVersion,
  solicitationStatusLabel,
  toResolvedNoticeFields,
  type SolicitationMatchBy,
  type SolicitationStatus,
} from '@/lib/sam/resolve-solicitation';
import { isNoticeUuid, normalizeNoticeUuid } from '@/lib/sam/notice-identity';
import {
  groundIncumbent,
  namedIncumbent,
  reconcileMatchConfidence,
  type ConfidenceConstraint,
  type IncumbentCertainty,
} from '@/lib/usaspending/incumbent-evidence';

const SAM_SEARCH = 'https://api.sam.gov/opportunities/v2/search';
const SAM_PUBLIC = 'https://sam.gov/api/prod/sgs/v1/search/';
const USAS_SEARCH = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'services', 'service', 'contract', 'solicitation', 'combined', 'synopsis',
  'base', 'year', 'years', 'yea', 'option', 'options', 'period', 'periods', 'plus',
  'requirement', 'requirements', 'purchase', 'support', 'program',
  // Procurement-VEHICLE / notice-type boilerplate (Eric 2026-08-03, variance C): these are how the
  // notice is BEING BOUGHT, never the work. "Sole Source"/"Notice of Intent" titles were collapsing
  // to the same generic keyword search → the same one giant award (dozens shared the identical wrong
  // $1.06B median). Drop them so the search keys on the actual product.
  'sole', 'source', 'notice', 'intent', 'noncompetitively', 'noncompetitive', 'competitive',
  'award', 'special', 'rfq', 'rfi', 'rfp', 'sources', 'sought', 'presolicitation', 'amendment',
]);

export interface ResolvedNotice {
  notice_id: string;
  solicitation_number: string | null;
  title: string | null;
  agency: string | null;
  department: string | null;
  naics_code: string | null;
  psc_code: string | null;
  set_aside: string | null;
  notice_type: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  ui_link: string | null;
  source: 'cache' | 'sam_api' | 'sam_public';
  active?: boolean | null;
  archive_date?: string | null;
  status?: SolicitationStatus;
  amendment?: string | null;
  matched_by?: SolicitationMatchBy;
  version_count?: number;
  deadline_conflict?: boolean;
  deadline_conflict_reasons?: import('@/lib/sam/notice-identity').DeadlineConflictReason[];
  lot_deadlines?: import('@/lib/sam/notice-identity').LotDeadline[];
  notice_ids?: string[];
  deadline_source?: 'responseDeadLine' | 'responseDate' | 'cache' | null;
}

export interface PriorAwardHit extends AwardDetail {
  matchConfidence: 'high' | 'medium' | 'low';
  matchScore: number;
  distinctiveHits?: number;
  pscMatch?: boolean;
  naicsMatch?: boolean;
  noticeSector?: string | null;
  awardSector?: string | null;
  /** Why structured evidence lowered the textual confidence (null = it did not). */
  confidenceConstraint?: ConfidenceConstraint | null;
  incumbent_certainty?: IncumbentCertainty;
}

export interface SolicitationIncumbentResult {
  queried: string;
  notice: ResolvedNotice | null;
  incumbent: PriorAwardHit | null;
  prior_awards: PriorAwardHit[];
  summary: string | null;
  _meta: {
    grounded_notice: boolean;
    grounded_incumbent: boolean;
    degraded: boolean;
    notice_source: ResolvedNotice['source'] | null;
    status?: SolicitationStatus | null;
    amendment?: string | null;
    matched_by?: SolicitationMatchBy | null;
    version_count?: number;
    deadline_conflict?: boolean;
    notice_ids?: string[];
    incumbent_certainty?: IncumbentCertainty;
    incumbent_reason?: string;
  };
}

function isUuid(s: string): boolean {
  return isNoticeUuid(s);
}

function normalizeUuid(s: string): string {
  return normalizeNoticeUuid(s) ?? s.trim().replace(/-/g, '').toLowerCase();
}

/** "INTERIOR, DEPARTMENT OF THE" → "Department of the Interior" */
export function toUsaSpendingAgency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(.+?),\s*DEPARTMENT OF( THE)?$/i);
  if (m) {
    const dept = m[1].trim().replace(/\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    return `Department of${m[2] ? ' the' : ''} ${dept}`.replace(/\s+/g, ' ').trim();
  }
  if (/bureau of land management/i.test(s)) return 'Department of the Interior';
  if (/department of the interior|(^|\b)interior(\b|$)/i.test(s)) return 'Department of the Interior';
  if (/department of defense|^dod$|^defense/i.test(s)) return 'Department of Defense';
  if (/department of veterans|veterans affairs|^va$/i.test(s)) return 'Department of Veterans Affairs';
  return s;
}

/** Significant title words → ranked keyword candidates for USASpending (exact-phrase). */
export function titleKeywordCandidates(title: string | null | undefined): string[] {
  if (!title) return [];
  const cleaned = title.replace(/[()[\],.|/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w));

  // Site / customer / vehicle noise that appears in BOTH the facility and specialty awards — strip it
  // so the SEARCH phrases are WORK-centered ("WHEATLAND HOOF TRIMMING" beats "WHEATLAND ORC"). Eric
  // 2026-08-03 (variance B): "national guard"/"facilities"/"laboratory" were becoming search phrases,
  // pulling a giant customer-matched IDV (Sikorsky's $11.6B National Guard aircraft) into the pool.
  // Drop customer + place tokens here so USASpending is searched for the WORK, not the buyer/site.
  const SITE_NOISE = new Set([
    'orc', 'orcs', 'facility', 'facilities', 'complex', 'region', 'regional', 'district', 'base',
    'station', 'laboratory', 'laboratories', 'lab', 'center', 'campus', 'depot', 'installation',
    'national', 'guard', 'army', 'navy', 'force', 'marine', 'corps', 'coast', 'reserve', 'joint',
    'federal', 'government', 'agency', 'bureau', 'department', 'command', 'division',
  ]);
  // If stripping noise would leave <2 words, fall back to the raw words (a title that's mostly
  // customer/place still needs SOMETHING to search — don't zero it out).
  const stripped = words.filter((w) => !SITE_NOISE.has(w.toLowerCase()));
  const workish = stripped.length >= 2 ? stripped : words;

  const out: string[] = [];
  if (workish.length >= 2) out.push(workish.slice(0, 4).join(' '));
  if (workish.length >= 2) out.push(workish.slice(0, 3).join(' '));
  if (workish.length >= 2) out.push(workish.slice(0, 2).join(' '));
  // Also last-two / last-three work words ("HOOF TRIMMING")
  if (workish.length >= 2) out.push(workish.slice(-2).join(' '));
  if (workish.length >= 3) out.push(workish.slice(-3).join(' '));
  if (cleaned.length >= 6) out.push(cleaned.slice(0, 80));

  const seen = new Set<string>();
  return out.filter((k) => {
    const key = k.toLowerCase();
    if (seen.has(key) || key.length < 5) return false;
    seen.add(key);
    return true;
  });
}

function mmddyyyy(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

async function fromCache(q: string): Promise<ResolvedNotice | null> {
  const canonical = await resolveCanonicalSolicitation(q);
  if (!canonical) return null;
  return { ...toResolvedNoticeFields(canonical), source: 'cache', deadline_source: 'cache' };
}

async function fromSamApi(q: string): Promise<ResolvedNotice | null> {
  const apiKey = process.env.SAM_API_KEY || process.env.SAM_GOV_API_KEY;
  if (!apiKey) return null;
  const today = new Date();
  const windows = [
    { from: `01/01/${today.getFullYear()}`, to: mmddyyyy(today) },
    { from: `01/01/${today.getFullYear() - 1}`, to: `12/31/${today.getFullYear() - 1}` },
  ];
  const trimmed = q.trim();
  const params: { param: string; value: string }[] = [];
  if (isUuid(trimmed)) params.push({ param: 'noticeid', value: normalizeUuid(trimmed) });
  else params.push({ param: 'solnum', value: trimmed });

  for (const { param, value } of params) {
    for (const w of windows) {
      try {
        const url = new URL(SAM_SEARCH);
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('limit', '5');
        url.searchParams.set('postedFrom', w.from);
        url.searchParams.set('postedTo', w.to);
        url.searchParams.set(param, value);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) continue;
        const j = await res.json();
        const mapped: ResolvedNotice[] = [];
        for (const opp of j.opportunitiesData || []) {
          const noticeId = String(opp.noticeId || opp.noticeid || '').replace(/-/g, '');
          if (!noticeId) continue;
          const fullParent = opp.fullParentPathName || '';
          const orgParts = String(fullParent).split('.').map((s: string) => s.trim()).filter(Boolean);
          const active = opp.active === true || opp.active === 'Yes'
            ? true
            : opp.active === false || opp.active === 'No'
              ? false
              : null;
          const official = opp.responseDeadLine || null;
          const fallback = opp.responseDate || null;
          const response_deadline = official || fallback;
          const deadline_source = official ? 'responseDeadLine' : fallback ? 'responseDate' : null;
          mapped.push({
            notice_id: noticeId,
            solicitation_number: opp.solicitationNumber || trimmed,
            title: opp.title || null,
            agency: orgParts[1] || orgParts[0] || opp.department || null,
            department: orgParts[0] || opp.department || null,
            naics_code: opp.naicsCode || (Array.isArray(opp.naics) ? opp.naics[0]?.code : null) || null,
            psc_code: opp.classificationCode || null,
            set_aside: opp.typeOfSetAsideDescription || opp.typeOfSetAside || null,
            notice_type: opp.type || opp.typeOfNotice || null,
            posted_date: opp.postedDate || null,
            response_deadline,
            ui_link: opp.uiLink || `https://sam.gov/opp/${noticeId}/view`,
            source: 'sam_api',
            active,
            archive_date: opp.archiveDate || null,
            status: deriveSolicitationStatus({
              active,
              response_deadline,
              archive_date: opp.archiveDate || null,
            }),
            version_count: 0,
            deadline_source,
          });
        }
        const picked = isUuid(trimmed)
          ? mapped.find((n) => normalizeUuid(n.notice_id) === normalizeUuid(trimmed)) ?? null
          : selectCanonicalVersion(mapped);
        if (!picked) continue;
        picked.version_count = mapped.length;
        picked.notice_ids = mapped.map((n) => n.notice_id);
        picked.deadline_conflict = !isUuid(trimmed) && mapped.some((n) =>
          n.response_deadline && picked.response_deadline &&
          n.response_deadline.slice(0, 10) !== String(picked.response_deadline).slice(0, 10));
        return picked;
      } catch {
        // try next window / param
      }
    }
  }
  return null;
}

async function fromSamPublic(q: string): Promise<ResolvedNotice | null> {
  try {
    const url = `${SAM_PUBLIC}?index=opp&q=${encodeURIComponent(q.trim())}&page=0&size=5`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mindy-GovConGiants (hello@getmindy.ai)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const results = j?._embedded?.results || [];
    const want = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const matched = results.filter((r: { solicitationNumber?: string; _id?: string }) => {
      const sol = String(r.solicitationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const id = String(r._id || '').replace(/-/g, '').toLowerCase();
      return sol === want || id === want.toLowerCase() || sol.includes(want);
    });
    const pool = matched.length ? matched : results;
    const mapped: ResolvedNotice[] = [];
    for (const opp of pool) {
      const noticeId = String(opp._id || '').replace(/-/g, '');
      if (!noticeId) continue;
      const orgNames = (opp.organizationHierarchy || [])
        .map((o: { name?: string; organizationName?: string }) => o.name || o.organizationName)
        .filter(Boolean);
      const naics = Array.isArray(opp.naics) ? opp.naics[0]?.code : opp.naics?.code;
      const psc = Array.isArray(opp.psc) ? opp.psc[0]?.code : null;
      const response_deadline = opp.responseDate || opp.responseDateActual || null;
      mapped.push({
        notice_id: noticeId,
        solicitation_number: opp.solicitationNumber || null,
        title: opp.title || null,
        agency: orgNames[1] || orgNames[0] || null,
        department: orgNames[0] || null,
        naics_code: naics ? String(naics) : null,
        psc_code: psc ? String(psc) : null,
        set_aside: opp.solicitation?.setAside?.value || opp.solicitation?.setAside?.code || null,
        notice_type: opp.type?.value || null,
        posted_date: opp.publishDate || null,
        response_deadline,
        ui_link: `https://sam.gov/opp/${noticeId}/view`,
        source: 'sam_public',
        status: deriveSolicitationStatus({
          active: null,
          response_deadline,
          archive_date: null,
        }),
        deadline_source: 'responseDate',
        version_count: 0,
      });
    }
    const picked = isUuid(q)
      ? mapped.find((n) => normalizeUuid(n.notice_id) === normalizeUuid(q)) ?? null
      : selectCanonicalVersion(mapped);
    if (!picked) return null;
    picked.version_count = mapped.length;
    picked.notice_ids = mapped.map((n) => n.notice_id);
    picked.deadline_conflict = !isUuid(q) && mapped.some((n) =>
      n.response_deadline && picked.response_deadline &&
      n.response_deadline.slice(0, 10) !== String(picked.response_deadline).slice(0, 10));
    return picked;
  } catch {
    return null;
  }
}

export async function resolveSamNotice(query: string): Promise<{ notice: ResolvedNotice | null; degraded: boolean }> {
  const q = query.trim();
  if (!q) return { notice: null, degraded: false };
  let degraded = false;
  try {
    const cached = await fromCache(q);
    if (cached) return { notice: cached, degraded: false };
  } catch {
    degraded = true;
  }
  try {
    const live = await fromSamApi(q);
    if (live) return { notice: live, degraded };
  } catch {
    degraded = true;
  }
  try {
    const pub = await fromSamPublic(q);
    if (pub) return { notice: pub, degraded };
  } catch {
    degraded = true;
  }
  return { notice: null, degraded };
}

// Generic-work vocabulary kept ONLY as a small booster (these are common work verbs whose match is
// especially meaningful). The PRIMARY distinctive-work signal is now DERIVED FROM THE TITLE itself
// (see scoreAward) — a hardcoded list can never enumerate every requirement (it missed radios/APX/
// Motorola, so a $77M L3Harris IT IDV out-scored a small BOP radio buy purely on shared NAICS + $).
const GENERIC_WORK_WORDS = new Set([
  'hoof', 'trimming', 'trim', 'farrier', 'veterinary', 'feeding', 'gather',
  'fence', 'fencing', 'roofing', 'painting', 'janitorial', 'custodial',
  'guard', 'security', 'laundry', 'mowing', 'snow', 'hauling', 'transport',
]);
// Words that are NOT distinctive of the WORK — every procurement has them, so a match on one of
// these must NOT clear the "same work" bar (that's exactly how "equipment"/"procurement" let the
// wrong IDV through). Distinctive tokens = the title's real nouns MINUS these.
//
// ⚠️ Includes CUSTOMER / PLACE / AGENCY-CONTEXT tokens (Eric 2026-08-03, variance B): a title like
// "Kitchen Equipment for Missouri National GUARD Facilities" was matched to SIKORSKY's $11.6B
// "National Guard" aircraft IDV — because "national"/"guard"/"facilities" are WHO/WHERE, not the
// work, but they weren't dropped, so a giant award serving the same customer scored as a distinctive
// hit and its size won. Same class: "Carpentry at BROOKHAVEN Laboratory" → the lab operator; "MH-65
// Spare Parts" → an unrelated prime. The buyer/site/context is never the "what was bought" — drop it.
const NONDISTINCTIVE = new Set([
  // generic procurement boilerplate
  'equipment', 'procurement', 'programming', 'program', 'services', 'service', 'supply', 'supplies',
  'system', 'systems', 'support', 'maintenance', 'installation', 'purchase', 'products', 'product',
  'solution', 'solutions', 'requirement', 'requirements', 'contract', 'project', 'various', 'misc',
  'miscellaneous', 'new', 'and', 'for', 'the', 'with', 'parts', 'part', 'spare', 'spares', 'accessories',
  // customer / organization context (WHO buys it — never the work)
  'national', 'guard', 'army', 'navy', 'air', 'force', 'marine', 'marines', 'corps', 'coast',
  'department', 'agency', 'bureau', 'office', 'division', 'command', 'federal', 'government',
  'administration', 'reserve', 'joint', 'defense', 'homeland', 'veterans', 'interior', 'energy',
  // place / site context (WHERE — never the work)
  'facility', 'facilities', 'laboratory', 'laboratories', 'lab', 'labs', 'center', 'centers',
  'base', 'station', 'district', 'region', 'regional', 'installation', 'complex', 'campus', 'site',
  'building', 'buildings', 'plant', 'depot', 'yard', 'field', 'area', 'zone', 'located', 'location',
  // ⚠️ GEOGRAPHY + GOVERNMENT CONTEXT (RC-3, 2026-09-22). These produced BOTH
  // known false positives, and in both cases they were the ONLY matching tokens:
  //   "…East Orange and Lyons" (VA demolition) → AT&T "EAST ORANGE & LYONS NJ
  //     GUEST WIFI" on East/Orange/Lyons.
  //   "…Northeastern United States" (DLA fuel) → Lockheed PAC-3 "...FOR THE
  //     UNITED STATES (US) AND FOREIGN MILITARY SALES" on United/States.
  // A place name says WHERE the work happens, never WHAT is bought — two
  // contracts in the same city are not the same contract.
  'east', 'west', 'north', 'south', 'northeast', 'northwest', 'southeast', 'southwest',
  'northeastern', 'northwestern', 'southeastern', 'southwestern', 'eastern', 'western',
  'northern', 'southern', 'central', 'upper', 'lower', 'united', 'states', 'state',
  'america', 'american', 'usa', 'domestic', 'foreign', 'overseas', 'continental',
  'county', 'city', 'town', 'township', 'village', 'metro', 'metropolitan', 'valley',
  'island', 'islands', 'port', 'harbor', 'river', 'lake', 'mountain', 'park',
]);

/**
 * USASpending `spending_by_award` returns `PSC` as `{ code, description }`, not a
 * string. `String(obj)` is "[object Object]", so pscMatch was structurally FALSE
 * on every live candidate — a real same-PSC predecessor could never earn its PSC
 * evidence, and every candidate looked like a NAICS+PSC dual mismatch.
 */
export function awardPscCode(v: unknown): string {
  if (v && typeof v === 'object') return String((v as { code?: unknown }).code ?? '');
  return v == null ? '' : String(v);
}

export function scoreAwardEvidence(
  row: { Description?: string; 'Recipient Name'?: string; 'Award Amount'?: number; 'Awarding Agency'?: string; 'Awarding Sub Agency'?: string; 'PSC'?: string | { code?: string | null } | null; psc_code?: string },
  titleWords: string[],
  agencyHint: string | null,
  oppPsc?: string | null,
): { score: number; distinctiveHits: number; pscMatch: boolean } {
  const desc = `${row.Description || ''} ${row['Recipient Name'] || ''}`.toLowerCase();
  let score = 0;

  const distinctive = titleWords.filter((w) => w.length >= 3 && !NONDISTINCTIVE.has(w.toLowerCase()));
  const distinctiveHits = distinctive.filter((w) => desc.includes(w.toLowerCase())).length;
  const awardPsc = awardPscCode(row['PSC']) || awardPscCode(row.psc_code);
  const pscMatch = !!(oppPsc && awardPsc && awardPsc.toUpperCase().startsWith(String(oppPsc).toUpperCase().slice(0, 4)));
  if (distinctive.length > 0 && distinctiveHits === 0 && !pscMatch) {
    return { score: 0, distinctiveHits, pscMatch };
  }

  score += distinctiveHits * 30;
  if (distinctiveHits >= 2) score += 25;
  if (distinctiveHits >= 3) score += 15;
  if (pscMatch) score += 45;

  for (const w of titleWords) {
    const lw = w.toLowerCase();
    if (w.length >= 4 && GENERIC_WORK_WORDS.has(lw) && !NONDISTINCTIVE.has(lw) && desc.includes(lw)) score += 20;
  }
  if (agencyHint) {
    const ag = `${row['Awarding Agency'] || ''} ${row['Awarding Sub Agency'] || ''}`.toLowerCase();
    if (agencyHint.toLowerCase().split(/\s+/).some((t) => t.length > 4 && ag.includes(t.toLowerCase()))) {
      score += 15;
    }
    if (/bureau of land management|interior/i.test(ag) && /interior|land management/i.test(agencyHint)) {
      score += 20;
    }
  }
  const amt = Number(row['Award Amount'] || 0);
  score += Math.min(5, Math.log10(Math.max(amt, 1)));
  return { score, distinctiveHits, pscMatch };
}

async function searchUsasPendingAwards(opts: {
  keywords: string[];
  naics?: string | null;
  agencyName?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const now = new Date();
  const start = `${now.getUTCFullYear() - 10}-01-01`;
  const end = `${now.getUTCFullYear()}-12-31`;

  for (const keyword of opts.keywords.slice(0, 4)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filters: any = {
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [{ start_date: start, end_date: end }],
      keywords: [keyword],
    };
    if (opts.naics && /^\d{4,6}$/.test(opts.naics)) {
      filters.naics_codes = [opts.naics.slice(0, 6)];
    }
    // Agency filter is brittle on USASpending (name must match exactly) — score later instead.
    try {
      const res = await fetch(USAS_SEARCH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          fields: [
            'Award ID', 'Recipient Name', 'Award Amount', 'Start Date', 'End Date',
            'Awarding Agency', 'Awarding Sub Agency', 'Description', 'NAICS', 'PSC',
            'generated_internal_id',
          ],
          page: 1,
          limit: 25,
          sort: 'Award Amount',
          order: 'desc',
          subawards: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      for (const r of j.results || []) {
        const id = String(r.generated_internal_id || r['Award ID'] || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(r);
      }
    } catch {
      // next keyword
    }
  }
  return out;
}

/**
 * The shared incumbent/predecessor MATCHER — the single scoring engine behind both
 * the solicitation-number flow (findPriorAwardsForNotice) and the generic
 * opportunity flow (find-predecessor.ts `findPredecessorAward`, which used to have
 * its own weaker copy). Best-matching recent USASpending award by title keywords +
 * agency, relevance-scored (NAICS is soft — a big facility TO in the same NAICS can
 * dwarf the true specialty recompete, so title overlap drives the match).
 */
export async function findLikelyPriorAwards(input: {
  title?: string | null;
  naics_code?: string | null;
  psc_code?: string | null;   // the solicitation's PSC — a same-PSC award is a strong same-product signal
  agency?: string | null;
  department?: string | null;
}): Promise<PriorAwardHit[]> {
  const keywords = titleKeywordCandidates(input.title);
  if (keywords.length === 0 && !input.naics_code) return [];

  const titleWords = (input.title || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()));

  const agencyHint: string | null = toUsaSpendingAgency(input.department) ||
    toUsaSpendingAgency(input.agency) ||
    input.department ||
    input.agency ||
    null;

  const rows = await searchUsasPendingAwards({
    keywords: keywords.length ? keywords : [input.title || ''].filter(Boolean),
    // Prefer keyword-first discovery; NAICS alone over-selects huge facility awards.
    // Apply NAICS only as a soft preference later via scoring, not a hard filter —
    // a 115210 facility TO can dwarf the true specialty recompete.
    naics: null,
    agencyName: agencyHint,
  });

  const ranked = rows
    .map((r) => ({
      row: r,
      evidence: scoreAwardEvidence(r as never, titleWords, agencyHint, input.psc_code ?? null),
    }))
    .filter((x) => x.evidence.score >= 40)
    .sort((a, b) => b.evidence.score - a.evidence.score || Number(b.row['Award Amount'] || 0) - Number(a.row['Award Amount'] || 0))
    .slice(0, 5);

  const hits: PriorAwardHit[] = [];
  for (const { row, evidence } of ranked) {
    const gid = String(row.generated_internal_id || '');
    if (!gid) continue;
    try {
      const detail = await fetchAwardDetail(gid);
      if (!detail) continue;

      let confScore = evidence.score;
      const popEnd = detail.popPotentialEnd || null;
      const yearsSinceEnd = popEnd ? (Date.now() - new Date(popEnd).getTime()) / (365.25 * 86_400_000) : null;
      let recencyCap: 'high' | 'medium' | 'low' | null = null;
      if (yearsSinceEnd !== null && yearsSinceEnd > 0) {
        if (yearsSinceEnd > 8) recencyCap = 'low';
        else if (yearsSinceEnd > 5) recencyCap = 'medium';
      }
      const naicsMatch = !!(input.naics_code && detail.naicsCode && String(detail.naicsCode).slice(0, 6) === String(input.naics_code).slice(0, 6));
      // NAICS is a recorded signal, never a correctness gate. Do not add it to the score
      // that drives "high" — that is how a same-code unrelated IDV used to look grounded.
      let textualConfidence: 'high' | 'medium' | 'low' =
        confScore >= 90 ? 'high' : confScore >= 65 ? 'medium' : 'low';
      if (recencyCap === 'low') textualConfidence = 'low';
      else if (recencyCap === 'medium' && textualConfidence === 'high') textualConfidence = 'medium';
      // 2-digit sector, when BOTH sides are known. A missing code yields null,
      // which means "cannot compare" — never a silent pass.
      const noticeSector = input.naics_code ? String(input.naics_code).slice(0, 2) : null;
      const awardSector = detail.naicsCode ? String(detail.naicsCode).slice(0, 2) : null;
      // Confidence must agree with the structured evidence (sector conflict /
      // no taxonomy agreement) — not just the textual score.
      const { matchConfidence, constraint: confidenceConstraint } = reconcileMatchConfidence(
        textualConfidence,
        { naicsMatch, pscMatch: evidence.pscMatch, noticeSector, awardSector, verifiedIdentity: false },
      );
      const grounding = groundIncumbent({
        distinctiveHits: evidence.distinctiveHits,
        pscMatch: evidence.pscMatch,
        naicsMatch,
        matchConfidence,
        noticeSector,
        awardSector,
        // No verified-identity source exists yet (no named predecessor on the
        // notice, no shared PIID/UEI link). Asserting one here would be exactly
        // the unearned override the guardrail exists to prevent.
        verifiedIdentity: false,
      });
      hits.push({
        ...detail,
        matchConfidence,
        matchScore: evidence.score,
        distinctiveHits: evidence.distinctiveHits,
        pscMatch: evidence.pscMatch,
        naicsMatch,
        noticeSector,
        awardSector,
        confidenceConstraint,
        incumbent_certainty: grounding.certainty,
      });
    } catch {
      // skip
    }
  }
  return hits;
}

/** A ResolvedNotice is a superset of the matcher input — thin pass-through. */
export async function findPriorAwardsForNotice(notice: ResolvedNotice): Promise<PriorAwardHit[]> {
  return findLikelyPriorAwards(notice);
}

export function summarizeSolicitationIncumbent(
  notice: ResolvedNotice | null,
  incumbent: PriorAwardHit | null,
): string | null {
  if (!notice && !incumbent) return null;
  const fmt = (n: number) =>
    n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
  const parts: string[] = [];
  if (notice) {
    const status = notice.status ?? deriveSolicitationStatus({
      active: notice.active ?? null,
      response_deadline: notice.response_deadline,
      archive_date: notice.archive_date ?? null,
    });
    parts.push(
      `${solicitationStatusLabel(status)} ${notice.solicitation_number || notice.notice_id}` +
        (notice.title ? ` — "${notice.title}"` : '') +
        (notice.agency ? ` (${notice.agency})` : '') +
        (notice.response_deadline ? `. Deadline ${notice.response_deadline}` : '') +
        (notice.amendment ? `. ${notice.amendment}` : ''),
    );
  }
  if (incumbent) {
    const label = incumbent.incumbent_certainty === 'supported' ? 'Supported prior award' : 'Uncertain prior-award candidate';
    parts.push(
      `${label}: ${incumbent.recipientName} holds ${incumbent.awardId}` +
        (incumbent.ceiling ? ` at ${fmt(incumbent.ceiling)}` : '') +
        (incumbent.popPotentialEnd ? `, expires ${incumbent.popPotentialEnd}` : '') +
        ` [${incumbent.matchConfidence} confidence` +
        (incumbent.incumbent_certainty === 'supported' ? '' : '; not identified as the incumbent') +
        ']',
    );
  } else if (notice) {
    parts.push('No supported prior award found on USASpending for this notice.');
  }
  return parts.join('. ');
}

/**
 * Main entry: solicitation # or notice UUID → notice + likely incumbent.
 */
export async function resolveSolicitationIncumbent(query: string): Promise<SolicitationIncumbentResult> {
  const q = query.trim();
  const { notice, degraded: noticeDegraded } = await resolveSamNotice(q);
  let prior: PriorAwardHit[] = [];
  let predDegraded = false;
  if (notice) {
    try {
      prior = await findPriorAwardsForNotice(notice);
    } catch (err) {
      predDegraded = true;
      console.error('[solicitation-incumbent] prior-award search failed:', err);
    }
  }
  const incumbent = prior[0] || null;
  const grounding = groundIncumbent(incumbent ? {
    distinctiveHits: incumbent.distinctiveHits ?? 0,
    pscMatch: !!incumbent.pscMatch,
    naicsMatch: !!incumbent.naicsMatch,
    matchConfidence: incumbent.matchConfidence,
    noticeSector: incumbent.noticeSector ?? null,
    awardSector: incumbent.awardSector ?? null,
    verifiedIdentity: false,
  } : null);
  if (incumbent) incumbent.incumbent_certainty = grounding.certainty;
  const named = namedIncumbent(grounding, incumbent);
  return {
    queried: q,
    notice,
    incumbent: named,
    prior_awards: prior,
    summary: summarizeSolicitationIncumbent(notice, named),
    _meta: {
      grounded_notice: !!notice,
      grounded_incumbent: grounding.grounded,
      degraded: noticeDegraded || predDegraded,
      notice_source: notice?.source ?? null,
      status: notice?.status ?? null,
      amendment: notice?.amendment ?? null,
      matched_by: notice?.matched_by ?? null,
      version_count: notice?.version_count,
      deadline_conflict: notice?.deadline_conflict,
      notice_ids: notice?.notice_ids,
      incumbent_certainty: grounding.certainty,
      incumbent_reason: grounding.reason,
    },
  };
}
