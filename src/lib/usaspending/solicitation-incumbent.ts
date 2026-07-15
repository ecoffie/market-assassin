/**
 * Resolve an OPEN SAM solicitation (by sol # or notice UUID) and find the
 * LIKELY prior award (incumbent + $) behind it.
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
import { createClient } from '@supabase/supabase-js';
import { fetchAwardDetail, type AwardDetail } from '@/lib/usaspending/award-detail';

const SAM_SEARCH = 'https://api.sam.gov/opportunities/v2/search';
const SAM_PUBLIC = 'https://sam.gov/api/prod/sgs/v1/search/';
const USAS_SEARCH = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'services', 'service', 'contract', 'solicitation', 'combined', 'synopsis',
  'base', 'year', 'years', 'yea', 'option', 'options', 'period', 'periods', 'plus',
  'requirement', 'requirements', 'purchase', 'support', 'program',
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
}

export interface PriorAwardHit extends AwardDetail {
  matchConfidence: 'high' | 'medium' | 'low';
  matchScore: number;
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
  };
}

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function isUuid(s: string): boolean {
  return /^[a-f0-9]{32}$/i.test(s.trim()) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s.trim());
}

function normalizeUuid(s: string): string {
  const t = s.trim().replace(/-/g, '').toLowerCase();
  return t.length === 32 ? t : s.trim();
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

  // Site/vehicle noise that often appears in BOTH facility and specialty awards —
  // prefer work-centered phrases so "WHEATLAND HOOF TRIMMING" beats "WHEATLAND ORC".
  const SITE_NOISE = new Set(['orc', 'orcs', 'facility', 'facilities', 'complex', 'region', 'district']);
  const workish = words.filter((w) => !SITE_NOISE.has(w.toLowerCase()));

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
  const sb = supabase();
  if (!sb) return null;
  const trimmed = q.trim();
  const uuid = isUuid(trimmed) ? normalizeUuid(trimmed) : null;

  // Exact sol # first
  let { data } = await sb
    .from('sam_opportunities')
    .select('notice_id,solicitation_number,title,department,sub_tier,naics_code,psc_code,set_aside_description,notice_type,posted_date,response_deadline,ui_link')
    .eq('solicitation_number', trimmed)
    .limit(1);
  if (!data?.length && uuid) {
    ({ data } = await sb
      .from('sam_opportunities')
      .select('notice_id,solicitation_number,title,department,sub_tier,naics_code,psc_code,set_aside_description,notice_type,posted_date,response_deadline,ui_link')
      .eq('notice_id', uuid)
      .limit(1));
  }
  if (!data?.length) {
    ({ data } = await sb
      .from('sam_opportunities')
      .select('notice_id,solicitation_number,title,department,sub_tier,naics_code,psc_code,set_aside_description,notice_type,posted_date,response_deadline,ui_link')
      .ilike('solicitation_number', `%${trimmed}%`)
      .limit(1));
  }
  const row = data?.[0] as Record<string, string | null> | undefined;
  if (!row?.notice_id) return null;
  return {
    notice_id: String(row.notice_id),
    solicitation_number: row.solicitation_number,
    title: row.title,
    agency: row.sub_tier || row.department,
    department: row.department,
    naics_code: row.naics_code,
    psc_code: row.psc_code,
    set_aside: row.set_aside_description,
    notice_type: row.notice_type,
    posted_date: row.posted_date,
    response_deadline: row.response_deadline,
    ui_link: row.ui_link || `https://sam.gov/opp/${row.notice_id}/view`,
    source: 'cache',
  };
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
  params.push({ param: 'solnum', value: trimmed });

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
        const opp = (j.opportunitiesData || [])[0];
        if (!opp) continue;
        const noticeId = String(opp.noticeId || opp.noticeid || '').replace(/-/g, '');
        if (!noticeId) continue;
        const fullParent = opp.fullParentPathName || '';
        const orgParts = String(fullParent).split('.').map((s: string) => s.trim()).filter(Boolean);
        return {
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
          response_deadline: opp.responseDeadLine || opp.responseDate || null,
          ui_link: opp.uiLink || `https://sam.gov/opp/${noticeId}/view`,
          source: 'sam_api',
        };
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
      headers: { 'User-Agent': 'Mindy-GovConGiants (hello@govcongiants.com)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const results = j?._embedded?.results || [];
    const want = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const opp = results.find((r: { solicitationNumber?: string; _id?: string }) => {
      const sol = String(r.solicitationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const id = String(r._id || '').replace(/-/g, '').toLowerCase();
      return sol === want || id === want.toLowerCase() || sol.includes(want);
    }) || results[0];
    if (!opp) return null;
    const noticeId = String(opp._id || '').replace(/-/g, '');
    if (!noticeId) return null;
    const orgNames = (opp.organizationHierarchy || [])
      .map((o: { name?: string; organizationName?: string }) => o.name || o.organizationName)
      .filter(Boolean);
    const naics = Array.isArray(opp.naics) ? opp.naics[0]?.code : opp.naics?.code;
    const psc = Array.isArray(opp.psc) ? opp.psc[0]?.code : null;
    return {
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
      response_deadline: opp.responseDate || opp.responseDateActual || null,
      ui_link: `https://sam.gov/opp/${noticeId}/view`,
      source: 'sam_public',
    };
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

function scoreAward(
  row: { Description?: string; 'Recipient Name'?: string; 'Award Amount'?: number; 'Awarding Agency'?: string; 'Awarding Sub Agency'?: string },
  titleWords: string[],
  agencyHint: string | null,
): number {
  const desc = `${row.Description || ''} ${row['Recipient Name'] || ''}`.toLowerCase();
  let score = 0;

  // Work-distinctive tokens in the title (vs place/site noise like ORC, WHEATLAND)
  // must appear on the prior award or we heavily discount — prevents $6M facility
  // contracts from beating a $600K hoof-trimming recompete.
  const WORK_WORDS = new Set([
    'hoof', 'trimming', 'trim', 'farrier', 'veterinary', 'feeding', 'gather',
    'fence', 'fencing', 'roofing', 'painting', 'janitorial', 'custodial',
    'guard', 'security', 'laundry', 'mowing', 'snow', 'hauling', 'transport',
  ]);
  const workWords = titleWords.filter((w) => WORK_WORDS.has(w.toLowerCase()));
  if (workWords.length > 0) {
    const workHits = workWords.filter((w) => desc.includes(w.toLowerCase())).length;
    if (workHits === 0) return 0; // hard miss — not the same work
    score += 50 + workHits * 30;
  }

  for (const w of titleWords) {
    if (w.length >= 4 && desc.includes(w.toLowerCase())) {
      score += WORK_WORDS.has(w.toLowerCase()) ? 35 : 12;
    }
  }
  const hits = titleWords.filter((w) => w.length >= 4 && desc.includes(w.toLowerCase())).length;
  if (hits >= 2) score += 25;
  if (hits >= 3) score += 15;
  if (agencyHint) {
    const ag = `${row['Awarding Agency'] || ''} ${row['Awarding Sub Agency'] || ''}`.toLowerCase();
    if (agencyHint.toLowerCase().split(/\s+/).some((t) => t.length > 4 && ag.includes(t.toLowerCase()))) {
      score += 15;
    }
    if (/bureau of land management|interior/i.test(ag) && /interior|land management/i.test(agencyHint)) {
      score += 20;
    }
  }
  // Tiny amount signal only — never let a huge unrelated facility contract win
  const amt = Number(row['Award Amount'] || 0);
  score += Math.min(5, Math.log10(Math.max(amt, 1)));
  return score;
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

export async function findPriorAwardsForNotice(notice: ResolvedNotice): Promise<PriorAwardHit[]> {
  const keywords = titleKeywordCandidates(notice.title);
  if (keywords.length === 0 && !notice.naics_code) return [];

  const titleWords = (notice.title || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()));

  const agencyHint = toUsaSpendingAgency(notice.department) ||
    toUsaSpendingAgency(notice.agency) ||
    notice.department ||
    notice.agency;

  const rows = await searchUsasPendingAwards({
    keywords: keywords.length ? keywords : [notice.title || ''].filter(Boolean),
    // Prefer keyword-first discovery; NAICS alone over-selects huge facility awards.
    // Apply NAICS only as a soft preference later via scoring, not a hard filter —
    // a 115210 facility TO can dwarf the true specialty recompete.
    naics: null,
    agencyName: agencyHint,
  });

  const ranked = rows
    .map((r) => ({
      row: r,
      score: scoreAward(r as never, titleWords, agencyHint),
    }))
    .filter((x) => x.score >= 40) // require real title overlap — avoids random largest NAICS award
    .sort((a, b) => b.score - a.score || Number(b.row['Award Amount'] || 0) - Number(a.row['Award Amount'] || 0))
    .slice(0, 5);

  const hits: PriorAwardHit[] = [];
  for (const { row, score } of ranked) {
    const gid = String(row.generated_internal_id || '');
    if (!gid) continue;
    try {
      const detail = await fetchAwardDetail(gid);
      if (!detail) continue;
      const matchConfidence: 'high' | 'medium' | 'low' =
        score >= 90 ? 'high' : score >= 65 ? 'medium' : 'low';
      hits.push({
        ...detail,
        matchConfidence,
        matchScore: score,
      });
    } catch {
      // skip
    }
  }
  return hits;
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
    parts.push(
      `Open solicitation ${notice.solicitation_number || notice.notice_id}` +
        (notice.title ? ` — "${notice.title}"` : '') +
        (notice.agency ? ` (${notice.agency})` : ''),
    );
  }
  if (incumbent) {
    parts.push(
      `Likely prior award: ${incumbent.recipientName} holds ${incumbent.awardId}` +
        (incumbent.ceiling ? ` at ${fmt(incumbent.ceiling)}` : '') +
        (incumbent.popPotentialEnd ? `, expires ${incumbent.popPotentialEnd}` : '') +
        ` [${incumbent.matchConfidence} confidence]`,
    );
  } else if (notice) {
    parts.push('No clear prior award found on USASpending for this notice.');
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
  return {
    queried: q,
    notice,
    incumbent,
    prior_awards: prior,
    summary: summarizeSolicitationIncumbent(notice, incumbent),
    _meta: {
      grounded_notice: !!notice,
      grounded_incumbent: !!incumbent,
      degraded: noticeDegraded || predDegraded,
      notice_source: notice?.source ?? null,
    },
  };
}
