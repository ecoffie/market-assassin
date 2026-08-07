/**
 * Market Pulse — the "Today in the Market" desk read for the Market Intelligence dashboard.
 *
 * The Bloomberg move: every morning, tell the desk what MOVED in federal procurement — not
 * behavioral analytics (that's the rest of the dashboard), but the OUTSIDE market. Grounded in
 * our OWN cached data (sam_opportunities + recompete_opportunities), NEVER an LLM guess:
 *   - new opportunities posted this week vs prior week (with a real delta)
 *   - the most active buying department this week
 *   - a demand mover: the NAICS 2-digit sector with the biggest week-over-week rise
 *   - recompetes that entered the visible window
 *   - opportunities closing soon (the act-now shortlist size)
 *
 * Honesty contract (Bug Prevention Rule #11): every count binds { count/data, error } and
 * SURFACES the error. A failed sub-query yields `null` for that signal (rendered "no data yet"),
 * never a fabricated 0. The whole block is best-effort: if a signal errors, the others still ship.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PulseSignal {
  key: string;            // stable id for the UI icon/order
  label: string;          // the human sentence ("VA posted 24 new opportunities")
  sub: string;            // the small grey qualifier
  delta: string | null;   // the mono figure on the right ("+9%", "706", "↑") — null if unmeasured
  dir: 'up' | 'down' | 'flat' | null;
}

export interface MarketPulse {
  grounded: boolean;      // at least one signal produced a real number
  windowDays: number;     // the "this week" window (7)
  signals: PulseSignal[];
  error: string | null;   // set only if the primary read failed outright
}

// Friendly department names — SAM stores shouty ALL-CAPS. Trim to a readable label.
function cleanDept(d: string): string {
  const map: Record<string, string> = {
    'DEPT OF DEFENSE': 'DoD',
    'VETERANS AFFAIRS, DEPARTMENT OF': 'VA',
    'HOMELAND SECURITY, DEPARTMENT OF': 'DHS',
    'HEALTH AND HUMAN SERVICES, DEPARTMENT OF': 'HHS',
    'INTERIOR, DEPARTMENT OF THE': 'Interior',
    'STATE, DEPARTMENT OF': 'State Dept',
    'AGRICULTURE, DEPARTMENT OF': 'USDA',
    'ENERGY, DEPARTMENT OF': 'DOE',
    'JUSTICE, DEPARTMENT OF': 'DOJ',
    'ENVIRONMENTAL PROTECTION AGENCY': 'EPA',
    'GENERAL SERVICES ADMINISTRATION': 'GSA',
    'TRANSPORTATION, DEPARTMENT OF': 'DOT',
    'TREASURY, DEPARTMENT OF THE': 'Treasury',
    'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': 'NASA',
  };
  return map[d.trim().toUpperCase()] || d.trim().replace(/,?\s*DEPARTMENT OF( THE)?/i, '').trim();
}

// NAICS 2-digit sector → readable market name (the movers we care about for small biz).
const SECTOR_NAMES: Record<string, string> = {
  '23': 'Construction',
  '54': 'Professional & technical services',
  '56': 'Facilities & support services',
  '33': 'Manufacturing',
  '48': 'Transportation',
  '62': 'Health care',
  '61': 'Educational services',
  '81': 'Repair & maintenance',
};

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();

/**
 * Build the pulse from cached SAM + recompete data. `supabase` is a read client.
 * Runs the sub-queries in parallel; each is independently null-safe.
 */
