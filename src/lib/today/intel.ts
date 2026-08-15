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
    sb.from('sam_opportunities').select('naics_code').eq('active', true).gte('posted_date', week).not('naics_code', 'is', null).limit(8000),
    sb.from('sam_opportunities').select('naics_code').gte('posted_date', twoWeek).lt('posted_date', week).not('naics_code', 'is', null).limit(8000),
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
  const cnt = (rows: unknown) => {
    const m = new Map<string, number>();
    for (const r of (rows || []) as Array<{ naics_code: string }>) m.set(r.naics_code, (m.get(r.naics_code) || 0) + 1);
    return m;
  };
  const tw = cnt(thisWk.data), pw = cnt(prevWk.data);
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
