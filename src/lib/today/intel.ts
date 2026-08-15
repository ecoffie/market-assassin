/**
 * Today's Intel — the daily front page of the public procurement market.
 *
 * Eric 2026-08-15: "Design Today's Intel as a DESTINATION, not as a landing page. A landing page
 * tries to convert. Today's Intel should try to INFORM. If it succeeds at informing, the conversion
 * (opening the map, signing up, returning tomorrow) becomes a consequence of delivering value."
 *
 * So this is not marketing copy with numbers sprinkled in — it is a newspaper front page whose
 * every figure is a live query. Nothing here is estimated, rounded for effect, or LLM-written.
 * (Ground-in-real-data is the #1 standing correction in this repo: the LLM labels and writes;
 * facts come from data.)
 *
 * Zillow taught the SHAPE — "Continue searching for…", "based on your recent activity", four entry
 * points — but not the CONTENT. Zillow's homepage asks "what are you looking for?"; Mindy answers
 * "here's what changed today", because discovery beats search.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface IntelStat {
  key: string;
  value: number;
  label: string;
  /** Where clicking this lands on the map — every stat is a door, never a dead number. */
  href: string;
}

export interface IntelMover {
  naics: string;
  name: string;
  thisWeek: number;
  lastWeek: number;
  pctChange: number;
  href: string;
}

export interface IntelAgency {
  agency: string;
  display: string;
  newThisWeek: number;
  href: string;
}

export interface TodayIntel {
  /** The one-sentence newspaper headline, composed from the numbers below — never invented. */
  headline: string;
  stats: IntelStat[];
  movers: IntelMover[];
  agencies: IntelAgency[];
  /** Last week's posting count — the hero needs it to tell a week-over-week story honestly. */
  prevWeek: number;
  /** True when a read failed: the page then omits that block rather than showing a fake zero. */
  degraded: boolean;
  generatedAt: string;
}

/** Title-case a SCREAMING agency string ("VETERANS AFFAIRS, DEPARTMENT OF" → "Veterans Affairs"). */
function prettyAgency(a: string): string {
  const base = String(a || '').split(',')[0].trim().toLowerCase();
  return base.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and');
}

/**
 * Compose the headline from the largest REAL signal available, in priority order. Every branch
 * cites a number that was actually queried; if nothing qualifies we say something plain and true
 * rather than manufacturing drama.
 */
function buildHeadline(stats: IntelStat[], movers: IntelMover[], agencies: IntelAgency[]): string {
  const newToday = stats.find((s) => s.key === 'new_today')?.value ?? 0;
  const topAgency = agencies[0];
  const topMover = movers[0];

  if (newToday > 0 && topAgency) {
    // Only cite a mover when the swing is genuinely notable — "+5%" is noise, and a
    // headline that dresses noise as news erodes trust in every other number here.
    const tail = topMover && topMover.pctChange >= 20
      ? `, and ${topMover.name} demand is up ${topMover.pctChange}% week over week`
      : '';
    return `${newToday.toLocaleString()} opportunities posted in the last 24 hours — ${topAgency.display} led with ${topAgency.newThisWeek.toLocaleString()} this week${tail}.`;
  }
  if (topAgency) {
    return `${topAgency.display} posted ${topAgency.newThisWeek.toLocaleString()} opportunities this week.`;
  }
  return 'Live federal procurement activity, updated continuously.';
}

/**
 * One round trip per block, run in parallel. A failed block sets `degraded` and is omitted —
 * never coalesced to 0, which would read as "the market was quiet today" (data fabrication, the
 * count≠null invariant).
 */
