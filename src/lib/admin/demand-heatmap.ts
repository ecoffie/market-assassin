/**
 * Demand Heatmap — the aggregated user-intent signal behind the collaboration /
 * social-proof feature (the "aha moment").
 *
 * Aggregates which opportunities the MOST users are tracking (user_pipeline),
 * segments by socioeconomic status (set_aside_certifications), flags Sources
 * Sought (the collaboration sweet spot), and previews the "respond together"
 * collab alert — GATED on a minimum-tracker threshold so a weak signal ("1 other
 * person looking") never fires. Admin-only Phase 1: SEE the signal + control the
 * trigger before automating the user-facing viral loop.
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
  /** socioeconomic breakdown of the trackers (anonymous counts). */
  segments: Record<string, number>; // e.g. { wosb: 6, '8a': 2, sdvosb: 1 }
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

// Normalize a set_aside_certifications value (array or string) → canonical codes.
function normCerts(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : [];
  const map: Record<string, string> = {
    wosb: 'wosb', 'women': 'wosb', 'woman': 'wosb', edwosb: 'edwosb',
    '8a': '8a', '8(a)': '8a', sdvosb: 'sdvosb', 'sdvo': 'sdvosb', vosb: 'vosb',
    hubzone: 'hubzone', hz: 'hubzone', sdb: 'sdb',
  };
  return [...new Set(raw.map((s) => map[String(s).toLowerCase().trim().replace(/[^a-z0-9()]/g, '')] || null).filter(Boolean) as string[])];
}

const SEGMENT_LABEL: Record<string, string> = {
  wosb: 'women-owned businesses', edwosb: 'EDWOSBs', '8a': '8(a) firms',
  sdvosb: 'service-disabled veteran-owned businesses', vosb: 'veteran-owned businesses',
  hubzone: 'HUBZone firms', sdb: 'small disadvantaged businesses',
};

function buildCollabPreview(opp: { title: string; segments: Record<string, number>; trackerCount: number; isSourcesSought: boolean }): string {
  // Lead with the strongest socioeconomic segment if one is meaningful, else the raw count.
  const topSeg = Object.entries(opp.segments).sort((a, b) => b[1] - a[1])[0];
  const verb = opp.isSourcesSought ? 'are researching' : 'are tracking';
  if (topSeg && topSeg[1] >= 2) {
    return `${topSeg[1]} ${SEGMENT_LABEL[topSeg[0]] || topSeg[0]} ${verb} "${opp.title.slice(0, 60)}". Respond to the Sources Sought together — collaborate or team to strengthen the response.`;
  }
  return `${opp.trackerCount} contractors ${verb} "${opp.title.slice(0, 60)}". You're not the only one — respond to the Sources Sought before it closes.`;
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

  // 3. Socioeconomic status per tracking user (one lookup for all involved emails).
  const allEmails = [...new Set(pipe.map((r) => (r.user_email || '').toLowerCase()).filter(Boolean))];
  const certsByEmail = new Map<string, string[]>();
  for (let i = 0; i < allEmails.length; i += 300) {
    const chunk = allEmails.slice(i, i + 300);
    const { data: u } = await client
      .from('user_notification_settings')
      .select('user_email, business_type, set_aside_certifications')
      .in('user_email', chunk);
    for (const row of u || []) {
      certsByEmail.set((row.user_email || '').toLowerCase(), normCerts(row.set_aside_certifications));
    }
  }

  // 4. Build the ranked opp list with segments + collab preview.
  const opps: HeatmapOpp[] = [...byNotice.entries()].map(([noticeId, a]) => {
    const segments: Record<string, number> = {};
    for (const email of a.users) for (const cert of certsByEmail.get(email) || []) segments[cert] = (segments[cert] || 0) + 1;
    const isSS = /sources sought|sources-sought|\bRFI\b/i.test(a.title);
    const trackerCount = a.users.size;
    const base = { noticeId, title: a.title, agency: a.agency, setAside: a.setAside, responseDeadline: a.deadline, isSourcesSought: isSS, trackerCount, pursuingCount: a.pursuing.size, segments };
    const collabReady = trackerCount >= COLLAB_THRESHOLD;
    return { ...base, collabReady, collabPreview: collabReady ? buildCollabPreview({ title: a.title, segments, trackerCount, isSourcesSought: isSS }) : null };
  }).sort((x, y) => y.trackerCount - x.trackerCount).slice(0, limit);

  return {
    generatedAt: now,
    totalTrackedOpps: byNotice.size,
    collabReadyCount: opps.filter((o) => o.collabReady).length,
    threshold: COLLAB_THRESHOLD,
    opps,
  };
}
