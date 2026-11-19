/**
 * Budget figures are a budget signal. Live copy must not call them contract
 * obligations, spending, or opportunities. The stored amount_basis field may
 * still say "obligations" when that is the field's basis.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideProgramAnswer } from './read';

const probe = vi.fn();
vi.mock('@/lib/budget-intel/read', async () => {
  const actual = await vi.importActual<typeof import('./read')>('./read');
  return { ...actual, probeLiveAuthority: (...args: unknown[]) => probe(...args) };
});

const { getAgencyBudgetTrends } = await import('@/mcp/tools/agency-budget-trends');

const BANNED = /obligations|spending|opportunit/i;

/** The publisher name contains "spending" and is not a claim that the figure is spending. */
function withoutPublisher(text: string): string {
  return text.replace(/usaspending/gi, '');
}

function wordingLeaks(value: unknown, allowObligationsField = false): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, basis: boolean) => {
    if (typeof node === 'string') {
      if (BANNED.test(withoutPublisher(node))) hits.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, basis);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const fieldBasis = record.amount_basis === 'obligations';
    for (const [key, child] of Object.entries(record)) {
      if (key === 'amount_basis' && child === 'obligations' && (basis || allowObligationsField || fieldBasis)) continue;
      walk(child, basis || fieldBasis);
    }
  };
  walk(value, allowObligationsField);
  return hits;
}

describe('live budget labels', () => {
  beforeEach(() => {
    probe.mockReset();
    process.env.MCP_ENABLE_AI_HINT = 'true';
  });

  it('a live agency trend does not say obligations, spending, or opportunities', async () => {
    probe.mockResolvedValue({
      table: 'ready',
      live: {
        agency: 'Department of Veterans Affairs',
        toptierCode: '036',
        years: [
          {
            fiscalYear: 2025,
            budgetAuthority: 100,
            obligated: null,
            outlays: null,
            changeAmount: null,
            changeRatio: null,
            trend: null,
            sourceUrl: 'https://api.usaspending.gov/api/v2/agency/036/budgetary_resources/',
            fetchedAt: '2026-11-18T00:00:00.000Z',
          },
          {
            fiscalYear: 2026,
            budgetAuthority: 110,
            obligated: null,
            outlays: null,
            changeAmount: 10,
            changeRatio: 1.1,
            trend: 'growing',
            sourceUrl: 'https://api.usaspending.gov/api/v2/agency/036/budgetary_resources/',
            fetchedAt: '2026-11-18T00:00:00.000Z',
          },
        ],
      },
    });
    const result = await getAgencyBudgetTrends({ agency: 'Department of Veterans Affairs' });
    expect(result.shown).toBe('usaspending_live');
    expect(result._ai_hint?.how_to_use).toMatch(/budgetary resources/);
    expect(result._ai_hint?.how_to_use).toMatch(/budget signal/);
    expect(wordingLeaks(result)).toEqual([]);
  });

  it('program notes call the rows budgetary resources', () => {
    const cases = [
      decideProgramAnswer({ table: 'empty', keyword: 'cybersecurity', matches: null }),
      decideProgramAnswer({ table: 'unmeasured', keyword: 'cybersecurity', matches: null }),
      decideProgramAnswer({
        table: 'ready',
        keyword: 'cybersecurity',
        matches: [{
          agency: 'Department of Defense',
          program_name: 'Cybersecurity Operations, Defense',
          program_code: '097-0001',
          fiscal_year: 2026,
          obligated_amount: 10,
          funding_trend: 'growing',
          category: 'cybersecurity',
          source_url: 'https://api.usaspending.gov/api/v2/agency/097/federal_account/',
          fetched_at: '2026-11-18T00:00:00.000Z',
        }],
      }),
    ];
    for (const answer of cases) expect(wordingLeaks(answer)).toEqual([]);
    expect(cases[2].note).toMatch(/budgetary resources/);
    expect(cases[2].note).toMatch(/budget signal/);
  });

  it('allows the word obligations only on an amount_basis field that is obligations', () => {
    const row = {
      note: 'USASpending federal account budgetary resources.',
      amount_basis: 'obligations',
    };
    expect(wordingLeaks(row)).toEqual([]);
    expect(wordingLeaks({ ...row, note: 'These are obligations.' })).toEqual(['These are obligations.']);
  });

  it('catalog lines for get_agency_budget_trends no longer promise awards or obligations', () => {
    const registry = readFileSync('src/lib/mcp/tool-registry.ts', 'utf8');
    const server = readFileSync('src/mcp/server.ts', 'utf8');
    for (const src of [registry, server]) {
      const start = src.indexOf("An agency's discretionary budget authority");
      const block = src.slice(start, start + 900);
      expect(block).not.toMatch(/BEFORE it becomes awards/);
      expect(block).not.toMatch(/not total obligations/);
      expect(block).toMatch(/budgetary resources/);
    }
  });
});
