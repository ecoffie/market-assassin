/**
 * Target-card counts must be HONEST (audit 2026-07-27):
 *  - spend / contracts pills are gated >0 (a save-time $0/0 must not read as a real fact — ~87% of
 *    targets were saved with zeros).
 *  - open_opp_count shows the LIVE office-anchored count only; the frozen dept-wide-inflated snapshot
 *    is NOT displayed (the 'Dept of Defense = 8,000 opps' bug).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'MyTargetListPanel.tsx'), 'utf8');

describe('target card counts are gated / trustworthy', () => {
  it('spend + contracts pills are gated > 0 (no "$0 spend"/"0 contracts" as fact)', () => {
    expect(src).toContain('Number(t.set_aside_spending) > 0 &&');
    expect(src).toContain('Number(t.contract_count) > 0 &&');
  });
  it('open_opp_count uses ONLY the live count, never the stale frozen snapshot for display', () => {
    // the old fallback ": t.open_opp_count" is gone; it now resolves to null when live is absent
    expect(src).toContain('(live && live.open_opp_count !== null) ? live.open_opp_count : null');
    expect(src).not.toContain('live.open_opp_count !== null ? live.open_opp_count : t.open_opp_count');
  });
  it('the open-opps pill is null-guarded', () => {
    expect(src).toContain('oppCount !== null && oppCount > 0');
  });
});
