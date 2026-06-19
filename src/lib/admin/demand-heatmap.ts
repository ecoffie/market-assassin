/**
 * Demand Heatmap — the aggregated user-intent signal behind the collaboration /
 * social-proof feature (the "aha moment").
 *
 * Aggregates which opportunities the MOST users are tracking (user_pipeline),
 * flags Sources Sought (the collaboration sweet spot), and previews the "respond
 * together" collab alert — GATED on a minimum-tracker threshold so a weak signal
 * ("1 other person looking") never fires. Admin-only Phase 1: SEE the signal +
 * control the trigger before automating the user-facing viral loop.
 *
 * DELIBERATELY NOT segmenting by set-aside (WOSB/8a/etc.) yet (Eric, Jun 19):
 * socioeconomic data is mostly empty + segmenting splits a small pool into tiny
 * buckets = looks broken + too limiting. Lead with the RAW collaboration signal
 * (who's tracking + responding) to PROVE the mechanic works and drive adoption.
 * Add segmentation back as a Phase 2+ refinement once there's user-data volume.
 *
 * THE MOAT: no competitor has aggregated user-intent data. This is built entirely
 * from our own users' tracking behavior — uncopyable without the user base.
 *
 * Privacy: ANONYMOUS AGGREGATE COUNTS ONLY — never user names/identities.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Minimum trackers before an opp is "hot" enough to show/trigger. Below this,
 *  the social-proof signal is weak (airline showing "1 person looking" kills FOMO). */
export const COLLAB_THRESHOLD = 3;

export interface HeatmapOpp {
  noticeId: string;
  title: string;
  agency: string | null;
  setAside: string | null;
  responseDeadline: string | null;
  isSourcesSought: boolean;
  trackerCount: number;       // distinct users tracking (anonymous count)
  pursuingCount: number;      // subset actively "pursuing"
  /** true when trackerCount >= COLLAB_THRESHOLD → eligible for a collab alert. */
  collabReady: boolean;
  /** the alert copy this opp WOULD trigger (preview; admin sends manually in P1). */
  collabPreview: string | null;
}

export interface DemandHeatmap {
  generatedAt: string;
  totalTrackedOpps: number;
  collabReadyCount: number;
  threshold: number;
  opps: HeatmapOpp[];
}

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Collab preview — raw collaboration signal (capabilities + responding), NO set-aside
// segmentation. The "you're not the only one → respond together" FOMO driver.
function buildCollabPreview(opp: { title: string; trackerCount: number; isSourcesSought: boolean }): string {
  if (opp.isSourcesSought) {
    return `${opp.trackerCount} contractors are researching "${opp.title.slice(0, 60)}". You're not the only one — respond to the Sources Sought together. The more capable businesses that respond, the stronger the signal to the agency.`;
  }
  return `${opp.trackerCount} contractors are tracking "${opp.title.slice(0, 60)}". You're not the only one pursuing this — sharpen your response before it closes.`;
}

export async function getDemandHeatmap(limit = 40): Promise<DemandHeatmap> {
  const client = sb();
  const now = new Date().toISOString();
  if (!client) return { generatedAt: now, totalTrackedOpps: 0, collabReadyCount: 0, threshold: COLLAB_THRESHOLD, opps: [] };

  // 1. Pull active (non-archived) pipeline rows with a notice_id.
  const { data: pipe } = await client
    .from('user_pipeline')
    .select('notice_id, title, agency, set_aside, response_deadline, user_email, stage')
    .not('notice_id', 'is', null)
    .neq('is_archived', true)
    .limit(5000);
  if (!pipe?.length) return { generatedAt: now, totalTrackedOpps: 0, collabReadyCount: 0, threshold: COLLAB_THRESHOLD, opps: [] };

  // 2. Group by notice_id → distinct users + pursuing subset.
  type Agg = { title: string; agency: string | null; setAside: string | null; deadline: string | null; users: Set<string>; pursuing: Set<string> };
  const byNotice = new Map<string, Agg>();
  for (const r of pipe) {
    const email = (r.user_email || '').toLowerCase();
    if (!email) continue;
    let a = byNotice.get(r.notice_id);
    if (!a) { a = { title: r.title || '(untitled)', agency: r.agency, setAside: r.set_aside, deadline: r.response_deadline, users: new Set(), pursuing: new Set() }; byNotice.set(r.notice_id, a); }
    a.users.add(email);
    if ((r.stage || '').toLowerCase() === 'pursuing') a.pursuing.add(email);
  }

  // 3. Build the ranked opp list — RAW collaboration signal, no set-aside segmentation
  //    (Eric: capabilities + responding first; segmentation is Phase 2+ once there's volume).
  const opps: HeatmapOpp[] = [...byNotice.entries()].map(([noticeId, a]) => {
    const isSS = /sources sought|sources-sought|\bRFI\b/i.test(a.title);
    const trackerCount = a.users.size;
    const base = { noticeId, title: a.title, agency: a.agency, setAside: a.setAside, responseDeadline: a.deadline, isSourcesSought: isSS, trackerCount, pursuingCount: a.pursuing.size };
    const collabReady = trackerCount >= COLLAB_THRESHOLD;
    return { ...base, collabReady, collabPreview: collabReady ? buildCollabPreview({ title: a.title, trackerCount, isSourcesSought: isSS }) : null };
  }).sort((x, y) => y.trackerCount - x.trackerCount).slice(0, limit);

  return {
    generatedAt: now,
    totalTrackedOpps: byNotice.size,
    collabReadyCount: opps.filter((o) => o.collabReady).length,
    threshold: COLLAB_THRESHOLD,
    opps,
  };
}
