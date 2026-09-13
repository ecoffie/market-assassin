import { describe, it, expect } from 'vitest';
import { isDefensiblePainPoint, deriveFromInstituteSource } from './derive';
import { resolveAgency } from './agency-resolver';

const resolved = resolveAgency({ agencyName: 'Department of Homeland Security' });
const unresolved = resolveAgency({ agencyName: 'Ministry of Magic' });

describe('derivation — REPORT EXISTS is not PAIN POINT EXISTS', () => {
  it('declines when the agency is unresolved', () => {
    expect(isDefensiblePainPoint('Improvements Needed in oversight', unresolved)).toBe(false);
  });

  it('declines a neutral status report even with a resolved agency', () => {
    expect(isDefensiblePainPoint('Priority Open Recommendations: Department of State', resolved)).toBe(false);
  });

  it('accepts a problem-stating finding with a resolved agency', () => {
    expect(isDefensiblePainPoint('Chemical Security: DHS Should Provide Options', resolved)).toBe(true);
  });
});

function stubDb(opts: { priorClaim?: boolean; failHistory?: boolean } = {}) {
  const ops: string[] = [];
  return {
    ops,
    db: {
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain; chain.eq = () => chain;
        chain.maybeSingle = async () => ({ data: opts.priorClaim ? { id: 'pp-1' } : null, error: null });
        chain.insert = async () => {
          ops.push(`insert:${table}`);
          return table === 'intelligence_changes' && opts.failHistory
            ? { error: { message: 'history store unavailable' } }
            : { error: null };
        };
        return chain;
      },
    } as never,
  };
}

const src = {
  instituteSourceId: 'src-1',
  documentNumber: 'GAO-26-108127',
  title: 'Chemical Security: DHS Should Provide Options',
  url: 'https://www.gao.gov/products/gao-26-108127',
  resolution: resolved,
};

describe('derivation — history before state', () => {
  it('evidence-only when unresolved: no claim, no history', async () => {
    const { ops, db } = stubDb();
    const r = await deriveFromInstituteSource(db, { ...src, resolution: unresolved });
    expect(r.outcome).toBe('evidence_only_unresolved');
    expect(ops).toHaveLength(0);
  });

  it('creates the change record BEFORE the claim', async () => {
    const { ops, db } = stubDb();
    const r = await deriveFromInstituteSource(db, src);
    expect(r.outcome).toBe('pain_point_created');
    expect(r.changeLogged).toBe(true);
    expect(ops.indexOf('insert:intelligence_changes')).toBeLessThan(ops.indexOf('insert:agency_pain_points_db'));
  });

  it('DERIVED STATE CANNOT ADVANCE WHEN HISTORY FAILS', async () => {
    const { ops, db } = stubDb({ failHistory: true });
    const r = await deriveFromInstituteSource(db, src);
    expect(r.outcome).toBe('blocked_history_unavailable');
    expect(ops).not.toContain('insert:agency_pain_points_db');
  });

  it('an already-claimed finding logs no duplicate history', async () => {
    const { ops, db } = stubDb({ priorClaim: true });
    const r = await deriveFromInstituteSource(db, src);
    expect(r.outcome).toBe('pain_point_unchanged');
    expect(ops).toHaveLength(0);
  });

  it('links the claim back to the Institute evidence id', async () => {
    const { db } = stubDb();
    const r = await deriveFromInstituteSource(db, src);
    expect(r.entityKey).toContain('Department of Homeland Security');
  });
});
