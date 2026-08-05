import { describe, it, expect } from 'vitest';
import { computeVaultCompleteness, pastPerfProvenanceLabel } from './completeness';

describe('computeVaultCompleteness — 7 checks -> pct + first-3-missing', () => {
  it('empty vault = 0% and first 3 missing are identity/certs/one-liner (check order)', () => {
    const r = computeVaultCompleteness({});
    expect(r.doneCount).toBe(0);
    expect(r.pct).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.missing.map((m) => m.label)).toEqual([
      'Add your legal name + UEI',
      'List your certifications',
      'Write your one-liner',
    ]);
  });

  it('all 7 done = 100% and no missing', () => {
    const r = computeVaultCompleteness({
      identity: { legal_name: 'Acme Federal LLC', uei: 'ABC123DEF456', one_liner: 'We do cyber', certifications: ['8(a)'] },
      past_performance: [{}],
      capabilities: [{}],
      team: [{}],
      documents: [{}],
    });
    expect(r.doneCount).toBe(7);
    expect(r.pct).toBe(100);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('the grounded mock (identity full, PP, caps, 0 team, 1 doc) -> 86% with Key Personnel among missing', () => {
    // 6 of 7 done (team is the only gap) -> round(6/7*100) = 86
    const r = computeVaultCompleteness({
      identity: { legal_name: 'Egan Rose Group', uei: 'EGRS12345678', cage_code: '9ABC1', one_liner: 'Compliance ops', certifications: ['SDVOSB', 'HUBZone'] },
      past_performance: [{ source: 'manual' }, { source: 'parsed_cap_stmt' }],
      capabilities: [{}, {}],
      team: [],
      documents: [{}],
    });
    expect(r.doneCount).toBe(6);
    expect(r.pct).toBe(86);
    expect(r.complete).toBe(false);
    expect(r.missing.map((m) => m.label)).toEqual(['Add key personnel']);
    expect(r.missing[0].section).toBe('team');
  });

  it('legal_name without uei does NOT satisfy check 1 (needs BOTH)', () => {
    const r = computeVaultCompleteness({ identity: { legal_name: 'Acme', uei: '' } });
    expect(r.checks[0].done).toBe(false);
  });

  it('whitespace-only strings do not count as present', () => {
    const r = computeVaultCompleteness({ identity: { legal_name: '   ', uei: '   ', one_liner: '  ' } });
    expect(r.checks[0].done).toBe(false);
    expect(r.checks[2].done).toBe(false);
  });

  it('caps at 4 missing but returns only first 3 (slice)', () => {
    const r = computeVaultCompleteness({ identity: { legal_name: 'Acme', uei: 'ABC123DEF456' } });
    // check1 done; 2,3,4,5,6,7 not done -> 6 missing, sliced to 3
    expect(r.missing.length).toBe(3);
    expect(r.missing.map((m) => m.label)).toEqual([
      'List your certifications',
      'Write your one-liner',
      'Add past performance',
    ]);
  });
});

describe('pastPerfProvenanceLabel — source column -> badge, NEVER SAM-matched', () => {
  it('manual -> Self-added', () => {
    expect(pastPerfProvenanceLabel('manual')).toBe('Self-added');
  });
  it('parsed_cap_stmt -> From cap statement', () => {
    expect(pastPerfProvenanceLabel('parsed_cap_stmt')).toBe('From cap statement');
  });
  it('bulk_upload -> Imported', () => {
    expect(pastPerfProvenanceLabel('bulk_upload')).toBe('Imported');
  });
  it('null/undefined/unknown -> Self-added (honest hand-entered default)', () => {
    expect(pastPerfProvenanceLabel(null)).toBe('Self-added');
    expect(pastPerfProvenanceLabel(undefined)).toBe('Self-added');
    expect(pastPerfProvenanceLabel('something_else')).toBe('Self-added');
  });
  it('never returns a SAM-matched label for any input', () => {
    const inputs = ['manual', 'parsed_cap_stmt', 'bulk_upload', 'sam', 'sam_matched', 'SAM-matched', null, ''];
    for (const i of inputs) {
      expect(pastPerfProvenanceLabel(i)).not.toMatch(/sam/i);
    }
  });
});
