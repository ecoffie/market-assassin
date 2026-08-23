/**
 * PROPOSAL FUNNEL — Workspace → Draft → Compliance → Export, segmented by entitlement.
 *
 * WHY THIS EXISTS (read before changing the numbers it reports):
 * The question "is proposal drafting something customers should be paying for?" was
 * UNANSWERABLE from production. Proposal work persisted no owned artifact (no
 * `proposal_drafts` / `proposal_sections` table — INT-003 null, not zero), emitted ZERO
 * engagement events, and the one durable trace (`compliance_matrix_cache`, 10 rows) is keyed
 * by CONTENT HASH, so it cannot attribute a run to a user. The honest estimate of affected
 * free users spanned 19–356 — an order of magnitude. You cannot price, gate, or defend a
 * feature on a range like that, which is why instrumentation came BEFORE any entitlement
 * change rather than after.
 *
 * WHAT THIS MEASURES: distinct USERS per step, not events. One user regenerating a section
 * forty times is one user who drafted — an event count would read as adoption when it is
 * really one person iterating. Depth is reported separately as events-per-user.
 *
 * ⚠️ THREE STATES THAT MUST NEVER COLLAPSE (Instrumentation Integrity):
 *   measured + used      → a real number
 *   measured + 0 users   → a real zero: shipped, observed, nobody used it
 *   NOT measured         → `null`, never 0
 * Each step carries `instrumented` + `firstEventAt`. Before an emitter has ever been observed
 * in production, its count is null and reads "not yet measured" — because a missing emitter
 * and genuine non-use look IDENTICAL downstream, and this funnel is about to inform a
 * pricing decision. Never let an evidence failure manufacture a usage fact.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The service-role client is untyped here (no generated DB types in this route); alias it
// once rather than sprinkling casts at each call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE = 1000;

/**
 * The funnel, in order. Each step accepts SEVERAL action tokens because proposal work happens
 * on TWO surfaces that instrument differently — and reading only one of them would report the
 * other's real users as zero:
 *
 *   MAP  (`opportunity-map/proposal`) — client-side `track()`, live since ~2026-08-13.
 *        Emits `proposal_opened` / `section_built` / `compliance_run` / `export_proposal`.
 *        ⚠️ Its `compliance_run` and `export_proposal` fire on the REDIRECT to /app, BEFORE
 *        the work happens — they measure INTENT, not completion.
 *   /app (`ProposalsPanel` → the API routes) — server-side, added 2026-08-23. This is where
 *        drafting/compliance/export ACTUALLY execute, and it emitted nothing at all before.
 *
 * `intentTokens` are counted separately from completion so the two can never be summed into a
 * single inflated step: a user who clicks "Run compliance" on the map and then completes it in
 * /app is ONE completion, not two. Reporting them as one number is precisely the kind of
 * confident-but-wrong figure this funnel exists to avoid.
 */
const STEPS = [
  {
    step: 'workspace_opened',
    label: 'Workspace opened',
    tokens: ['proposal_workspace_opened', 'proposal_opened'],
    intentTokens: [] as string[],
  },
  {
    step: 'section_drafted',
    label: 'Section drafted',
    tokens: ['proposal_section_drafted', 'section_built'],
    intentTokens: [] as string[],
  },
  {
    step: 'compliance_run',
    label: 'Compliance run',
    tokens: ['compliance_completed'],
    intentTokens: ['compliance_run'],
  },
  {
    step: 'exported',
    label: 'Proposal exported',
    tokens: ['proposal_exported'],
    intentTokens: ['export_proposal'],
  },
] as const;

interface EngRow {
  user_email: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
}

function normalizeEmail(v: string | null | undefined): string {
  return (v || '').toLowerCase().trim();
}

/**
 * Page the whole window. PostgREST silently caps a response at 1,000 rows — no error, no
 * flag — so a single unpaginated read would report a confident, plausible, wrong funnel.
 * `data.length === PAGE` is the only tell.
 */
