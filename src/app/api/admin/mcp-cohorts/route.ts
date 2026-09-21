import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * MCP ACTIVATION + RETENTION COHORTS
 *
 * WHY THIS EXISTS (Eric, 2026-08-22, after the live session): "We know 23 connected. The
 * next question is much more important: how many come back? Track the cohort at Day 1,
 * Day 3, Day 7 and Day 30."
 *
 * 23 people connected for the first time DURING one live session — 70% growth in real
 * external users in a day. That tells us people will TRY it. It says nothing about habit,
 * and habit is what decides whether MCP becomes a primary product surface or stays an
 * integration.
 *
 * DERIVED, NOT LOGGED. Everything here is computed from mcp_call_log, which already
 * records every call. So it works RETROACTIVELY on today's cohort — no migration, no
 * "we'll start measuring tomorrow", and no second source that can drift from the first.
 *
 * ⚠️ PAGINATED ON PURPOSE. PostgREST silently caps an unranged select at 1,000 rows, and
 * this table already holds 1,779. That exact truncation produced "24 accounts all-time,
 * 0 new" on 2026-08-22 when the truth was 59 and 23 — a fabricated denominator reported
 * with full confidence. The pre-push gate now blocks unranged reads in scripts/; this
 * route pages explicitly for the same reason.
 *
 * GET /api/admin/mcp-cohorts?password=...
 *   &days=30        how far back to build cohorts (default 30)
 *   &internal=1     include staff/demo accounts (default: EXCLUDED)
 */

export const dynamic = 'force-dynamic';

/** Staff, demo and test accounts are not customers — they inflate every denominator. */
const INTERNAL = /@govcongiants\.com$|^demo@getmindy\.ai$|test/i;

const PAGE = 1000;
const DAY = 86_400_000;

type Call = { user_email: string | null; created_at: string; tool_name: string | null; status: string | null; credits_charged: number | null };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10), 1), 365);
  const includeInternal = searchParams.get('internal') === '1';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Read the FULL history: a first-ever-call date is only correct against every row.
  const all: Call[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mcp_call_log')
      .select('user_email, created_at, tool_name, status, credits_charged')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // Surface it. A partial read here silently understates every cohort.
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data?.length) break;
    all.push(...(data as Call[]));
    if (data.length < PAGE) break;
  }

  const calls = all.filter((c) => c.user_email && (includeInternal || !INTERNAL.test(c.user_email)));

  // user -> sorted call times
  const byUser = new Map<string, Call[]>();
  for (const c of calls) {
    const k = c.user_email as string;
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push(c);
  }

  const now = Date.now();
  const cohortOf = (iso: string) => iso.slice(0, 10);

  /** Did this user call on a day >= N days after their first call? */
  const returnedByDay = (times: number[], first: number, n: number) =>
    times.some((t) => t >= first + n * DAY);

  // Build day cohorts keyed on each user's FIRST EVER call.
  const cohorts = new Map<string, {
    users: string[];
    d1: number; d3: number; d7: number; d30: number;
    secondSession: number;       // a call >30 min after the first — the earliest habit signal
    calls: number; credits: number; tools: Set<string>;
  }>();

  for (const [email, list] of byUser) {
    const times = list.map((c) => new Date(c.created_at).getTime()).sort((a, b) => a - b);
    const first = times[0];
    if (now - first > days * DAY) continue;              // outside the window
    const key = cohortOf(list[0].created_at);
    if (!cohorts.has(key)) {
      cohorts.set(key, { users: [], d1: 0, d3: 0, d7: 0, d30: 0, secondSession: 0, calls: 0, credits: 0, tools: new Set() });
    }
    const c = cohorts.get(key)!;
    c.users.push(email);
    c.calls += list.length;
    c.credits += list.reduce((s, x) => s + (x.credits_charged || 0), 0);
    list.forEach((x) => x.tool_name && c.tools.add(x.tool_name));
    if (times.some((t) => t > first + 30 * 60_000)) c.secondSession++;
    if (returnedByDay(times, first, 1)) c.d1++;
    if (returnedByDay(times, first, 3)) c.d3++;
    if (returnedByDay(times, first, 7)) c.d7++;
    if (returnedByDay(times, first, 30)) c.d30++;
  }

  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);

  const rows = [...cohorts.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, c]) => {
      const size = c.users.length;
      const age = Math.floor((now - new Date(`${date}T12:00:00Z`).getTime()) / DAY);
      return {
        cohort_date: date,
        new_users: size,
        cohort_age_days: age,
        // A retention figure is NOT meaningful until the window has actually elapsed.
        // Reporting "D7 = 0%" on a cohort that is 1 day old is the same class of lie as
        // a truncated count: technically derived, functionally false.
        d1: age >= 1 ? { returned: c.d1, pct: pct(c.d1, size) } : 'too early',
        d3: age >= 3 ? { returned: c.d3, pct: pct(c.d3, size) } : 'too early',
        d7: age >= 7 ? { returned: c.d7, pct: pct(c.d7, size) } : 'too early',
        d30: age >= 30 ? { returned: c.d30, pct: pct(c.d30, size) } : 'too early',
        same_day_second_session: { count: c.secondSession, pct: pct(c.secondSession, size) },
        calls: c.calls,
        credits: c.credits,
        distinct_tools: c.tools.size,
        users: c.users,
      };
    });

  // What new users actually reach for, ranked — the input to first-run prompts.
  const firstWeekTools = new Map<string, number>();
  for (const [, list] of byUser) {
    const first = new Date(list[0].created_at).getTime();
    if (now - first > days * DAY) continue;
    list
      .filter((c) => new Date(c.created_at).getTime() <= first + 7 * DAY)
      .forEach((c) => c.tool_name && firstWeekTools.set(c.tool_name, (firstWeekTools.get(c.tool_name) || 0) + 1));
  }

  return NextResponse.json({
    success: true,
    window_days: days,
    internal_excluded: !includeInternal,
    totals: {
      rows_scanned: all.length,
      external_accounts_all_time: byUser.size,
      new_in_window: rows.reduce((s, r) => s + r.new_users, 0),
    },
    cohorts: rows,
    first_week_tool_use: [...firstWeekTools.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool, calls]) => ({ tool, calls })),
  });
}