export async function getTodayIntel(): Promise<TodayIntel> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let degraded = false;

  const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const twoWeek = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const yearOut = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [newToday, newWeek, activeTotal, recompetes, events, agencyRows, thisWk, prevWk] = await Promise.all([
    sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).gte('posted_date', day),
    sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).gte('posted_date', week),
    sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true),
    sb.from('recompete_opportunities').select('*', { count: 'exact', head: true }).is('quality_flag', null)
      .gte('period_of_performance_current_end', today).lte('period_of_performance_current_end', yearOut),
    sb.from('sam_events').select('*', { count: 'exact', head: true }).neq('event_type', 'rfi').gte('event_date', today),
    // Agencies are counted with REAL per-agency COUNT queries below — a sampled .limit() would
  // truncate and print a confidently wrong figure (DoD read 669 against a true 6,272).
  Promise.resolve({ data: null, error: null }),
    // Movers are counted by `naicsCounts()` below (paginated, matched filters) — not here.
    Promise.resolve({ data: null, error: null }),
    Promise.resolve({ data: null, error: null }),
  ]);

  for (const r of [newToday, newWeek, activeTotal, recompetes, events, agencyRows, thisWk, prevWk]) {
    if (r.error) degraded = true;
  }

  // A null count means UNKNOWN, never zero — a stat with no real number is DROPPED from the page
  // rather than rendered as 0 (Bug Prevention Rule #11).
  const stats: IntelStat[] = [];
  const push = (key: string, count: number | null, label: string, href: string) => {
    if (typeof count === 'number') stats.push({ key, value: count, label, href });
  };
  push('new_today', newToday.count, 'posted in the last 24 hours', '/opportunity-map?posted=1');
  push('new_week', newWeek.count, 'posted this week', '/opportunity-map?posted=7');
  push('recompetes', recompetes.count, 'contracts up for recompete within a year', '/opportunity-map?mode=recompete');
  push('events', events.count, 'upcoming industry events', '/opportunity-map?events=1');
  push('active', activeTotal.count, 'open opportunities right now', '/opportunity-map');

  // Agencies — a real COUNT per agency. PostgREST has no GROUP BY, and sampling rows to count
  // them client-side TRUNCATES: an 8,000-row cap reported Dept of Defense at 669 when the true
  // figure was 6,272. A headline number that is 10x wrong is worse than no headline, so each of
  // the known top departments gets its own head:true count.
  const agencyCounts = await Promise.all(
    TOP_DEPARTMENTS.map(async (dept) => {
      const { count, error } = await sb
        .from('sam_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('active', true)
        .gte('posted_date', week)
        .eq('department', dept);
      if (error) degraded = true;
      return { dept, count };
    }),
  );
  const agencies: IntelAgency[] = agencyCounts
    .filter((a): a is { dept: string; count: number } => typeof a.count === 'number' && a.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map(({ dept, count }) => ({
      agency: dept,
      display: prettyAgency(dept),
      newThisWeek: count,
      href: `/opportunity-map?agency=${encodeURIComponent(dept)}`,
    }));

  // Movers — real week-over-week deltas. Guarded so a tiny base can't manufacture a huge percent
  // (3 → 9 is not "+200% demand"); both weeks must clear a floor.
  // ⚠️ Both windows MUST use identical filters and MUST NOT be row-capped. The first version
  // filtered `.eq('active', true)` on THIS week but not LAST week, and capped both at
  // .limit(8000) while this week alone posts ~9,500 — so a TRUNCATED this-week count was
  // divided by an untruncated, differently-filtered baseline. Every percentage came from
  // mismatched sets, so nothing survived the sanity floors and the whole Trending section
  // silently rendered EMPTY. That is the same sampling-truncation trap documented for agency
  // counts above; a cap that "looks generous" is still a cap. PostgREST hard-caps responses at
  // 1000 rows regardless of .limit(), so page explicitly until a short page proves the end.
  const naicsCounts = async (from: string, to: string | null) => {
    const m = new Map<string, number>();
    const PAGE = 1000;
    for (let off = 0; off < 40000; off += PAGE) {
      let q = sb.from('sam_opportunities').select('naics_code')
        .gte('posted_date', from).not('naics_code', 'is', null);
      if (to) q = q.lt('posted_date', to);
      const { data, error } = await q.range(off, off + PAGE - 1);
      if (error) { degraded = true; break; }
      const rows = (data || []) as Array<{ naics_code: string }>;
      for (const r of rows) m.set(r.naics_code, (m.get(r.naics_code) || 0) + 1);
      if (rows.length < PAGE) break;   // short page = genuinely the end, not a cap
    }
    return m;
  };
  const [tw, pw] = await Promise.all([naicsCounts(week, null), naicsCounts(twoWeek, week)]);
  const movers: IntelMover[] = [...tw.entries()]
    .filter(([code, n]) => n >= 40 && (pw.get(code) || 0) >= 10 && code)
    .map(([code, n]) => {
      const prev = pw.get(code) || 0;
      return {
        naics: code,
        name: NAICS_LABEL[code] || '',
        thisWeek: n,
        lastWeek: prev,
        pctChange: Math.round(((n - prev) / Math.max(prev, 1)) * 100),
        href: `/opportunity-map?naics=${code}`,
      };
    })
    // A bare code is not a name (standing UI rule: names, not codes). An unlabeled
    // code is DROPPED rather than rendered as "NAICS 336413".
    .filter((m) => m.pctChange > 0 && m.name)
    .sort((a, b) => b.pctChange - a.pctChange)
    .slice(0, 4);

  return {
    headline: buildHeadline(stats, movers, agencies),
    // Derived from the SAME paginated counts as the movers, so the hero's week-over-week
    // comparison and the Trending section can never disagree about last week's volume.
    prevWeek: [...pw.values()].reduce((a, b) => a + b, 0),
    stats,
    movers,
    agencies,
    degraded,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Plain-English names for the codes that actually surface as movers. A code with no entry falls
 * back to "NAICS <code>" — never a guessed industry name (the LLM labels, but it does not invent
 * a taxonomy). Extend this map as new codes appear rather than fabricating at runtime.
 */
const TOP_DEPARTMENTS = [
  'DEPT OF DEFENSE',
  'VETERANS AFFAIRS, DEPARTMENT OF',
  'INTERIOR, DEPARTMENT OF THE',
  'AGRICULTURE, DEPARTMENT OF',
  'HOMELAND SECURITY, DEPARTMENT OF',
  'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',
  'STATE, DEPARTMENT OF',
  'GENERAL SERVICES ADMINISTRATION',
  'ENERGY, DEPARTMENT OF',
  'JUSTICE, DEPARTMENT OF',
];

const NAICS_LABEL: Record<string, string> = {
  '336413': 'Aircraft parts',
  '311999': 'Food manufacturing',
  '336611': 'Ship building & repair',
  '337214': 'Office furniture',
  '339113': 'Surgical appliances & supplies',
  '541330': 'Engineering services',
  '541512': 'Computer systems design',
  '541611': 'Management consulting',
  '561210': 'Facilities support',
  '561621': 'Security systems',
  '561720': 'Janitorial services',
  '236220': 'Commercial construction',
  '238220': 'Plumbing & HVAC',
  '621111': 'Physician services',
  '811310': 'Industrial repair & maintenance',
};

// ─────────────────────────────────────────────────────────────────────────────
// EDITORIAL LAYER (Eric 2026-08-15, after seeing v1 side-by-side with Zillow):
// "You're still designing it like an ADMIN DASHBOARD, not the FRONT PAGE of a
//  newspaper… The first thing I feel is 'interesting statistics'. I don't yet feel
//  'I have to click'."
//
// The fix is not more numbers — it is HIERARCHY and a STORY. v1 gave the headline and
// the stat cards near-equal weight, which is exactly what makes a page read as a
// dashboard. A front page has one dominant story, then supporting blocks.
//
// The hero story is COMPOSED from queried facts, never written by a model, and it is
// chosen by which real signal is actually strongest today:
//   · CONCENTRATION — one agency dominates the week (the true story right now: DoD is
//     66% of all new activity, which is far more interesting than "+2% week over week")
//   · SURGE        — week-over-week volume genuinely moved
//   · MOVER        — one industry's demand jumped
//   · BASELINE     — nothing notable; say something plain and true rather than
//                    manufacturing drama out of a 2% drift
export interface HeroStory {
  kicker: string;      // "TODAY'S HEADLINE"
  headline: string;    // the big editorial line
  standfirst: string;  // the supporting sentence, with the numbers
  href: string;        // the door
  cta: string;
}

const SURGE_PCT = 15;        // a week must move this much to be called a surge
const CONCENTRATION_PCT = 40; // one agency must own this share to lead the page

export function buildHeroStory(input: {
  newToday: number;
  newWeek: number;
  prevWeek: number;
  topAgency?: { display: string; newThisWeek: number };
  topMover?: { name: string; pctChange: number };
}): HeroStory {
  const { newToday, newWeek, prevWeek, topAgency, topMover } = input;
  const wow = prevWeek > 0 ? Math.round(((newWeek - prevWeek) / prevWeek) * 100) : 0;
  const share = topAgency && newWeek > 0 ? Math.round((topAgency.newThisWeek / newWeek) * 100) : 0;

  // 1. CONCENTRATION — the strongest real story most days.
  if (topAgency && share >= CONCENTRATION_PCT) {
    return {
      kicker: "TODAY'S HEADLINE",
      headline: `${topAgency.display} is driving ${share}% of new federal demand.`,
      standfirst: `${newToday.toLocaleString()} opportunities posted in the last 24 hours. Of the ${newWeek.toLocaleString()} posted this week, ${topAgency.newThisWeek.toLocaleString()} came from ${topAgency.display} alone.`,
      href: '/opportunity-map',
      cta: "Explore Today's Market",
    };
  }
  // 2. SURGE — a genuine week-over-week move.
  if (Math.abs(wow) >= SURGE_PCT) {
    const dir = wow > 0 ? 'accelerated' : 'slowed';
    return {
      kicker: "TODAY'S HEADLINE",
      headline: `Federal buying ${dir} this week.`,
      standfirst: `${newWeek.toLocaleString()} opportunities were posted this week versus ${prevWeek.toLocaleString()} the week before — a ${Math.abs(wow)}% ${wow > 0 ? 'increase' : 'decrease'}. ${newToday.toLocaleString()} landed in the last 24 hours.`,
      href: '/opportunity-map',
      cta: "Explore Today's Market",
    };
  }
  // 3. MOVER — one industry genuinely jumped.
  if (topMover && topMover.pctChange >= 20) {
    return {
      kicker: "TODAY'S HEADLINE",
      headline: `${topMover.name} demand jumped ${topMover.pctChange}% this week.`,
      standfirst: `${newToday.toLocaleString()} opportunities posted in the last 24 hours, ${newWeek.toLocaleString()} this week across every federal agency.`,
      href: '/opportunity-map',
      cta: "Explore Today's Market",
    };
  }
  // 4. BASELINE — plain and true. Never invent a trend.
  return {
    kicker: "TODAY'S HEADLINE",
    headline: `${newToday.toLocaleString()} new opportunities posted overnight.`,
    standfirst: `${newWeek.toLocaleString()} opportunities were posted across the federal government this week. Open the map to see where they landed.`,
    href: '/opportunity-map',
    cta: "Explore Today's Market",
  };
}

/** A real, currently-open opportunity to feature. Three max — proof, not a listing. */
export interface FeaturedOpp {
  noticeId: string;
  title: string;
  agency: string;
  closes: string | null;
  href: string;
  /** M-Estimate median — the CARD'S HERO. Null is impossible here by construction: the query
   *  requires intel_value_range, because a card designed to lead with a number must never lead
   *  with a hole. (Only 42% of live notices carry one — 1,313 of 3,121 measured — so this is a
   *  SELECTION rule, not a rendering fallback. We feature 3 of thousands; requiring a real
   *  estimate costs nothing and guarantees every card leads with a real figure.) */
  estMedian: number;
  estLow: number | null;
  estHigh: number | null;
  /** The estimate's own provenance, straight from the stored payload — e.g. "274 comparable
   *  236220 · PSC Z1AZ contracts". Rendered under the number so the figure carries its receipt
   *  instead of asking to be trusted. Never composed here. */
  estBasis: string | null;
  /** Opportunity DNA strands (precomputed, 100% populated on live notices). Card shows the top
   *  few; `tone` drives the chip color. */
  dna: Array<{ key: string; label: string; tone: string }>;
  /** Small location badge — NOT a mini-map (Eric: reserve map thumbnails for where geography is
   *  the point). Place-of-performance when SAM carries it (52%), else the BUYING OFFICE state
   *  (99%) — the documented pop-OR-office pattern. `isOffice` lets the UI label it honestly. */
  place: string | null;
  placeIsOffice: boolean;
  /** Days until close — drives the urgency chip. Null when there's no deadline. */
  daysLeft: number | null;
}

export async function getFeaturedOpportunities(limit = 3): Promise<FeaturedOpp[]> {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  // ⚠️ Column names are READ FROM THE SCHEMA, not guessed. A `.select()` naming a column that does
  // not exist fails the WHOLE query (PostgREST returns an error, not a partial row) — the first
  // draft of this reached for `set_aside`, which does not exist (it is `set_aside_description`),
  // and would have silently emptied the entire Featured section.
  //   · intel_value_range  — the STORED M-Estimate (median/low/high/label). Precomputed, so the
  //                          page does no estimate math at load.
  //   · opportunity_dna    — the STORED strands (key/label/tone/tier). 100% populated on live rows.
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id, title, department, response_deadline, intel_value_range, opportunity_dna, pop_state, pop_city, office_address')
    .eq('active', true)
    .gte('posted_date', since)
    .gte('response_deadline', today)     // never feature something you can no longer bid
    .not('title', 'is', null)
    .not('intel_value_range', 'is', null)  // the card LEADS with the value — no value, not featured
    .order('posted_date', { ascending: false })
    .limit(60);
  if (error || !data) return [];         // additive block: absent rather than a fake row

  type Row = {
    notice_id: string; title: string; department: string | null; response_deadline: string | null;
    intel_value_range: { median?: number; low?: number; high?: number; label?: string } | null;
    opportunity_dna: Array<{ key?: string; label?: string; tone?: string }> | null;
    pop_state: string | null; pop_city: string | null;
    office_address: { state?: string } | null;
  };

  const dayMs = 864e5;
  return (data as Row[])
    .filter((r) => r.title && r.title.length >= 20 && r.title.length <= 90)  // readable headlines only
    // A median of 0/absent is not a hero number — drop rather than render "$0".
    .filter((r) => typeof r.intel_value_range?.median === 'number' && r.intel_value_range.median > 0)
    .slice(0, limit)
    .map((r) => {
      const v = r.intel_value_range!;
      const popState = (r.pop_state || '').trim();
      const officeState = (r.office_address?.state || '').trim();
      const deadline = r.response_deadline ? String(r.response_deadline).slice(0, 10) : null;
      return {
        noticeId: r.notice_id,
        title: r.title,
        agency: prettyAgency(r.department || ''),
        closes: deadline,
        href: `/opportunity-map?opp=${encodeURIComponent(r.notice_id)}`,
        estMedian: v.median as number,
        estLow: typeof v.low === 'number' ? v.low : null,
        estHigh: typeof v.high === 'number' ? v.high : null,
        estBasis: typeof v.label === 'string' ? v.label : null,
        // Strands arrive ordered by tier (tier 1 = "can I win?" first) — keep that order, take 3.
        dna: (Array.isArray(r.opportunity_dna) ? r.opportunity_dna : [])
          .filter((s) => s && typeof s.label === 'string' && s.label)
          .slice(0, 3)
          .map((s) => ({ key: String(s.key || s.label), label: String(s.label), tone: String(s.tone || 'neutral') })),
        // Place-of-performance city/state when SAM carries it; otherwise the buying-office state,
        // flagged so the UI can say "bought by an office in X" rather than implying work location.
        place: popState ? [r.pop_city, popState].filter(Boolean).join(', ') : (officeState || null),
        placeIsOffice: !popState && !!officeState,
        daysLeft: deadline ? Math.max(0, Math.round((new Date(`${deadline}T00:00:00Z`).getTime() - Date.now()) / dayMs)) : null,
      };
    });
}
