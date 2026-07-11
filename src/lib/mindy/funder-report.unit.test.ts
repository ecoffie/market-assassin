import { describe, it, expect } from 'vitest';
import { parseQuarter, buildFunderReport, reportToCsv } from './funder-report';

describe('parseQuarter', () => {
  it('parses YYYY-Qn to a UTC quarter range', () => {
    const q = parseQuarter('2026-Q1')!;
    expect(q.label).toBe('2026-Q1');
    expect(q.startISO).toBe('2026-01-01T00:00:00.000Z');
    expect(q.endISO).toBe('2026-04-01T00:00:00.000Z');
  });
  it('Q4 wraps to next year', () => {
    const q = parseQuarter('2026-Q4')!;
    expect(q.startISO).toBe('2026-10-01T00:00:00.000Z');
    expect(q.endISO).toBe('2027-01-01T00:00:00.000Z');
  });
  it('rejects garbage', () => {
    expect(parseQuarter('2026-Q5')).toBeNull();
    expect(parseQuarter('nonsense')).toBeNull();
  });
});

describe('buildFunderReport — rollup math', () => {
  const quarter = parseQuarter('2026-Q1')!;
  const clients = [
    { businessName: 'Acme LLC', workspaceId: 'ws1', assignedCoach: 'coach@gcap.org' },
    { businessName: 'Beta Inc', workspaceId: 'ws2', assignedCoach: null },
  ];

  it('counts businesses served = client count', () => {
    const r = buildFunderReport({ quarter, orgName: 'GCAP', generatedAt: '2026-04-01T00:00:00Z', clients, milestoneRows: [], pipelineRows: [] });
    expect(r.businessesServed).toBe(2);
  });

  it('milestone reached-in-quarter only counts dates inside the quarter', () => {
    const r = buildFunderReport({
      quarter,
      orgName: 'GCAP',
      generatedAt: '2026-04-01T00:00:00Z',
      clients,
      milestoneRows: [
        { workspace_id: 'ws1', milestone_key: 'sam_registration', achieved_at: '2026-02-10T00:00:00Z' }, // in Q1
        { workspace_id: 'ws2', milestone_key: 'sam_registration', achieved_at: '2025-12-01T00:00:00Z' }, // before Q1
      ],
      pipelineRows: [],
    });
    expect(r.milestoneCounts.sam_registration).toBe(2); // both reached ever
    expect(r.milestoneReachedInQuarter.sam_registration).toBe(1); // only ws1 in Q1
  });

  it('bids and awards counted from pipeline within quarter', () => {
    const r = buildFunderReport({
      quarter,
      orgName: 'GCAP',
      generatedAt: '2026-04-01T00:00:00Z',
      clients,
      milestoneRows: [],
      pipelineRows: [
        { workspace_id: 'ws1', stage: 'submitted', outcome_date: null, updated_at: '2026-02-01T00:00:00Z', created_at: null }, // bid, Q1
        { workspace_id: 'ws1', stage: 'won', outcome_date: '2026-03-15', updated_at: null, created_at: null }, // bid + award, Q1
        { workspace_id: 'ws2', stage: 'won', outcome_date: '2025-11-01', updated_at: null, created_at: null }, // before Q1 — excluded
      ],
    });
    expect(r.totalBidsInQuarter).toBe(2); // ws1 submitted + ws1 won
    expect(r.totalAwardsInQuarter).toBe(1); // ws1 won
  });

  it('per-client rows carry milestone dates and bid/award counts', () => {
    const r = buildFunderReport({
      quarter,
      orgName: 'GCAP',
      generatedAt: '2026-04-01T00:00:00Z',
      clients,
      milestoneRows: [{ workspace_id: 'ws1', milestone_key: 'first_award', achieved_at: '2026-03-15T00:00:00Z' }],
      pipelineRows: [{ workspace_id: 'ws1', stage: 'won', outcome_date: '2026-03-15', updated_at: null, created_at: null }],
    });
    const acme = r.clients.find((c) => c.workspaceId === 'ws1')!;
    expect(acme.milestones.first_award).toBe('2026-03-15T00:00:00Z');
    expect(acme.awardsInQuarter).toBe(1);
  });
});

describe('reportToCsv', () => {
  it('emits summary + per-business rows and escapes commas', () => {
    const r = buildFunderReport({
      quarter: parseQuarter('2026-Q1')!,
      orgName: 'GCAP, Inc',
      generatedAt: '2026-04-01T00:00:00Z',
      clients: [{ businessName: 'Acme, LLC', workspaceId: 'ws1', assignedCoach: null }],
      milestoneRows: [],
      pipelineRows: [],
    });
    const csv = reportToCsv(r);
    expect(csv).toContain('Businesses served,1');
    expect(csv).toContain('"GCAP, Inc"'); // comma-quoted
    expect(csv).toContain('"Acme, LLC"');
  });
});
