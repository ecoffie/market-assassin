import { describe, it, expect } from 'vitest';
import {
  buildMilestoneState,
  MILESTONE_KEYS,
  AUTO_MILESTONES,
  MANUAL_MILESTONES,
} from './client-milestones';

/**
 * Milestone state powers the GCAP funder-report wedge. The risk is (1) an auto date moving
 * LATER on re-detection (breaks idempotence → wrong funder numbers) and (2) a manual
 * milestone getting fabricated from data (rule #1 — never invent a milestone). Locked here.
 */

describe('buildMilestoneState — 5 keys, correct source split', () => {
  it('always returns all 5 milestones in order', () => {
    const s = buildMilestoneState([], undefined);
    expect(s.map((m) => m.key)).toEqual([...MILESTONE_KEYS]);
  });

  it('tags auto vs manual correctly', () => {
    const s = buildMilestoneState([], undefined);
    for (const m of s) {
      if (AUTO_MILESTONES.includes(m.key)) expect(m.source).toBe('auto');
      if (MANUAL_MILESTONES.includes(m.key)) expect(m.source).toBe('manual');
    }
  });
});

describe('auto milestones — first_bid / first_award from detection', () => {
  it('surfaces a detected first_bid date', () => {
    const s = buildMilestoneState([], { first_bid: '2026-03-01T00:00:00Z' });
    const bid = s.find((m) => m.key === 'first_bid')!;
    expect(bid.achieved).toBe(true);
    expect(bid.achievedAt).toBe('2026-03-01T00:00:00Z');
  });

  it('idempotence: a stored EARLIER date is never pushed later by a newer detection', () => {
    const stored = [
      { milestone_key: 'first_award', achieved_at: '2026-01-10T00:00:00Z', source: 'auto', marked_by: null },
    ];
    const s = buildMilestoneState(stored, { first_award: '2026-06-01T00:00:00Z' });
    const award = s.find((m) => m.key === 'first_award')!;
    // earliest of stored(Jan) vs detected(Jun) → Jan
    expect(award.achievedAt).toBe('2026-01-10T00:00:00Z');
  });

  it('detection earlier than stored wins (backfill of an older bid)', () => {
    const stored = [
      { milestone_key: 'first_bid', achieved_at: '2026-05-01T00:00:00Z', source: 'auto', marked_by: null },
    ];
    const s = buildMilestoneState(stored, { first_bid: '2026-02-01T00:00:00Z' });
    expect(s.find((m) => m.key === 'first_bid')!.achievedAt).toBe('2026-02-01T00:00:00Z');
  });

  it('no detection + no stored → auto milestone is simply not achieved (not fabricated)', () => {
    const s = buildMilestoneState([], undefined);
    const bid = s.find((m) => m.key === 'first_bid')!;
    expect(bid.achieved).toBe(false);
    expect(bid.achievedAt).toBeNull();
  });
});

describe('manual milestones — only from counselor marks, never from data', () => {
  it('manual milestone stays unachieved with no stored row, even if auto data exists', () => {
    const s = buildMilestoneState([], { first_bid: '2026-03-01T00:00:00Z' });
    for (const key of MANUAL_MILESTONES) {
      const m = s.find((x) => x.key === key)!;
      expect(m.achieved).toBe(false);
      expect(m.achievedAt).toBeNull();
    }
  });

  it('reflects a stored counselor mark with markedBy', () => {
    const stored = [
      { milestone_key: 'sam_registration', achieved_at: '2026-04-15T00:00:00Z', source: 'manual', marked_by: 'coach@gcap.org' },
    ];
    const s = buildMilestoneState(stored, undefined);
    const sam = s.find((m) => m.key === 'sam_registration')!;
    expect(sam.achieved).toBe(true);
    expect(sam.achievedAt).toBe('2026-04-15T00:00:00Z');
    expect(sam.markedBy).toBe('coach@gcap.org');
  });
});
