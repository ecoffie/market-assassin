/**
 * understand_customer — first Customer Journey transition after specific FIND.
 *
 * Seam A (find_opportunities) is complete. This is UNDERSTAND only:
 *   1. The opportunity says
 *   2. Broader agency research shows
 *   3. What that suggests you emphasize
 *
 * No Capability statement / Response / Meeting brief yet (POSITION/ACT parked).
 * Facts come from SAM cache + getUnifiedAgencyIntelligence — no LLM fabrication.
 */
import { createClient } from '@supabase/supabase-js';
import { getUnifiedAgencyIntelligence } from '@/lib/agency-intelligence';
import { getAgency } from '@/lib/agency-hierarchy/unified-search';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface UnderstandCustomerInput {
  /** SAM notice UUID from find_opportunities open_now.items[].notice_id */
  notice_id?: string | null;
  /** Buying agency — used when notice lacks department, or as research key. */
  agency?: string | null;
}

export interface UnderstandCustomerResult {
  customer: {
    notice_id: string | null;
    solicitation_number: string | null;
    title: string | null;
    agency: string | null;
    sub_agency: string | null;
    sam_url: string | null;
  };
  the_opportunity_says: {
    status: 'grounded' | 'empty' | 'unavailable';
    notice_type: string | null;
    set_aside: string | null;
    naics_code: string | null;
    response_deadline: string | null;
    excerpts: string[];
    stated_focus: string[];
    note: string | null;
  };
  broader_agency_research_shows: {
    status: 'grounded' | 'empty' | 'unavailable';
    agency_name: string | null;
    pain_points: string[];
    priorities: string[];
    gao_reports: string[];
    spending_patterns: string[];
    sources: string[];
    note: string | null;
  };
  what_that_suggests_you_emphasize: {
    status: 'grounded' | 'empty' | 'unavailable';
    bullets: string[];
    method: string;
    note: string | null;
  };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    has_opportunity: boolean;
    has_agency_research: boolean;
    journey: 'understand';
    next_outputs_not_yet: ['capability_statement', 'response', 'meeting_brief'];
  };
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'shall', 'will', 'must',
  'have', 'been', 'been', 'services', 'service', 'support', 'contract', 'contracts',
  'government', 'federal', 'department', 'agency', 'office', 'program', 'provide',
  'including', 'related', 'other', 'such', 'their', 'them', 'into', 'onto', 'over',
  'under', 'about', 'after', 'before', 'between', 'through', 'during', 'without',
  'within', 'where', 'when', 'which', 'while', 'would', 'could', 'should', 'being',
  'been', 'were', 'was', 'are', 'is', 'a', 'an', 'of', 'to', 'in', 'on', 'or', 'as',
  'by', 'at', 'it', 'its', 'not', 'no', 'all', 'any', 'per', 'via',
]);

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []) {
    if (STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function excerptPlain(text: string | null | undefined, maxChars = 420): string[] {
  if (!text || !String(text).trim()) return [];
  // Skip SAM noticedesc link stubs — not body text.
  const t = String(text).trim();
  if (/^https?:\/\//i.test(t) && t.length < 200) return [];
  const cleaned = t.replace(/\s+/g, ' ').slice(0, 4000);
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40);
  const picks: string[] = [];
  let used = 0;
  for (const s of sentences.length ? sentences : [cleaned]) {
    if (used >= maxChars) break;
    const piece = s.slice(0, Math.min(280, maxChars - used)).trim();
    if (piece.length < 24) continue;
    picks.push(piece);
    used += piece.length;
    if (picks.length >= 3) break;
  }
  return picks;
}

/** Light theme tags from title + body — grounded tokens only, not invented claims. */
export function statedFocusFromText(title: string | null, body: string | null): string[] {
  const tokens = [...tokenize(`${title || ''} ${body || ''}`)];
  // Prefer longer / rarer-looking tokens from the title first.
  const titleToks = [...tokenize(title || '')];
  const ranked = [
    ...titleToks,
    ...tokens.filter((t) => !titleToks.includes(t)),
  ].filter((t) => t.length >= 4);
  const uniq: string[] = [];
  for (const t of ranked) {
    if (uniq.includes(t)) continue;
    uniq.push(t);
    if (uniq.length >= 8) break;
  }
  return uniq;
}

/**
 * Emphasize = agency research lines that share meaningful tokens with the opportunity text.
 * Deterministic overlap — never LLM. Empty overlap is an honest empty, not a fabricated pitch.
 */
export function buildEmphasizeBullets(opts: {
  opportunityText: string;
  painPoints: string[];
  priorities: string[];
  max?: number;
}): string[] {
  const oppToks = tokenize(opts.opportunityText);
  if (oppToks.size === 0) return [];

  type Cand = { text: string; kind: 'pain_point' | 'priority'; score: number; hits: string[] };
  const cands: Cand[] = [];

  const scoreLine = (text: string, kind: Cand['kind']) => {
    const lineToks = [...tokenize(text)];
    const hits = lineToks.filter((t) => oppToks.has(t));
    if (hits.length === 0) return;
    // Prefer multi-token overlap and longer shared terms.
    const score = hits.reduce((s, h) => s + Math.min(h.length, 12), 0) + hits.length * 3;
    cands.push({ text, kind, score, hits: hits.slice(0, 4) });
  };

  for (const p of opts.painPoints) scoreLine(p, 'pain_point');
  for (const p of opts.priorities) scoreLine(p, 'priority');

  cands.sort((a, b) => b.score - a.score);
  const max = opts.max ?? 5;
  const out: string[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    const label = c.kind === 'pain_point' ? 'Agency pain point' : 'Agency priority';
    const hitLabel = c.hits.join(', ');
    out.push(
      `${label} overlaps this notice (${hitLabel}): ${c.text.slice(0, 220)}${c.text.length > 220 ? '…' : ''}`,
    );
  }
  return out;
}

type NoticeRow = {
  notice_id: string;
  solicitation_number: string | null;
  title: string | null;
  description: string | null;
  sow_text: string | null;
  department: string | null;
  sub_tier: string | null;
  naics_code: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  notice_type: string | null;
  response_deadline: string | null;
  ui_link: string | null;
};

async function loadNotice(noticeId: string): Promise<{ row: NoticeRow | null; degraded: boolean }> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { row: null, degraded: true };
  }
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from('sam_opportunities')
    .select(
      'notice_id, solicitation_number, title, description, sow_text, department, sub_tier, naics_code, set_aside_code, set_aside_description, notice_type, response_deadline, ui_link',
    )
    .eq('notice_id', noticeId)
    .maybeSingle();
  if (error) {
    console.error('[understand_customer] notice load failed:', error.message);
    return { row: null, degraded: true };
  }
  return { row: (data as NoticeRow | null) ?? null, degraded: false };
}

