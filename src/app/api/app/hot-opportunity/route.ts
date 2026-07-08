/**
 * Hot Opportunity — the single most-tracked collab-ready opp, for the in-app
 * "🔥 Hot right now" hero card (the social-proof "aha moment").
 *
 * Reuses the Demand Heatmap engine (the same aggregated user-intent signal the
 * admin sees) and returns ONE opp: the most-tracked, collab-ready one, preferring
 * Sources Sought (the "respond together" sweet spot). Anonymous aggregate count
 * only — never names. Gated on COLLAB_THRESHOLD so a weak signal never surfaces.
 *
 * This is system-wide social proof ("N contractors across Mindy are researching
 * this"), so the count is NOT personalized — but the route is still user-authed
 * (it lives under /app and only members should see the signal).
 *
 *   GET ?email=<user> -> { hot: { noticeId, title, agency, trackerCount,
 *                                 isSourcesSought, message } | null }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getDemandHeatmap } from '@/lib/admin/demand-heatmap';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { isDistinctiveKeyword } from '@/lib/market/keyword-sanitize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** The profile the hot card must match against (NAICS + keywords + PSC). The
 *  hot card is social proof for ENGAGED members — with NO market set up there's
 *  nothing to be relevant to. Empty NAICS → hide the card (Eric, Jun 25). On
 *  error → empty (better to hide than mislead).
 *
 *  Coach Mode: when the caller has switched to a client workspace, read the
 *  CLIENT's profile (its synthetic notification email), not the coach's own —
 *  else a coach working a woodworking client sees the coach's construction opps
 *  (the coach_mode_header_drop class of bug). */
async function getViewerProfile(profileEmail: string): Promise<{ naics: string[]; keywords: string[]; psc: string[] }> {
  try {
    const { data } = await sb()
      .from('user_notification_settings')
      .select('naics_codes, keywords, psc_codes')
      .eq('user_email', profileEmail)
      .maybeSingle();
    const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map((c) => String(c).trim()).filter(Boolean) : []);
    return {
      naics: arr(data?.naics_codes),
      keywords: arr(data?.keywords).map((k) => k.toLowerCase()),
      psc: arr(data?.psc_codes).map((p) => p.toUpperCase()),
    };
  } catch {
    return { naics: [], keywords: [], psc: [] };
  }
}

/** notice_id → {naics, psc, title} for a set of notices (from the opportunity
 *  cache). Lets us judge whether a hot opp is in the viewer's space across all
 *  three targeting axes. */
type NoticeMeta = { naics?: string; psc?: string; title?: string; deadline?: string | null };
async function metaForNotices(noticeIds: string[]): Promise<Map<string, NoticeMeta>> {
  const map = new Map<string, NoticeMeta>();
  if (!noticeIds.length) return map;
  try {
    const { data } = await sb()
      .from('sam_opportunities')
      .select('notice_id, naics_code, psc_code, title, response_deadline')
      .in('notice_id', noticeIds);
    for (const r of (data || []) as Array<{ notice_id?: string; naics_code?: string; psc_code?: string; title?: string; response_deadline?: string | null }>) {
      if (r.notice_id) {
        map.set(r.notice_id, {
          naics: r.naics_code ? String(r.naics_code).trim() : undefined,
          psc: r.psc_code ? String(r.psc_code).trim().toUpperCase() : undefined,
          title: r.title || undefined,
          deadline: r.response_deadline ?? null,
        });
      }
    }
  } catch { /* fall through — unknown meta treated as non-match */ }
  return map;
}

/** Is the opp still OPEN — a future response deadline? A "hot right now" card
 *  showing an already-closed date (the May-4 bug) is worse than no card. A null
 *  deadline is treated as NOT open (can't prove it's live → don't surface it as
 *  hot). Compares on the date only (ignore intra-day tz). */
function isOpen(meta: NoticeMeta | undefined): boolean {
  if (!meta?.deadline) return false;
  const today = new Date().toISOString().slice(0, 10);
  return String(meta.deadline).slice(0, 10) >= today;
}

/**
 * Score how STRONGLY an opp matches the viewer's profile. The "hot right now" card
 * is a precision surface, so a lone GENERIC keyword ("management") is NOT enough —
 * it floods the card with noise (Blue Heron's "Worldwide Project Management" card).
 * A match qualifies only via a strong signal:
 *   - a DISTINCTIVE keyword hit (a phrase or a non-generic term) — the precise axis
 *   - a PSC family hit (what was actually bought)
 *   - a NAICS hit BACKED BY any keyword hit (NAICS alone is a catch-all; pairing it
 *     with a keyword keeps a fiber-optic Electrical opp off a woodworking profile)
 * Returns a score (higher = better) or 0 for "not this viewer's opp".
 */
