/**
 * Agency budgetary resources and federal-account obligations stay distinct.
 * "obligations" is allowed only on an object whose amount_basis is obligations.
 * "spending" and "opportunit" are banned in both.
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

const OBLIGATIONS_WORD = /obligations/i;
const OTHER_BANNED = /spending|opportunit/i;

/** The publisher name contains "spending" and is not a claim that the figure is spending. */
function withoutPublisher(text: string): string {
  return text.replace(/usaspending/gi, '');
}

function wordingLeaks(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, obligationsAllowed: boolean) => {
    if (typeof node === 'string') {
      const text = withoutPublisher(node);
      if (OTHER_BANNED.test(text) || (!obligationsAllowed && OBLIGATIONS_WORD.test(text))) hits.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, obligationsAllowed);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const allowed = obligationsAllowed || record.amount_basis === 'obligations';
    for (const child of Object.values(record)) walk(child, allowed);
  };
  walk(value, false);
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

  it('program notes call the rows federal-account obligations', () => {
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
    for (const answer of cases) {
      expect(answer.amount_basis).toBe('obligations');
      expect(wordingLeaks(answer)).toEqual([]);
    }
    expect(cases[2].note).toMatch(/federal-account obligations/);
    expect(cases[2].note).toMatch(/not agency budgetary resources/);
    expect(cases[2].note).not.toMatch(/opportunit|solicitation/i);
  });

  it('allows the word obligations only where amount_basis is obligations', () => {
    const row = {
      note: 'USASpending federal-account obligations.',
      amount_basis: 'obligations' as const,
    };
    expect(wordingLeaks(row)).toEqual([]);
    expect(wordingLeaks({ note: row.note })).toEqual([row.note]);
    expect(wordingLeaks({ note: 'These are spending.', amount_basis: 'obligations' })).toEqual(['These are spending.']);
    expect(wordingLeaks({ note: 'These are obligations.', amount_basis: 'budgetary_resources' })).toEqual(['These are obligations.']);
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
      expect(block).not.toMatch(/federal-account obligations/);
    }
    for (const src of [registry, server]) {
      expect(src).toContain('federal-account obligations');
      expect(src).not.toContain('federal-account budgetary resources');
      expect(src).not.toContain('increasing that spending');
    }
  });
});
