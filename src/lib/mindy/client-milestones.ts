/**
 * Capability Milestones (PRD-capability-milestones-funder-report).
 *
 * Each managed client business (an org_client / workspace) progresses through 5
 * capability milestones. TWO are auto-detected from the client's existing pipeline data;
 * THREE are counselor-marked (no data source exists for them, so we NEVER fabricate them).
 *
 *   auto:   first_bid        = earliest pursuit reaching stage 'submitted'
 *           first_award      = earliest pursuit reaching stage 'won'
 *   manual: sam_registration | certification | capability_statement
 *
 * ISOLATION (PRD §8a): detection is READ-ONLY on shared tables (user_pipeline). All writes
 * land ONLY in client_milestones. This module never mutates user_pipeline or any other
 * shared/existing table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const MILESTONE_KEYS = [
  'sam_registration',
  'certification',
  'capability_statement',
  'first_bid',
  'first_award',
] as const;

export type MilestoneKey = (typeof MILESTONE_KEYS)[number];

export const AUTO_MILESTONES: MilestoneKey[] = ['first_bid', 'first_award'];
export const MANUAL_MILESTONES: MilestoneKey[] = [
  'sam_registration',
  'certification',
  'capability_statement',
];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  sam_registration: 'SAM registration',
  certification: 'Certification (WOSB/HUBZone/8a)',
  capability_statement: 'Capability statement',
  first_bid: 'First bid',
  first_award: 'First award',
};

export interface MilestoneState {
  key: MilestoneKey;
  label: string;
  achieved: boolean;
  achievedAt: string | null;
  source: 'auto' | 'manual';
  markedBy?: string | null;
}

interface MilestoneRow {
  milestone_key: string;
  achieved_at: string | null;
  source: string;
  marked_by: string | null;
}

/**
 * Compute the first-bid / first-award dates for a set of client workspaces from
 * user_pipeline. Returns a map: workspace_id -> { first_bid?, first_award? } (ISO dates).
 * READ-ONLY. Batched by `workspace_id IN (...)` — no per-client N+1.
 */
export async function detectAutoMilestones(
  supabase: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, { first_bid?: string; first_award?: string }>> {
  const out = new Map<string, { first_bid?: string; first_award?: string }>();
  if (!workspaceIds.length) return out;

  // Pull every submitted/won pursuit across these workspaces. `submitted` and `won` are
  // terminal-ish stages; a pursuit currently at `won` also passed through `submitted`, so
  // for first_bid we count any pursuit whose stage is at/after submitted.
  const BID_STAGES = ['submitted', 'won', 'lost']; // reached a bid submission
  const { data: rows } = await supabase
    .from('user_pipeline')
    .select('workspace_id, stage, outcome_date, created_at, updated_at')
    .in('workspace_id', workspaceIds);

  for (const r of (rows || []) as Array<Record<string, unknown>>) {
    const ws = r.workspace_id as string;
    const stage = (r.stage as string) || '';
    // Milestone date: prefer outcome_date (set on won/lost), else updated_at, else created_at.
    const when =
      (r.outcome_date as string) ||
      (r.updated_at as string) ||
      (r.created_at as string) ||
      null;
    if (!when) continue;

    const cur = out.get(ws) || {};
    if (BID_STAGES.includes(stage)) {
      if (!cur.first_bid || when < cur.first_bid) cur.first_bid = when;
    }
    if (stage === 'won') {
      if (!cur.first_award || when < cur.first_award) cur.first_award = when;
    }
    out.set(ws, cur);
  }
  return out;
}

/**
 * Build the full 5-milestone state for one client, merging stored client_milestones rows
 * (the manual marks + any persisted auto stamps) with freshly-detected auto dates.
 * The detected auto date wins for auto milestones if earlier/newer than stored; manual
 * milestones come only from stored rows.
 */
export function buildMilestoneState(
  storedRows: MilestoneRow[],
  autoDetected: { first_bid?: string; first_award?: string } | undefined,
): MilestoneState[] {
  const byKey = new Map<string, MilestoneRow>();
  for (const r of storedRows) byKey.set(r.milestone_key, r);

  return MILESTONE_KEYS.map((key): MilestoneState => {
    const isAuto = AUTO_MILESTONES.includes(key);
    if (isAuto) {
      const detected =
        key === 'first_bid' ? autoDetected?.first_bid : autoDetected?.first_award;
      const stored = byKey.get(key);
      // Auto: use the earliest known date (detected or previously persisted). Idempotent —
      // an already-set earlier date is never pushed later.
      const dates = [detected, stored?.achieved_at].filter(Boolean) as string[];
      const achievedAt = dates.length ? dates.sort()[0] : null;
      return {
        key,
        label: MILESTONE_LABELS[key],
        achieved: !!achievedAt,
        achievedAt,
        source: 'auto',
      };
    }
    // Manual: only stored counselor marks.
    const stored = byKey.get(key);
    return {
      key,
      label: MILESTONE_LABELS[key],
      achieved: !!stored?.achieved_at,
      achievedAt: stored?.achieved_at || null,
      source: 'manual',
      markedBy: stored?.marked_by || null,
    };
  });
}

/**
 * Persist newly-detected auto milestones into client_milestones (upsert). Only writes when
 * a workspace has a detected date not yet stored. WRITES ONLY to client_milestones.
 * Returns the number of milestone rows upserted.
 */
export async function persistAutoMilestones(
  supabase: SupabaseClient,
  clients: Array<{ org_client_id: string; workspace_id: string }>,
  autoByWs: Map<string, { first_bid?: string; first_award?: string }>,
): Promise<number> {
  const upserts: Array<Record<string, unknown>> = [];
  for (const c of clients) {
    const detected = autoByWs.get(c.workspace_id);
    if (!detected) continue;
    if (detected.first_bid) {
      upserts.push({
        org_client_id: c.org_client_id,
        workspace_id: c.workspace_id,
        milestone_key: 'first_bid',
        achieved_at: detected.first_bid,
        source: 'auto',
        updated_at: new Date().toISOString(),
      });
    }
    if (detected.first_award) {
      upserts.push({
        org_client_id: c.org_client_id,
        workspace_id: c.workspace_id,
        milestone_key: 'first_award',
        achieved_at: detected.first_award,
        source: 'auto',
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (!upserts.length) return 0;
  // onConflict on the unique (org_client_id, milestone_key). ignoreDuplicates:false so an
  // updated (earlier) detection refreshes the row; DB-side we still only ever move dates
  // earlier because buildMilestoneState sorts ascending before display.
  await supabase
    .from('client_milestones')
    .upsert(upserts, { onConflict: 'org_client_id,milestone_key' });
  return upserts.length;
}
