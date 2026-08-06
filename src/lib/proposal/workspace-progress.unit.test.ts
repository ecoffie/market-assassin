import { describe, it, expect } from 'vitest';
import {
  sectionProgressFromDraft,
  complianceProgress,
  overallProgress,
  teamFromComplianceOwners,
  DRAFT_WORD_FLOOR,
  IN_PROGRESS_PCT,
} from './workspace-progress';

describe('sectionProgressFromDraft — grounded per-section %', () => {
  it('no draft → 0 / pending (never a guess)', () => {
    expect(sectionProgressFromDraft(null)).toEqual({ pct: 0, state: 'pending' });
    expect(sectionProgressFromDraft(undefined)).toEqual({ pct: 0, state: 'pending' });
    expect(sectionProgressFromDraft({ section: 'technical' })).toEqual({ pct: 0, state: 'pending' });
  });

  it('empty draft body → 0 / pending', () => {
    expect(sectionProgressFromDraft({ section: 'technical', draft: '', wordCount: 0 }))
      .toEqual({ pct: 0, state: 'pending' });
  });

  it('a draft that exists (>= floor words) but is not approved → in-progress', () => {
    const words = Array.from({ length: DRAFT_WORD_FLOOR + 5 }, () => 'word').join(' ');
    const r = sectionProgressFromDraft({ section: 'technical', draft: words, wordCount: DRAFT_WORD_FLOOR + 5 });
    expect(r).toEqual({ pct: IN_PROGRESS_PCT, state: 'in_progress' });
  });

  it('a short stub draft → in-progress (started), not done', () => {
    const r = sectionProgressFromDraft({ section: 'pricing', draft: 'a b c', wordCount: 3 });
    expect(r).toEqual({ pct: IN_PROGRESS_PCT, state: 'in_progress' });
  });

  it('an approved draft (>= floor words) → 100 / done', () => {
    const words = Array.from({ length: DRAFT_WORD_FLOOR + 1 }, () => 'x').join(' ');
    expect(sectionProgressFromDraft({ section: 'exec_summary', draft: words, wordCount: DRAFT_WORD_FLOOR + 1, approved: true }))
      .toEqual({ pct: 100, state: 'done' });
    expect(sectionProgressFromDraft({ section: 'exec_summary', draft: words, wordCount: DRAFT_WORD_FLOOR + 1, status: 'approved' }))
      .toEqual({ pct: 100, state: 'done' });
  });

  it('approved but too short → still in-progress (word floor guards it)', () => {
    expect(sectionProgressFromDraft({ section: 'exec_summary', draft: 'a b', wordCount: 2, approved: true }))
      .toEqual({ pct: IN_PROGRESS_PCT, state: 'in_progress' });
  });

  it('falls back to counting words when wordCount is absent', () => {
    const words = Array.from({ length: DRAFT_WORD_FLOOR + 2 }, () => 'w').join(' ');
    const r = sectionProgressFromDraft({ section: 'technical', draft: words });
    expect(r.state).toBe('in_progress');
  });
});

describe('complianceProgress — done/total from the real matrix', () => {
  it('empty matrix → 0 / pending / 0-of-0 (honest, never fabricated)', () => {
    expect(complianceProgress([])).toEqual({ pct: 0, state: 'pending', done: 0, total: 0 });
    expect(complianceProgress(null)).toEqual({ pct: 0, state: 'pending', done: 0, total: 0 });
  });

  it('some rows done → exact done/total percentage', () => {
    const rows = [
      { req_key: 'a', status: 'done' },
      { req_key: 'b', status: 'in_progress' },
      { req_key: 'c', status: 'open' },
      { req_key: 'd', status: 'done' },
    ];
    // 2 of 4 done → 50%
    expect(complianceProgress(rows)).toEqual({ pct: 50, state: 'in_progress', done: 2, total: 4 });
  });

  it('all done → 100 / done', () => {
    const rows = [{ status: 'done' }, { status: 'done' }];
    expect(complianceProgress(rows)).toEqual({ pct: 100, state: 'done', done: 2, total: 2 });
  });

  it('none done → 0 / pending but total counted', () => {
    const rows = [{ status: 'open' }, { status: 'in_progress' }];
    expect(complianceProgress(rows)).toEqual({ pct: 0, state: 'pending', done: 0, total: 2 });
  });
});

describe('overallProgress — mean of section %s', () => {
  it('empty → 0 (never a guess)', () => {
    expect(overallProgress([])).toBe(0);
    expect(overallProgress([NaN as unknown as number].filter(() => false))).toBe(0);
  });

  it('mean of the provided section %s (rounded)', () => {
    expect(overallProgress([100, 60, 0])).toBe(53); // 160/3 = 53.33 → 53
    expect(overallProgress([100, 100])).toBe(100);
    expect(overallProgress([0, 0, 0])).toBe(0);
  });

  it('ignores non-finite values', () => {
    expect(overallProgress([100, NaN as unknown as number, 0])).toBe(50);
  });
});

describe('teamFromComplianceOwners — REAL owners, not a fabricated roster', () => {
  it('no owners → empty roster (honest empty state)', () => {
    expect(teamFromComplianceOwners([])).toEqual([]);
    expect(teamFromComplianceOwners(null)).toEqual([]);
    expect(teamFromComplianceOwners([{ status: 'open' }, { status: 'done' }])).toEqual([]);
    expect(teamFromComplianceOwners([{ owner: '   ' }])).toEqual([]);
  });

  it('distinct owners with per-owner counts; name = local-part; NO invented titles', () => {
    const rows = [
      { owner: 'jane@acme.com', status: 'done' },
      { owner: 'jane@acme.com', status: 'open' },
      { owner: 'BOB@acme.com', status: 'in_progress' },
      { owner: '', status: 'open' },
    ];
    const team = teamFromComplianceOwners(rows);
    expect(team).toEqual([
      { email: 'jane@acme.com', name: 'jane', count: 2 },
      { email: 'bob@acme.com', name: 'bob', count: 1 },
    ]);
    // Grounded shape only — no title/role/avatar fields fabricated.
    for (const m of team) {
      expect(Object.keys(m).sort()).toEqual(['count', 'email', 'name']);
    }
  });

  it('sorts by count desc then email', () => {
    const rows = [
      { owner: 'z@x.com' },
      { owner: 'a@x.com' },
      { owner: 'a@x.com' },
    ];
    expect(teamFromComplianceOwners(rows).map((m) => m.email)).toEqual(['a@x.com', 'z@x.com']);
  });
});
