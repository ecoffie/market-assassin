/**
 * snapshot-watchlist (#96) — the grounded aggregation contract.
 *
 * The cron reads each saved search's live matches and rolls them into ONE daily snapshot row. The
 * numbers MUST be grounded exactly like the watchlist-brief endpoint (same rules, no drift): null
 * M-Estimate medians are UNKNOWN (skipped, never $0), "new" follows the baselined-badge rule, DNA
 * counts come from the persisted opportunity_dna_keys strands, and $-by-state skips null medians.
 *
 * The cron's per-search reducer isn't exported (it's inline in the route), so this test mirrors the
 * EXACT reducer and locks the contract; the route + this mirror are asserted to agree by a
 * source-assert that the route contains the same skip/rule lines.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unseenUniqueNoticeIds } from '@/lib/opportunities/saved-search-new';

// ── Mirror of the route's per-search reducer (keep in lockstep with route.ts) ──
interface Row {
  notice_id: string | null;
  intel_value_range: { median?: number } | null;
  pop_state: string | null;
  office_address: { state?: string } | null;
  department: string | null;
  sub_tier: string | null;
  opportunity_dna_keys: string[] | null;
}
function normState(s: string): string | null {
  const v = (s || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null; // test-local; the route uses normalizeStateCode
}
function reduce(list: Row[], seen: Set<string>, lastAlertedAt?: string | null) {
  const newCount = unseenUniqueNoticeIds(
    list.map((r) => r.notice_id),
    [...seen],
    { lastAlertedAt },
  ).length;
  let marketValue = 0;
  const agencies = new Set<string>();
  const stateDist: Record<string, number> = {};
  const dnaCounts: Record<string, number> = {};
  for (const r of list) {
    const m = r.intel_value_range && typeof r.intel_value_range.median === 'number' ? r.intel_value_range.median : 0;
    const validM = Number.isFinite(m) && m > 0 ? m : 0;
    if (validM > 0) {
      marketValue += validM;
      const st = normState(r.pop_state || r.office_address?.state || '');
      if (st) stateDist[st] = (stateDist[st] || 0) + validM;
    }
    const ag = r.sub_tier || r.department;
    if (ag) agencies.add(ag);
    for (const k of (Array.isArray(r.opportunity_dna_keys) ? r.opportunity_dna_keys : [])) dnaCounts[k] = (dnaCounts[k] || 0) + 1;
  }
  return { matchedCount: list.length, newCount, marketValue, agencyCount: agencies.size, stateDist, dnaCounts };
}

const rows: Row[] = [
  { notice_id: 'a', intel_value_range: { median: 6_200_000 }, pop_state: 'VA', office_address: null, department: 'DOD', sub_tier: 'Army', opportunity_dna_keys: ['repeat_buyer', 'sb_friendly'] },
  { notice_id: 'b', intel_value_range: { median: 1_800_000 }, pop_state: null, office_address: { state: 'VA' }, department: 'VA', sub_tier: null, opportunity_dna_keys: ['repeat_buyer'] },
  { notice_id: 'c', intel_value_range: null, pop_state: 'TX', office_address: null, department: 'DOD', sub_tier: 'Navy', opportunity_dna_keys: ['sources_sought'] }, // null median → UNKNOWN
  { notice_id: 'd', intel_value_range: { median: 0 }, pop_state: 'TX', office_address: null, department: 'DOD', sub_tier: 'Navy', opportunity_dna_keys: [] },          // 0 median → skipped
];

describe('snapshot-watchlist reducer — grounded, no fabrication', () => {
  it('market_value SUMS only finite >0 medians; null/0 are skipped (never $0-counted)', () => {
    const r = reduce(rows, new Set());
    expect(r.marketValue).toBe(8_000_000); // 6.2M + 1.8M only (c null, d zero skipped)
  });
  it('state_distribution uses pop_state ELSE office state, skips null-median rows', () => {
    const r = reduce(rows, new Set());
    expect(r.stateDist).toEqual({ VA: 8_000_000 }); // a(VA)+b(office VA); c/d contribute no $ (TX has only null/0 medians)
  });
  it('agency_count = distinct sub_tier||department across matches (incl. null-value rows)', () => {
    const r = reduce(rows, new Set());
    // Army, VA (dept, no sub_tier), Navy → 3 distinct
    expect(r.agencyCount).toBe(3);
  });
  it('dna_counts tallies every persisted strand across all matches', () => {
    const r = reduce(rows, new Set());
    expect(r.dnaCounts).toEqual({ repeat_buyer: 2, sb_friendly: 1, sources_sought: 1 });
  });
  it('new_count follows the baselined-badge rule: 0 when never baselined, else unique unseen matches', () => {
    expect(reduce(rows, new Set()).newCount).toBe(0);                    // no seen ids → never baselined → 0
    expect(reduce(rows, new Set(['a', 'b'])).newCount).toBe(2);          // c, d are unseen
    const duped = [...rows, rows[0]];
    expect(reduce(duped, new Set(['z'])).newCount).toBe(4);              // duplicate 'a' counts once
  });
  it('matched_count is the raw match total', () => {
    expect(reduce(rows, new Set()).matchedCount).toBe(4);
  });
});

describe('the route wires those exact grounded rules', () => {
  const src = readFileSync(join(__dirname, 'snapshot-watchlist/route.ts'), 'utf8');
  it('reuses the shared map filter engine (no drift from the badge/alert cron)', () => {
    expect(src).toContain('parseMapFilters');
    expect(src).toContain('applyMapFilters');
  });
  it('skips null/≤0 medians (a null M-Estimate is UNKNOWN, never $0)', () => {
    expect(src).toMatch(/Number\.isFinite\(m\) && m > 0 \? m : 0/);
    expect(src).toMatch(/if \(validM > 0\)/);
  });
  it('is idempotent — upserts on (saved_search_id, snapshot_date)', () => {
    expect(src).toMatch(/onConflict: 'saved_search_id,snapshot_date'/);
  });
  it('degrades clean when the table is missing (ships before the hand-run migration)', () => {
    expect(src).toContain('tableMissing');
    expect(src).toMatch(/skipped: 'table_missing'/);
  });
  it('new_count uses the shared unique-unseen helper (same badge/brief rule, no row-double-count)', () => {
    expect(src).toContain('unseenUniqueNoticeIds');
    expect(src).toContain('SAVED_SEARCH_MATCH_CAP');
  });
  it('is dispatcher-fired: a plain GET, registered via a cron_jobs row (not a vercel.json cron)', () => {
    // A cron route is fired by the dispatcher (a cron_jobs row); the route itself is just a GET
    // handler. It must NOT carry a vercel cron `export const config` schedule (that path is banned —
    // the 100-cron cap blocks the whole deploy). Comments may MENTION vercel.json to explain the rule.
    expect(src).toContain('export async function GET');
    expect(src).not.toMatch(/export const config\s*=/);
    expect(src).not.toMatch(/schedule:\s*['"]/); // no inline cron schedule literal
  });
});