export async function computeMarketPulse(supabase: SupabaseClient, windowDays = 7): Promise<MarketPulse> {
  const signals: PulseSignal[] = [];

  // Fire the independent reads together.
  const [newThis, newPrev, deptRows, secThis, secPrev, closingSoon, recompeteNew] = await Promise.all([
    // 1) new opps posted this week / prior week (head counts)
    supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).gte('posted_date', iso(windowDays)),
    supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).gte('posted_date', iso(windowDays * 2)).lt('posted_date', iso(windowDays)),
    // 2) departments active this week (bounded pull to tally client-side)
    supabase.from('sam_opportunities').select('department').gte('posted_date', iso(windowDays)).not('department', 'is', null).limit(8000),
    // 3) demand mover — pull naics_code for this + prior week, tally by 2-digit sector
    supabase.from('sam_opportunities').select('naics_code').gte('posted_date', iso(windowDays)).not('naics_code', 'is', null).limit(8000),
    supabase.from('sam_opportunities').select('naics_code').gte('posted_date', iso(windowDays * 2)).lt('posted_date', iso(windowDays)).not('naics_code', 'is', null).limit(8000),
    // 4) closing soon — active notices with an archive_date inside the next 7 days
    supabase.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).gte('archive_date', new Date().toISOString()).lte('archive_date', iso(-windowDays)),
    // 5) recompetes that entered the window — rows FIRST seen in the last week.
    //    ⚠️ Use created_at, NOT last_synced_at: the hourly recompete cron re-stamps last_synced_at on
    //    EVERY row, so gte(last_synced_at) counts the whole table (150k), not "new to market". created_at
    //    is the row's first-appearance timestamp — the honest "entered the window" signal.
    supabase.from('recompete_opportunities').select('*', { count: 'exact', head: true }).gte('created_at', iso(windowDays)),
  ]);

  // If the PRIMARY read (this-week count) failed outright, surface it — the block is unusable.
  if (newThis.error) {
    return { grounded: false, windowDays, signals: [], error: `market pulse read failed: ${newThis.error.message}` };
  }

  // ── 1) New opportunities + delta ──────────────────────────────────────
  if (typeof newThis.count === 'number') {
    const cur = newThis.count;
    const prev = newPrev.error ? null : newPrev.count;
    const delta = prev && prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
    signals.push({
      key: 'new_opps',
      label: `${cur.toLocaleString()} new opportunities posted`,
      sub: `across all agencies · last ${windowDays} days`,
      delta: delta == null ? null : `${delta >= 0 ? '+' : ''}${delta}%`,
      dir: delta == null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    });
  }

  // ── 2) Most active buyer this week ────────────────────────────────────
  if (!deptRows.error && deptRows.data) {
    const tally: Record<string, number> = {};
    for (const r of deptRows.data as { department: string | null }[]) {
      const d = (r.department || '').trim();
      if (d) tally[d] = (tally[d] || 0) + 1;
    }
    // The #1 civilian buyer is more actionable than DoD (which is always #1) — surface top civilian.
    const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const topCivilian = ranked.find(([d]) => !/DEFENSE|ARMY|NAVY|AIR FORCE|DEFENSE LOGISTICS/i.test(d));
    const pick = topCivilian || ranked[0];
    if (pick) {
      signals.push({
        key: 'top_buyer',
        label: `${cleanDept(pick[0])} posted ${pick[1].toLocaleString()} opportunities`,
        sub: topCivilian ? 'most active civilian buyer this week' : 'most active buyer this week',
        delta: pick[1].toLocaleString(),
        dir: 'flat',
      });
    }
  }

  // ── 3) Demand mover — biggest week-over-week sector rise ──────────────
  if (!secThis.error && secThis.data && !secPrev.error && secPrev.data) {
    const sector = (code: string | null) => (code || '').slice(0, 2);
    const tallyOf = (rows: { naics_code: string | null }[]) => {
      const t: Record<string, number> = {};
      for (const r of rows) { const s = sector(r.naics_code); if (SECTOR_NAMES[s]) t[s] = (t[s] || 0) + 1; }
      return t;
    };
    const curT = tallyOf(secThis.data as { naics_code: string | null }[]);
    const prevT = tallyOf(secPrev.data as { naics_code: string | null }[]);
    let best: { sector: string; pct: number } | null = null;
    for (const s of Object.keys(SECTOR_NAMES)) {
      const c = curT[s] || 0, p = prevT[s] || 0;
      if (p >= 20 && c > p) { // require a real base so a jump from 1→3 isn't "+200%"
        const pct = Math.round(((c - p) / p) * 100);
        if (!best || pct > best.pct) best = { sector: s, pct };
      }
    }
    if (best && best.pct >= 5) {
      signals.push({
        key: 'demand_mover',
        label: `${SECTOR_NAMES[best.sector]} demand +${best.pct}%`,
        sub: `NAICS ${best.sector}xxx postings vs prior week`,
        delta: `+${best.pct}%`,
        dir: 'up',
      });
    }
  }

  // ── 4) Recompetes that entered the window ─────────────────────────────
  if (!recompeteNew.error && typeof recompeteNew.count === 'number' && recompeteNew.count > 0) {
    signals.push({
      key: 'recompetes',
      label: `${recompeteNew.count.toLocaleString()} recompetes entered the market`,
      sub: 'contracts newly synced into the expiring window',
      delta: `+${recompeteNew.count.toLocaleString()}`,
      dir: 'up',
    });
  }

  // ── 5) Closing-soon shortlist size ────────────────────────────────────
  if (!closingSoon.error && typeof closingSoon.count === 'number') {
    signals.push({
      key: 'closing_soon',
      label: `${closingSoon.count.toLocaleString()} opportunities closing in ${windowDays} days`,
      sub: 'the act-now shortlist for members',
      delta: closingSoon.count.toLocaleString(),
      dir: 'flat',
    });
  }

  return { grounded: signals.length > 0, windowDays, signals, error: null };
}