function matchScore(
  meta: NoticeMeta | undefined,
  p: { naics: string[]; keywords: string[]; psc: string[] },
): number {
  if (!meta) return 0;
  const title = (meta.title || '').toLowerCase();

  const distinctiveHits = p.keywords.filter((k) => isDistinctiveKeyword(k) && title.includes(k));
  const anyKwHit = p.keywords.some((k) => title.includes(k)); // incl. generic (weak)
  const naicsHit = !!meta.naics && p.naics.some((c) => c === meta.naics || c.slice(0, 4) === meta.naics!.slice(0, 4));
  const pscHit = !!meta.psc && p.psc.some((c) => c === meta.psc || c.slice(0, 2) === meta.psc!.slice(0, 2));

  let score = 0;
  score += distinctiveHits.length * 40;              // strongest: a precise phrase/term
  if (pscHit) score += 25;                            // bought this product family
  if (naicsHit && anyKwHit) score += 20;              // industry + any keyword context
  // NAICS-only or generic-keyword-only → deliberately NOT a strong match (0 from
  // those alone). This is the whole point: don't surface "management"-only noise.

  return score;
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // Coach Mode: match against the ACTIVE workspace's profile. When the caller
  // has switched to a client, use the client's synthetic notification email so
  // the hot card reflects the CLIENT's market (woodworking), not the coach's own
  // (construction). Falls back to the coach's own email in their own workspace.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const profileEmail = asClient ? clientNotificationEmail(workspaceId) : email;

  // PROFILE GATE. No saved NAICS profile → no market yet → don't pretend a hot
  // opportunity is relevant. Applies to the demo card too.
  const profile = await getViewerProfile(profileEmail);
  if (profile.naics.length === 0 && profile.keywords.length === 0) {
    return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // --- DEMO SAFETY NET (YT Live) ----------------------------------------
  // When COLLAB_DEMO_TITLE is set, force-return a synthetic hot opp so the
  // "🔥 Hot right now" card is GUARANTEED on screen, independent of real
  // tracking data. Turn OFF after the demo (unset the env). Real signal
  // resumes automatically. Per-request override: ?demo=1 / ?demo=0.
  const demoParam = request.nextUrl.searchParams.get('demo');
  const demoOn = demoParam === '1' || (demoParam !== '0' && !!process.env.COLLAB_DEMO_TITLE);
  if (demoOn && process.env.COLLAB_DEMO_TITLE) {
    const count = Number(process.env.COLLAB_DEMO_COUNT) || 7;
    const title = process.env.COLLAB_DEMO_TITLE;
    const agency = process.env.COLLAB_DEMO_AGENCY || 'Department of Defense';
    const isSS = /sources sought|sources-sought|\bRFI\b/i.test(title);
    return NextResponse.json(
      {
        hot: {
          noticeId: process.env.COLLAB_DEMO_NOTICE_ID || 'demo-collab',
          title,
          agency,
          trackerCount: count,
          isSourcesSought: isSS,
          responseDeadline: process.env.COLLAB_DEMO_DEADLINE || null,
          message: isSS
            ? `${count} contractors are researching this Sources Sought. You're not the only one — respond together.`
            : `${count} contractors are tracking this opportunity. You're not the only one pursuing it.`,
          demo: true,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // ----------------------------------------------------------------------

  try {
    const heatmap = await getDemandHeatmap(40);
    const ready = heatmap.opps.filter((o) => o.collabReady);
    if (!ready.length) {
      return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // PERSONALIZE + FRESHNESS + STRONG MATCH. Only surface a hot opp that is (a)
    // still OPEN (future deadline — the May-4 expired-card bug), and (b) a STRONG
    // match to the ACTIVE profile (distinctive keyword / PSC / NAICS+keyword — a
    // lone generic word like "management" no longer qualifies, which is what put a
    // "Worldwide Project Management" card on an 8-NAICS profile). Opps with unknown
    // meta are excluded (can't prove relevance/freshness → don't mislead).
    const metaMap = await metaForNotices(ready.map((o) => o.noticeId));
    const scored = ready
      .map((o) => {
        const meta = metaMap.get(o.noticeId);
        return { o, meta, open: isOpen(meta), score: matchScore(meta, profile) };
      })
      .filter((x) => x.open && x.score > 0);
    if (!scored.length) {
      return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Rank by MATCH QUALITY first, then Sources Sought (the "respond together"
    // sweet spot), then tracker count — so the strongest, most-actionable open opp
    // wins, not merely the first Sources Sought that happened to hit a stopword.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ss = Number(b.o.isSourcesSought) - Number(a.o.isSourcesSought);
      if (ss !== 0) return ss;
      return b.o.trackerCount - a.o.trackerCount;
    });
    const hot = scored[0].o;

    const message = hot.isSourcesSought
      ? `${hot.trackerCount} contractors are researching this Sources Sought. You're not the only one — respond together.`
      : `${hot.trackerCount} contractors are tracking this opportunity. You're not the only one pursuing it.`;

    return NextResponse.json(
      {
        hot: {
          noticeId: hot.noticeId,
          title: hot.title,
          agency: hot.agency,
          trackerCount: hot.trackerCount,
          isSourcesSought: hot.isSourcesSought,
          responseDeadline: hot.responseDeadline,
          message,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    // Never break the dashboard — just show no card.
    return NextResponse.json({ hot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
