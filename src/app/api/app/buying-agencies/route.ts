/**
 * GET /api/app/buying-agencies?q=<text> — the Filters panel's "Agency" and "Sub-agency" pickers.
 *
 * WHY: both fields were bare text boxes whose only hint was a placeholder ("e.g. Navy",
 * "e.g. Army"). Eric's reference is USASpending's Advanced Search, where typing "navy" offers
 * **Department of the Navy (USN)** with **"Sub-Agency of Department of Defense (DOD)"** beneath
 * it — the picker resolves the real agency AND shows its parent, so you know which of several
 * similarly-named entities you actually picked.
 *
 * WHAT IT RETURNS: the departments and sub-agencies that genuinely have OPEN, MAPPABLE work
 * right now, each with its parent and its opportunity count. Nothing is listed that the filter
 * would then find nothing for.
 *
 * GROUNDING (rule #1): every name, parent and count comes from `sam_opportunities` itself —
 * the SAME `department` / `sub_tier` columns `applyMapFilters` matches on. No curated list, no
 * LLM, no hardcoded roster that can drift from the corpus (the Agency top-bar dropdown's
 * 16-item hardcoded array is exactly that drift risk, and is deliberately left alone here).
 *
 * ⚠️ A sub_tier that EQUALS its department is not a real child — SAM repeats the department in
 * `sub_tier` for single-tier agencies ("STATE, DEPARTMENT OF" / "STATE, DEPARTMENT OF"). Those
 * are returned as departments only, never as a sub-agency row that would read as a second,
 * narrower choice while filtering identically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Below this an agency is noise in a picker — a 1-notice department is not a browsable choice. */
const MIN_OPEN = 3;
const MAX_ROWS = 400;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface BuyingAgency {
  name: string;
  /** 'department' = top tier (DEPT OF DEFENSE); 'sub' = a real child (DEPT OF THE NAVY). */
  kind: 'department' | 'sub';
  /** For a sub-agency, the department it sits under — the "Sub-Agency of X" line. Null for a department. */
  parent: string | null;
  openCount: number;
}

export async function GET(request: NextRequest) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().toUpperCase();
  try {
    const db = sb();
    const now = new Date().toISOString();
    const PAGE = 1000;

    // ⚠️ PAGED. PostgREST hard-caps a response at 1000 rows no matter what `.limit()` says —
    // the same trap that made the buying-offices picker report 15 offices instead of 209 and
    // understate every count. ~10k matching rows here, so an unpaged read would silently rank
    // agencies off the first page. Pages after the first are fetched concurrently.
    const pageQuery = (from: number, withCount: boolean) =>
      db.from('sam_opportunities')
        .select('department, sub_tier', withCount ? { count: 'exact' } : undefined)
        .not('map_lat', 'is', null)
        .eq('active', true)
        .gt('response_deadline', now)
        .order('notice_id', { ascending: true })
        .range(from, from + PAGE - 1);

    const { data: first, count, error } = await pageQuery(0, true);
    if (error) throw error;
    type Row = { department: string | null; sub_tier: string | null };
    const rows: Row[] = [...((first ?? []) as Row[])];

    // A null count is UNKNOWN, not zero (Bug Prevention Rule #11) — page sequentially rather
    // than ranking agencies off whatever the first page happened to hold.
    if (count == null) {
      for (let from = PAGE; ; from += PAGE) {
        const { data: page, error: pErr } = await pageQuery(from, false);
        if (pErr) throw pErr;
        if (!page || !page.length) break;
        rows.push(...(page as Row[]));
        if (page.length < PAGE) break;
      }
    } else if (rows.length < count) {
      const offsets: number[] = [];
      for (let from = PAGE; from < count; from += PAGE) offsets.push(from);
      const pages = await Promise.all(offsets.map(async (from) => {
        const { data: page, error: pErr } = await pageQuery(from, false);
        if (pErr) throw pErr;
        return (page ?? []) as Row[];
      }));
      for (const page of pages) rows.push(...page);
    }

    const deptCounts = new Map<string, number>();
    const subCounts = new Map<string, { parent: string; n: number }>();
    for (const r of rows) {
      const dep = String(r.department ?? '').trim();
      const sub = String(r.sub_tier ?? '').trim();
      if (dep) deptCounts.set(dep, (deptCounts.get(dep) || 0) + 1);
      // Skip the self-referential sub_tier (see the header note) — it is the department again,
      // not a narrower choice.
      if (sub && dep && sub.toUpperCase() !== dep.toUpperCase()) {
        const cur = subCounts.get(sub);
        subCounts.set(sub, { parent: dep, n: (cur?.n || 0) + 1 });
      }
    }

    let out: BuyingAgency[] = [];
    for (const [name, openCount] of deptCounts) {
      if (openCount < MIN_OPEN) continue;
      out.push({ name, kind: 'department', parent: null, openCount });
    }
    for (const [name, v] of subCounts) {
      if (v.n < MIN_OPEN) continue;
      out.push({ name, kind: 'sub', parent: v.parent, openCount: v.n });
    }
    out.sort((a, b) => b.openCount - a.openCount || a.name.localeCompare(b.name));

    if (q) {
      out = out.filter((a) => a.name.toUpperCase().includes(q) || (a.parent || '').toUpperCase().includes(q));
    }

    return NextResponse.json(
      { success: true, agencies: out.slice(0, MAX_ROWS), minOpen: MIN_OPEN },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800' } },
    );
  } catch (e) {
    // Honest failure: empty list + success:false, so the client can stay quiet rather than
    // render an empty menu that reads as "no agencies are buying anything".
    console.error('[buying-agencies]', e);
    return NextResponse.json({ success: false, agencies: [], error: 'lookup_failed' }, { status: 200 });
  }
}
