/**
 * Provenance-preserving reassembly regressions.
 *
 * QA found 78 of 186 overlapping §5/§9 cell bindings rewritten to
 * assess_market_depth during a semantics-only reassemble. These tests lock the
 * preservation contract without a live BigQuery / depth re-fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { evidenceBindings, mergeCallLogs } from '../../../scripts/mrr-reassemble-from-evidence.mts';

const VS = 'src/lib/mrr/fixtures/phase1-vertical-slice-evidence.json';
const PRE = 'out/mrr/diagnostics/pre-regression-evidence.json';
const OUT = 'out/mrr/MRR-DHA_JOMIS_JMP_20260813-evidence.json';

type Cell = {
  label: string;
  evidence?: Array<{ source?: string; retrievedAt?: string; query?: unknown }>;
};

describe('MRR reassemble — provenance preservation', () => {
  it('mergeCallLogs keeps every prior call and does not invent timestamps', () => {
    const prior = [
      {
        tool: 'get_keyword_coverage',
        args: { keyword: 'modeling and simulation' },
        ok: true,
        retrievedAt: '2026-09-05T14:52:30.760Z',
      },
      {
        tool: 'assess_market_depth',
        args: { naics: '541512', set_aside: 'Small Business', limit: 50 },
        ok: true,
        retrievedAt: '2026-09-05T14:52:32.562Z',
      },
    ];
    const section = [
      {
        tool: 'assess_market_depth',
        args: { naics: '541512', set_aside: 'Small Business', limit: 50 },
        ok: true,
        evidence: {
          source: 'Mindy MCP assess_market_depth',
          retrievedAt: '2026-09-05T14:52:32.562Z',
          query: { naics: '541512' },
        },
      },
      {
        tool: 'get_pricing_intel',
        args: { naics: '541512' },
        ok: true,
        evidence: {
          source: 'Mindy MCP get_pricing_intel',
          retrievedAt: '2026-09-05T14:52:33.863Z',
          query: { naics: '541512' },
        },
      },
    ];
    const merged = mergeCallLogs(prior, section as never);
    expect(merged.map((c) => c.tool)).toEqual([
      'get_keyword_coverage',
      'assess_market_depth',
      'get_pricing_intel',
    ]);
    expect(merged.map((c) => c.evidence.retrievedAt)).toEqual([
      '2026-09-05T14:52:30.760Z',
      '2026-09-05T14:52:32.562Z',
      '2026-09-05T14:52:33.863Z',
    ]);
  });

  it('vertical-slice fixture has the original five tool calls', () => {
    expect(existsSync(VS)).toBe(true);
    const bundle = JSON.parse(readFileSync(VS, 'utf8')) as {
      calls: Array<{ tool: string; retrievedAt: string }>;
      cells: Cell[];
    };
    expect(bundle.calls.map((c) => c.tool)).toEqual([
      'derive_company_keywords',
      'get_keyword_coverage',
      'search_past_contracts',
      'search_past_contracts',
      'get_solicitation_incumbent',
    ]);
    expect(bundle.cells.length).toBe(186);
    const market = bundle.cells.find((c) => c.label === '§5 Measured market total');
    expect(market?.evidence?.[0]?.source).toContain('get_keyword_coverage');
    const size = bundle.cells.find((c) => c.label === '§5 SBA size standard');
    expect(size?.evidence?.[0]?.source).toMatch(/13 CFR 121\.201/);
    const award = bundle.cells.find((c) => c.label === '§9 Award 1 contract number');
    expect(award?.evidence?.[0]?.source).toContain('search_past_contracts');
  });

  const artifacts = existsSync(PRE) && existsSync(OUT) ? it : it.skip;

  artifacts('pre-regression §5/§9/§15 bindings survive into the regenerated evidence', () => {
    const before = JSON.parse(readFileSync(PRE, 'utf8')) as { cells: Cell[] };
    const after = JSON.parse(readFileSync(OUT, 'utf8')) as {
      cells: Cell[];
      calls: Array<{ tool: string; retrievedAt: string }>;
      suppliers: {
        evaluatedOutcomeCount?: number;
        displayedRowCount?: number;
        evaluatedOutcomes?: Array<{ outcome: string }>;
        rawUeiCount?: { value?: number };
        evaluatedUeiCount?: { value?: number };
        effortsToLocate?: { value?: string };
      };
      limitations: string[];
      marketIntel?: { pricingEvidence?: { state?: string; evidence?: { source?: string } } };
    };

    const beforeMap = evidenceBindings(before.cells as never);
    const afterBy = new Map(after.cells.map((c) => [c.label, c]));
    let checked = 0;
    let changed = 0;
    for (const [label, snap] of beforeMap) {
      if (!label.startsWith('§5') && !label.startsWith('§9') && label !== '§15 Pricing evidence') {
        continue;
      }
      const cell = afterBy.get(label);
      if (!cell) continue;
      checked += 1;
      const afterSnap = JSON.stringify({
        source: cell.evidence?.[0]?.source ?? null,
        retrievedAt: cell.evidence?.[0]?.retrievedAt ?? null,
        query: cell.evidence?.[0]?.query ?? null,
      });
      if (afterSnap !== snap) changed += 1;
    }
    expect(checked).toBeGreaterThan(20);
    expect(changed, `${changed} of ${checked} §5/§9/§15 bindings drifted`).toBe(0);

    // Call log is complete (original five + complete-run additions), not four reassembly stubs.
    expect(after.calls.length).toBeGreaterThanOrEqual(7);
    expect(after.calls.some((c) => c.tool === 'get_keyword_coverage')).toBe(true);
    expect(after.calls.some((c) => c.tool === 'search_past_contracts')).toBe(true);
    expect(after.calls.some((c) => c.tool === 'get_pricing_intel')).toBe(true);
    expect(after.calls.filter((c) => c.retrievedAt.startsWith('2026-09-05T15:06'))).toHaveLength(0);

    // 50 evaluated vs 25 displayed; 32+18 reconciliation.
    expect(after.suppliers.displayedRowCount ?? after.suppliers.evaluatedOutcomes?.filter((o) => (o as { displayed?: boolean }).displayed).length).toBe(25);
    expect(after.suppliers.evaluatedOutcomeCount ?? after.suppliers.evaluatedOutcomes?.length).toBe(50);
    const outcomes = after.suppliers.evaluatedOutcomes ?? [];
    if (outcomes.length) {
      expect(outcomes.filter((o) => o.outcome === 'ambiguous')).toHaveLength(18);
      expect(outcomes.filter((o) => o.outcome === 'resolved_size_unestablished')).toHaveLength(32);
    }
    expect(after.suppliers.rawUeiCount?.value).toBe(1366);
    expect(after.suppliers.evaluatedUeiCount?.value).toBe(50);

    // No misleading market-wide zero / scored-sample / conflated population language.
    const lim = (after.limitations ?? []).join('\n');
    expect(lim).not.toMatch(/scored SAMPLE/i);
    expect(lim).not.toMatch(/matching\/eligible population/i);
    expect(lim).not.toMatch(/50 resolved supplier rows/i);
    expect(lim).not.toMatch(/parent-deduplicated capable families = 0(?!.*evaluated)/i);
    expect(lim).toMatch(/eligible_population=39848|Eligible population/i);
    const effortsCell = after.cells.find((c) => c.label === '§11 Efforts to locate sources');
    const effortsText = String(effortsCell?.text ?? after.suppliers?.effortsToLocate?.value ?? '');
    expect(effortsText).toMatch(/matching coverage of eligible population=3\.4%/);
    expect(effortsText).toMatch(/family-resolution coverage of matching UEIs=3\.7%/);
    expect(effortsText).not.toMatch(/matching\/eligible population/i);

    // Pricing evidence and limitation agree.
    const pricing = after.marketIntel?.pricingEvidence;
    expect(pricing?.state).toBe('value');
    expect(pricing?.evidence?.source ?? after.cells.find((c) => c.label === '§15 Pricing evidence')?.evidence?.[0]?.source).toContain('get_pricing_intel');
    expect(lim).not.toMatch(/no pricing payload/i);
  });
});
