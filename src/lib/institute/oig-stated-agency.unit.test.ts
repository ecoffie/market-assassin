import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOversightOpenRecommendations } from './acquired-pain-points';
import {
  OIG_SELF_NAMED,
  resolveOversightStatedAgency,
} from './oig-stated-agency';
import { resolveAgency } from '@/lib/strategic-intel/agency-resolver';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('the 14 unresolved page-0 recommendations', () => {
  const docs = parseOversightOpenRecommendations(fixture('oversight-itc-recommendations.html'));

  it('maps the seven International Trade Commission recommendations onto USITC', () => {
    expect(docs).toHaveLength(7);
    for (const doc of docs) {
      expect(doc.agencyAsStated).toBe('International Trade Commission');
      const resolved = resolveOversightStatedAgency(doc.agencyAsStated);
      expect(resolved.resolved).toBe(true);
      expect(resolved.canonicalAgency).toBe('U.S. International Trade Commission');
      expect(resolved.method).toBe('alias');
      expect(resolved.note).toMatch(/U\.S\. International Trade Commission programs and operations/);
    }
  });

  it('maps CPSC, ARC, and the Election Assistance Commission to themselves', () => {
    expect(OIG_SELF_NAMED.map((row) => row.stated)).toEqual([
      'Consumer Product Safety Commission',
      'Appalachian Regional Commission',
      'Election Assistance Commission',
    ]);
    for (const row of OIG_SELF_NAMED) {
      const resolved = resolveOversightStatedAgency(row.stated);
      expect(resolved.resolved, row.stated).toBe(true);
      expect(resolved.canonicalAgency).toBe(row.stated);
      expect(resolved.method).toBe('exact_name');
      expect(resolved.toptierCode).toBe(row.code);
      expect(resolved.note).toContain(row.code);
    }
    // The EAC page names Justice as the place to report election crime.
    // That sentence does not move the EAC recommendations onto Justice.
    expect(resolveOversightStatedAgency('Election Assistance Commission').canonicalAgency)
      .toBe('Election Assistance Commission');
    expect(resolveAgency({ toptierCode: '061' }).canonicalAgency)
      .toBe('Consumer Product Safety Commission');
    expect(resolveAgency({ toptierCode: '034' }).canonicalAgency)
      .toBe('U.S. International Trade Commission');
  });
});
