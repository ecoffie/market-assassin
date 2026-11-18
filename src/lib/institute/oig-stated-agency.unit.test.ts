import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOversightOpenRecommendations } from './acquired-pain-points';
import {
  OIG_STATED_NOT_CANONICAL,
  resolveOversightStatedAgency,
} from './oig-stated-agency';

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

  it('leaves CPSC, ARC, and the Election Assistance Commission unresolved', () => {
    for (const row of OIG_STATED_NOT_CANONICAL) {
      const resolved = resolveOversightStatedAgency(row.stated);
      expect(resolved.resolved, row.stated).toBe(false);
      expect(resolved.canonicalAgency).toBeNull();
    }
    // The EAC page names Justice as the place to report election crime.
    // That sentence is not a parent-agency relationship.
    expect(resolveOversightStatedAgency('Election Assistance Commission').canonicalAgency).toBeNull();
    expect(resolveOversightStatedAgency('Department of Justice').canonicalAgency).toBe('Department of Justice');
  });
});