async function fetchAllEngagement(
  supabase: Db,
  sinceIso: string
): Promise<{ rows: EngRow[]; truncated: boolean }> {
  const rows: EngRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_engagement')
      .select('user_email, created_at, metadata')
      .eq('event_source', 'proposal')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_engagement read failed: ${error.message}`);
    const batch = (data || []) as unknown as EngRow[];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
    if (from > 200_000) return { rows, truncated: true }; // runaway backstop
  }
}

/**
 * The Pro population is a UNION, not a flag: purchases ∪ access_* ∪ access_team.
 * No single column captures it (~59 buyers never got `access_briefings` written), so
 * segmenting on one flag would misclassify real payers as free and overstate free usage —
 * exactly the direction that would wrongly justify a paywall.
 */
async function fetchProEmails(supabase: Db): Promise<Set<string>> {
  const pro = new Set<string>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('email, access_briefings, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_team')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`user_profiles read failed: ${error.message}`);
    const batch = data || [];
    for (const r of batch as Record<string, unknown>[]) {
      const entitled = Boolean(
        r.access_briefings || r.access_hunter_pro || r.access_assassin_standard ||
        r.access_assassin_premium || r.access_recompete || r.access_contractor_db ||
        r.access_content_standard || r.access_content_full_fix || r.access_team
      );
      if (entitled) pro.add(normalizeEmail(r.email as string));
    }
    if (batch.length < PAGE) break;
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('purchases')
      .select('user_email')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`purchases read failed: ${error.message}`);
    const batch = data || [];
    for (const r of batch as Record<string, unknown>[]) {
      const e = normalizeEmail(r.user_email as string);
      if (e) pro.add(e);
    }
    if (batch.length < PAGE) break;
  }

  return pro;
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 30), 1), 365);
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceIso = since.toISOString();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const [{ rows, truncated }, proEmails] = await Promise.all([
      fetchAllEngagement(supabase, sinceIso),
      fetchProEmails(supabase),
    ]);

    // Distinct users per step, split by entitlement, plus depth and first-seen.
    const users: Record<string, { free: Set<string>; pro: Set<string> }> = {};
    const events: Record<string, number> = {};
    const firstAt: Record<string, string | null> = {};
    for (const s of STEPS) {
      users[s.step] = { free: new Set(), pro: new Set() };
      events[s.step] = 0;
      firstAt[s.step] = null;
    }

    const intentUsers: Record<string, Set<string>> = {};
    for (const s of STEPS) intentUsers[s.step] = new Set();

    let unattributed = 0;
    for (const row of rows) {
      const action = (row.metadata?.action as string) || '';
      const email = normalizeEmail(row.user_email);

      const completed = STEPS.find((x) => (x.tokens as readonly string[]).includes(action));
      const intent = STEPS.find((x) => (x.intentTokens as readonly string[]).includes(action));
      if (!completed && !intent) continue;
      if (!email) { unattributed++; continue; }

      if (completed) {
        (proEmails.has(email) ? users[completed.step].pro : users[completed.step].free).add(email);
        events[completed.step]++;
        if (!firstAt[completed.step] || (row.created_at && row.created_at < firstAt[completed.step]!)) {
          firstAt[completed.step] = row.created_at;
        }
      }
      // Intent is tracked but NEVER folded into the completion count.
      if (intent) intentUsers[intent.step].add(email);
    }

    const steps = STEPS.map((s) => {
      const free = users[s.step].free.size;
      const pro = users[s.step].pro.size;
      const total = free + pro;
      const instrumented = events[s.step] > 0;
      return {
        step: s.step,
        label: s.label,
        instrumented,
        firstEventAt: firstAt[s.step],
        // null (NOT 0) until an emitter has actually been observed: "not measured" and
        // "measured, nobody used it" are different facts and must stay different.
        users: instrumented ? total : null,
        freeUsers: instrumented ? free : null,
        proUsers: instrumented ? pro : null,
        events: instrumented ? events[s.step] : null,
        eventsPerUser: instrumented && total > 0
          ? Number((events[s.step] / total).toFixed(2))
          : null,
        // Users who signalled intent (clicked through on the map) without a recorded
        // completion. A large gap here is a drop-off between surfaces, NOT usage.
        intentOnlyUsers: intentUsers[s.step].size,
      };
    });

    const opened = steps[0];
    const exported = steps[3];
    const conversion = opened.users && opened.users > 0 && exported.users !== null
      ? Number(((exported.users / opened.users) * 100).toFixed(1))
      : null;

    const anyInstrumented = steps.some((s) => s.instrumented);

    return NextResponse.json({
      success: true,
      windowDays: days,
      since: sinceIso,
      truncated,
      steps,
      // The headline for the entitlement decision: how many DISTINCT FREE users actually
      // reach the paid-candidate behaviour. This is the blast radius a gate would hit.
      freeUsersReachingExport: exported.freeUsers,
      openedToExportPct: conversion,
      unattributedEvents: unattributed,
      // Honest posture while the funnel is still filling. Do NOT read a fresh deploy's
      // zeros as evidence of non-use.
      readiness: anyInstrumented
        ? 'collecting — measure a full window before making an entitlement decision'
        : 'NOT YET MEASURED — no proposal events observed in this window',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Surface, never swallow: a failed read must not render as an empty funnel.
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