export async function understandCustomer(
  input: UnderstandCustomerInput,
): Promise<UnderstandCustomerResult> {
  const noticeId = String(input.notice_id || '').trim() || null;
  const agencyHint = String(input.agency || '').trim() || null;

  let degraded = false;
  let notice: NoticeRow | null = null;

  if (noticeId) {
    const loaded = await loadNotice(noticeId);
    notice = loaded.row;
    if (loaded.degraded) degraded = true;
  }

  const agencyNameRaw =
    agencyHint ||
    (notice?.department ? String(notice.department) : null) ||
    (notice?.sub_tier ? String(notice.sub_tier) : null);
  // SAM often stores "DEPT OF DEFENSE"; static intel keys use "Department of Defense".
  const agencyName = agencyNameRaw
    ? agencyNameRaw.replace(/^DEPT\.?\s+OF\s+/i, 'Department of ')
    : null;

  const bodyText = [notice?.description, notice?.sow_text].filter(Boolean).join('\n\n') || null;
  const excerpts = excerptPlain(bodyText);
  const stated_focus = statedFocusFromText(notice?.title ?? null, bodyText);

  const opportunitySays: UnderstandCustomerResult['the_opportunity_says'] = notice
    ? {
        status: 'grounded',
        notice_type: notice.notice_type,
        set_aside: notice.set_aside_description || notice.set_aside_code,
        naics_code: notice.naics_code,
        response_deadline: notice.response_deadline,
        excerpts,
        stated_focus,
        note:
          excerpts.length === 0
            ? 'Notice metadata is grounded; full body text was empty or only a SAM description link — stated_focus is from the title.'
            : null,
      }
    : {
        status: noticeId ? (degraded ? 'unavailable' : 'empty') : 'empty',
        notice_type: null,
        set_aside: null,
        naics_code: null,
        response_deadline: null,
        excerpts: [],
        stated_focus: [],
        note: noticeId
          ? degraded
            ? 'Could not read sam_opportunities for this notice_id.'
            : `No SAM notice matched notice_id "${noticeId}".`
          : 'Pass notice_id from find_opportunities (open_now item) so “the opportunity says” can be grounded.',
      };

  let agencyBlock: UnderstandCustomerResult['broader_agency_research_shows'] = {
    status: 'empty',
    agency_name: null,
    pain_points: [],
    priorities: [],
    gao_reports: [],
    spending_patterns: [],
    sources: [],
    note: agencyName
      ? null
      : 'No agency on the notice or input — broader research cannot run without a buyer name.',
  };

  if (agencyName) {
    try {
      // SAM department strings like "DEPT OF DEFENSE" miss the static JSON exact key.
      // Resolve canonical name via getAgency, then fall back to normalizeAgencyKey.
      let researchKey = agencyName;
      try {
        const resolved = await getAgency(agencyName);
        if (resolved?.name) researchKey = resolved.name;
      } catch {
        /* keep agencyName */
      }
      const key = normalizeAgencyKey(researchKey) || researchKey;
      const intel =
        (await getUnifiedAgencyIntelligence(researchKey)) ||
        (key !== researchKey ? await getUnifiedAgencyIntelligence(key) : null);
      if (intel && (intel.painPoints.length || intel.priorities.length || intel.gaoReports.length)) {
        agencyBlock = {
          status: 'grounded',
          agency_name: intel.agencyName || researchKey || agencyName,
          pain_points: (intel.painPoints || []).slice(0, 8),
          priorities: (intel.priorities || []).slice(0, 8),
          gao_reports: (intel.gaoReports || []).slice(0, 5),
          spending_patterns: (intel.spendingPatterns || []).slice(0, 5),
          sources: intel.sources || [],
          note: 'Curated agency intel (static + agency_intelligence DB). Not an official agency statement.',
        };
      } else {
        agencyBlock = {
          status: 'empty',
          agency_name: researchKey || agencyName,
          pain_points: [],
          priorities: [],
          gao_reports: [],
          spending_patterns: [],
          sources: [],
          note: `No pain points / priorities / GAO rows on file for "${researchKey || agencyName}".`,
        };
      }
    } catch (err) {
      degraded = true;
      console.error('[understand_customer] agency research failed:', err);
      agencyBlock = {
        status: 'unavailable',
        agency_name: agencyName,
        pain_points: [],
        priorities: [],
        gao_reports: [],
        spending_patterns: [],
        sources: [],
        note: 'Agency research errored — retry; do not invent pain points.',
      };
    }
  }

  const oppCorpus = [notice?.title, bodyText, ...(stated_focus || [])].filter(Boolean).join(' ');
  const bullets = buildEmphasizeBullets({
    opportunityText: oppCorpus,
    painPoints: agencyBlock.pain_points,
    priorities: agencyBlock.priorities,
  });

  const emphasize: UnderstandCustomerResult['what_that_suggests_you_emphasize'] =
    opportunitySays.status === 'grounded' && agencyBlock.status === 'grounded'
      ? bullets.length
        ? {
            status: 'grounded',
            bullets,
            method: 'token_overlap_opportunity_vs_agency_research',
            note: 'Only lines that share wording with this notice. Do not invent messaging beyond these overlaps.',
          }
        : {
            status: 'empty',
            bullets: [],
            method: 'token_overlap_opportunity_vs_agency_research',
            note:
              'Agency research is on file, but no clear wording overlap with this notice. Lead with the opportunity’s stated requirements; do not invent a pitch from agency research alone.',
          }
      : {
          status:
            opportunitySays.status === 'unavailable' || agencyBlock.status === 'unavailable'
              ? 'unavailable'
              : 'empty',
          bullets: [],
          method: 'token_overlap_opportunity_vs_agency_research',
          note: 'Need both a grounded opportunity and grounded agency research before emphasize bullets can fire.',
        };

  const has_opportunity = opportunitySays.status === 'grounded';
  const has_agency_research = agencyBlock.status === 'grounded';
  const grounded = has_opportunity || has_agency_research;

  return {
    customer: {
      notice_id: notice?.notice_id ?? noticeId,
      solicitation_number: notice?.solicitation_number ?? null,
      title: notice?.title ?? null,
      agency: agencyBlock.agency_name || agencyName,
      sub_agency: notice?.sub_tier ?? null,
      sam_url: notice?.ui_link ?? (notice?.notice_id ? `https://sam.gov/opp/${notice.notice_id}/view` : null),
    },
    the_opportunity_says: opportunitySays,
    broader_agency_research_shows: agencyBlock,
    what_that_suggests_you_emphasize: emphasize,
    _meta: {
      grounded,
      degraded,
      has_opportunity,
      has_agency_research,
      journey: 'understand',
      next_outputs_not_yet: ['capability_statement', 'response', 'meeting_brief'],
    },
  };
}
