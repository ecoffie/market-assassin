import { describe, it, expect } from 'vitest';
import {
  deriveSourceState, resolveIntervention, needsIntervention, buildManualAlert,
  type ManualSourceContract, type ManualSourceObservation, type InterventionRecord,
} from './manual-source-ops';

const obs = (o: Partial<ManualSourceObservation> = {}): ManualSourceObservation => ({
  lastChecked: '2026-09-13T00:00:00Z',
  latestUpstream: 'FY26-Q3',
  heldByMindy: 'FY26-Q3',
  upstreamReadable: true,
  ...o,
});

const navy: ManualSourceContract = {
  sourceKey: 'navy_lrae',
  displayName: 'Navy LRAE forecast',
  actionType: 'identity_resolution',
  owner: 'eric',
  runbookPath: 'docs/runbooks/navy-lrae.md',
  expectedCadenceDays: 90,
};

describe('source state — data facts only', () => {
  it('1. never checked is unmeasured, NOT current', () => {
    expect(deriveSourceState(obs({ lastChecked: null }))).toBe('unmeasured');
  });

  it('2. held == latest upstream is current', () => {
    expect(deriveSourceState(obs())).toBe('current');
  });

  it('3. upstream ahead of held is content_stale', () => {
    expect(deriveSourceState(obs({ latestUpstream: 'FY26-Q4' }))).toBe('content_stale');
  });

  it('4. unreadable upstream is unreachable, not stale and not current', () => {
    const s = deriveSourceState(obs({ upstreamReadable: false }));
    expect(s).toBe('unreachable');
    expect(s).not.toBe('current');
  });

  it('5. holding nothing at all is content_stale', () => {
    expect(deriveSourceState(obs({ heldByMindy: null }))).toBe('content_stale');
  });
});

describe('the load-bearing guard — acknowledging is not fixing', () => {
  const open: InterventionRecord = { state: 'required', openedAtHeld: 'FY26-Q3', openedAt: '2026-09-01T00:00:00Z' };

  it('6. REFUSES to clear when the data did not move', () => {
    const r = resolveIntervention(open, { heldBefore: 'FY26-Q3', heldAfter: 'FY26-Q3' }, 'FY26-Q4');
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe('no_advance_observed');
  });

  it('7. clears only on a VERIFIED advance to the newest upstream', () => {
    const r = resolveIntervention(open, { heldBefore: 'FY26-Q3', heldAfter: 'FY26-Q4' }, 'FY26-Q4');
    expect(r.cleared).toBe(true);
    expect(r.state).toBe('completed');
  });

  it('8. partial progress stays open — advanced but still behind upstream', () => {
    const r = resolveIntervention(open, { heldBefore: 'FY26-Q2', heldAfter: 'FY26-Q3' }, 'FY26-Q4');
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe('still_behind_upstream');
  });
});

describe('the two states are orthogonal', () => {
  it('9. in_progress suppresses nagging without claiming the data is fresh', () => {
    expect(needsIntervention('content_stale', 'in_progress')).toBe(false);
    // but the DATA is still stale — the source state is untouched by the ack
    expect(deriveSourceState(obs({ latestUpstream: 'FY26-Q4' }))).toBe('content_stale');
  });

  it('10. upstream_quiet needs no human — Mindy is not behind', () => {
    expect(needsIntervention('upstream_quiet', 'none_required')).toBe(false);
  });

  it('11. unmeasured DOES need a human (silence is not health)', () => {
    expect(needsIntervention('unmeasured', 'none_required')).toBe(true);
  });
});

describe('the message must be true', () => {
  it('12. Navy says identity unresolved and NEVER promises an upload fixes it', () => {
    const a = buildManualAlert(navy, 'content_stale', 'required', obs({ latestUpstream: 'FY26-Q4' }));
    const body = a.bodyLines.join('\n');
    expect(body).toContain('Automated ingest: DISABLED — identity contract unresolved');
    expect(body).toContain('CANNOT be refreshed by uploading a newer file');
    expect(body).not.toMatch(/upload the new .* workbook and refresh/i);
  });

  it('13. a PROVEN procedure reads as a routine refresh, not as blocked', () => {
    const routine = { ...navy, sourceKey: 'x', actionType: 'refresh_upload' as const };
    const a = buildManualAlert(routine, 'content_stale', 'required', obs());
    const body = a.bodyLines.join('\n');
    expect(body).toContain('manual refresh required');
    expect(body).not.toContain('CANNOT be refreshed');
  });

  it('14. fingerprint tracks the SITUATION so a dupe suppresses but a change re-fires', () => {
    const base = buildManualAlert(navy, 'content_stale', 'required', obs({ latestUpstream: 'FY26-Q4' }));
    const same = buildManualAlert(navy, 'content_stale', 'required', obs({ latestUpstream: 'FY26-Q4' }));
    const moved = buildManualAlert(navy, 'content_stale', 'required', obs({ latestUpstream: 'FY27-Q1' }));
    expect(same.fingerprintParts).toEqual(base.fingerprintParts);
    expect(moved.fingerprintParts).not.toEqual(base.fingerprintParts);
  });

  it('15. a missing owner or runbook is stated, never silently blank', () => {
    const orphan = { ...navy, owner: null, runbookPath: null };
    const body = buildManualAlert(orphan, 'content_stale', 'required', obs()).bodyLines.join('\n');
    expect(body).toContain('UNASSIGNED');
    expect(body).toContain('NONE RECORDED');
  });
});

describe('REGRESSION — a matching revision is not a current source', () => {
  const navyObs = {
    lastChecked: '2026-09-13T00:00:00Z',
    latestUpstream: '02.2026',
    heldByMindy: '02.2026',   // identical strings
    upstreamReadable: true,
  };

  it('16. THE NAVY CASE: same revision, 9,922 upstream vs 8,821 held -> content_stale', () => {
    expect(deriveSourceState({ ...navyObs, upstreamPopulation: 9922, heldPopulation: 8821 }))
      .toBe('content_stale');
  });

  it('17. without populations the same input WOULD read current (why the field exists)', () => {
    expect(deriveSourceState(navyObs)).toBe('current');
  });

  it('18. a half-measured population is not equality — never current', () => {
    expect(deriveSourceState({ ...navyObs, upstreamPopulation: 9922, heldPopulation: null })).toBe('unmeasured');
    expect(deriveSourceState({ ...navyObs, upstreamPopulation: null, heldPopulation: 8821 })).toBe('unmeasured');
    expect(deriveSourceState({ ...navyObs, upstreamPopulation: 9922 })).toBe('unmeasured');
  });

  it('19. equal populations with an equal revision IS current', () => {
    expect(deriveSourceState({ ...navyObs, upstreamPopulation: 8821, heldPopulation: 8821 })).toBe('current');
  });

  it('20. a population move re-fires the alert (fingerprint includes counts)', () => {
    const c = { ...navy, actionType: 'identity_resolution' as const };
    const a = buildManualAlert(c, 'content_stale', 'required', { ...navyObs, upstreamPopulation: 9922, heldPopulation: 8821 });
    const b = buildManualAlert(c, 'content_stale', 'required', { ...navyObs, upstreamPopulation: 10500, heldPopulation: 8821 });
    expect(a.fingerprintParts).not.toEqual(b.fingerprintParts);
    expect(a.bodyLines.join('\n')).toContain('Upstream rows: 9922 | Held rows: 8821');
  });
});
