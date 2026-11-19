import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import toptierCodes from '@/data/agency-toptier-codes.json';
import { BudgetSourceDown, fetchBudgetSlice } from './fetch';
import { decideAuthorityDisplay, decideProgramAnswer } from './read';
import { choosePriorities } from '@/lib/strategic-intel/sourced-pain-points';
import { formatPainPointForDisplay } from '@/lib/strategic-intel/sourced-pain-points';
import {
  ACCOUNTS_PER_RUN,
  advanceCursor,
  buildAuthorityRows,
  buildBudgetSlice,
  buildProgramRows,
  buildRoster,
  classifyBudgetLinks,
  parseBudgetYears,
  parseFederalAccountPage,
  parsePerformanceGovPriorities,
  sliceHttp,
  type RosterAgency,
} from './slice';

const vaResources = JSON.parse(readFileSync(join(__dirname, 'fixtures/va-budgetary-resources.json'), 'utf8'));
const vaAccounts = JSON.parse(readFileSync(join(__dirname, 'fixtures/va-federal-account-fy2025.json'), 'utf8'));
const fetchedAt = '2026-11-18T22:00:00.000Z';
const va: RosterAgency = {
  agency: 'Department of Veterans Affairs',
  toptierCode: '036',
  abbreviation: 'VA',
  performanceGovSlug: 'va',
};

const VA_PROFILE = `
<section>
  <h2>This agency's goals, progress, and results</h2>
  <p>To fulfill President Lincoln’s promise to care for those who have served in our nation’s military and for their families, caregivers, and survivors.</p>
  <a href="https://www.va.gov/performance/">Strategic plan</a>
</section>`;

describe('USASpending budget slice', () => {
  it('keeps a null fiscal year out and does not copy the government-wide total', () => {
    const years = parseBudgetYears(vaResources);
    expect(years.map((year) => year.fiscalYear)).toEqual([2026, 2025]);
    const rows = buildAuthorityRows(va, years, fetchedAt);
    expect(rows).toHaveLength(2);
    expect(rows[0].fiscal_year).toBe(2026);
    expect(rows[0].budget_authority).toBe(520360602282.9);
    expect(rows[0].budget_authority).not.toBe(14142952299307.62);
    expect(rows[0].source_url).toContain('/agency/036/budgetary_resources/');
    expect(rows[0].fetched_at).toBe(fetchedAt);
    expect(rows[0].source_key).toBe('usaspending:budgetary-resources:036:2026');
    expect(rows[0].trend).toBe('growing');
    expect(rows[0].prior_year_authority).toBe(458775858774.24);
  });

  it('writes the federal account, not each child treasury account', () => {
    const page = parseFederalAccountPage(vaAccounts);
    expect(page.malformed).toBe(false);
    expect(page.accounts).toHaveLength(1);
    expect(page.accounts[0].code).toBe('036-0102');
    expect(page.hasNext).toBe(true);
    const rows = buildProgramRows({
      agency: va,
      fiscalYear: 2025,
      page: 1,
      accounts: page.accounts,
      priorObligated: new Map([['036-0102', 177918274520.18]]),
      priorScanComplete: false,
      fetchedAt,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].obligated_amount).toBe(203144226696.96);
    expect(rows[0].funding_trend).toBe('growing');
    expect(rows[0].category).toBeNull();
    expect(rows[0].amount_basis).toBe('obligations');
    expect(rows[0].source_url).toContain('fiscal_year=2025');
    expect(rows[0].source_key).toBe('usaspending:federal-account:2025:036-0102');
  });

  it('does not call an unscanned account new, and does not invent a zero', () => {
    const pending = buildProgramRows({
      agency: va,
      fiscalYear: 2026,
      page: 1,
      accounts: [{ code: '036-0160', name: 'Medical Services, Veterans Affairs', obligated: 10, outlay: null }],
      priorObligated: new Map(),
      priorScanComplete: false,
      fetchedAt,
    });
    expect(pending[0].funding_trend).toBeNull();
    expect(pending[0].prior_year_obligated).toBeNull();
    const finished = buildProgramRows({
      agency: va,
      fiscalYear: 2026,
      page: 1,
      accounts: [{ code: '036-0160', name: 'Medical Services, Veterans Affairs', obligated: 10, outlay: null }],
      priorObligated: new Map(),
      priorScanComplete: true,
      fetchedAt,
    });
    expect(finished[0].funding_trend).toBe('new');
  });

  it('labels cybersecurity only from the account name and caps the page', () => {
    const accounts = Array.from({ length: 12 }, (_, i) => ({
      code: `097-${String(1000 + i)}`,
      name: i === 0 ? 'Cybersecurity Operations, Defense' : `Other account ${i}, Defense`,
      obligated: 1000 + i,
      outlay: null,
    }));
    const rows = buildProgramRows({
      agency: { ...va, agency: 'Department of Defense', toptierCode: '097', abbreviation: 'DOD', performanceGovSlug: 'dod' },
      fiscalYear: 2026,
      page: 1,
      accounts,
      priorObligated: new Map(accounts.map((account) => [account.code, account.obligated / 2])),
      priorScanComplete: true,
      fetchedAt,
    });
    expect(rows).toHaveLength(ACCOUNTS_PER_RUN);
    expect(rows[0].category).toBe('cybersecurity');
    expect(rows[0].funding_trend).toBe('surging');
    expect(rows[1].category).toBeNull();
  });

  it('advances to the next page, then the next agency', () => {
    expect(advanceCursor({ agencyIndex: 0, page: 1 }, { hasNext: true, next: 2 }, 3)).toEqual({ agencyIndex: 0, page: 2 });
    expect(advanceCursor({ agencyIndex: 2, page: 4 }, { hasNext: false, next: null }, 3)).toEqual({ agencyIndex: 0, page: 1 });
  });

  it('skips a repeated toptier code instead of overwriting the first agency', () => {
    const roster = buildRoster(toptierCodes as Record<string, { code: string; abbreviation: string }>);
    expect(roster.skippedDuplicateToptier).toContain('Executive Office of the President');
    expect(roster.agencies.filter((agency) => agency.toptierCode === '011')).toHaveLength(1);
    expect(roster.agencies.find((agency) => agency.toptierCode === '011')?.agency).toBe('Peace Corps');
  });
});

describe('performance.gov priorities', () => {
  it('does not turn the mission paragraph into a priority', () => {
    const parsed = parsePerformanceGovPriorities(VA_PROFILE);
    expect(parsed.outcome).toBe('no_structured_objectives');
    expect(parsed.objectives).toEqual([]);
  });

  it('reads a structured objective and keeps its url', () => {
    const html = `<li data-priority-id="va-apg-1" data-fiscal-year="2026"><a href="/agencies/va/goals/1/">Cut the disability claims backlog</a></li>`;
    const parsed = parsePerformanceGovPriorities(html);
    expect(parsed.objectives).toEqual([
      expect.objectContaining({ id: 'va-apg-1', title: 'Cut the disability claims backlog', fiscalYear: '2026' }),
    ]);
    const slice = buildBudgetSlice({
      agency: va,
      cursor: { agencyIndex: 3, page: 1 },
      rosterLength: 10,
      years: parseBudgetYears(vaResources),
      accounts: parseFederalAccountPage(vaAccounts),
      priorPages: [],
      prioritiesBody: html,
      prioritiesSourceDown: false,
      fetchedAt,
    });
    expect(slice.priorities).toHaveLength(1);
    expect(slice.priorities[0].source_url).toBe('https://www.performance.gov/agencies/va/goals/1/');
    expect(slice.priorities[0].source).toBe('performance.gov');
    expect(slice.priorities[0].fetched_at).toBe(fetchedAt);
    expect(slice.programs.length).toBeLessThanOrEqual(ACCOUNTS_PER_RUN);
  });
});

describe('forecast links', () => {
  const program = {
    sourceKey: 'usaspending:federal-account:2025:036-0102',
    code: '036-0102',
    name: 'Compensation and Pensions, Veterans Benefits Administration, Veterans Affairs',
  };

  it('verifies an account code and infers only an exact long name on the same forecast agency', () => {
    const links = classifyBudgetLinks({
      forecastCodes: ['VA'],
      programs: [program, { sourceKey: 'k2', code: '036-9999', name: 'Pensions' }],
      forecasts: [
        { id: 'f1', source_agency: 'VA', title: 'something', program_office: null, external_id: '036-0102' },
        { id: 'f2', source_agency: 'VA', title: program.name, program_office: null, external_id: null },
        { id: 'f3', source_agency: 'VA', title: 'Pensions', program_office: null, external_id: null },
        { id: 'f4', source_agency: 'HHS', title: program.name, program_office: null, external_id: '036-0102' },
      ],
    });
    expect(links.find((link) => link.target_id === 'f1')?.link_status).toBe('verified');
    expect(links.find((link) => link.target_id === 'f2')?.link_status).toBe('inferred');
    expect(links.find((link) => link.target_id === 'f3')).toBeUndefined();
    expect(links.find((link) => link.target_id === 'f4')).toBeUndefined();
  });
});

describe('customer source choice', () => {
  const file = {
    agency: 'Department of Veterans Affairs',
    toptierCode: '036',
    fy2025: 27e9,
    fy2026: 22e9,
    changeAmount: -5e9,
    changeRatio: 0.8168,
    trend: 'declining',
  };

  it('uses the fixed file when the live table is empty, and labels it', () => {
    const shown = decideAuthorityDisplay({ table: 'empty', live: null, file, fileSource: 'fixed file', fileAsOf: '2026-02-18T00:00:00.000Z' });
    expect(shown.shown).toBe('static_file');
    expect(shown.as_of).toBe('2026-02-18T00:00:00.000Z');
    expect(shown.fy2026_budget_authority).toBe(22e9);
    expect(shown.change_percent_points).toBeCloseTo(-18.32, 1);
  });

  it('live table has DoD only; a civilian agency still returns the static file', () => {
    const shown = decideAuthorityDisplay({
      table: 'ready',
      live: null,
      file,
      fileSource: 'fixed file',
      fileAsOf: '2026-02-18T00:00:00.000Z',
    });
    expect(file.agency).toBe('Department of Veterans Affairs');
    expect(shown.shown).toBe('static_file');
    expect(shown.as_of).toBe('2026-02-18T00:00:00.000Z');
    expect(shown.fy2025_budget_authority).toBe(27e9);
    expect(shown.fy2026_budget_authority).toBe(22e9);
    expect(shown.trend).toBe('declining');
    expect(shown.change_amount).toBe(-5e9);
    expect(shown.years.map((year) => year.label)).toEqual(['static_file', 'static_file']);
    expect(shown.grounded).toBe(true);
  });

  it('prefers an acquired year and keeps the static file for a year not yet acquired', () => {
    const shown = decideAuthorityDisplay({
      table: 'ready',
      live: {
        agency: 'Department of Veterans Affairs',
        toptierCode: '036',
        years: [{
          fiscalYear: 2026,
          budgetAuthority: 520360602282.9,
          obligated: null,
          outlays: null,
          changeAmount: 1,
          changeRatio: 1.13,
          trend: 'growing',
          sourceUrl: 'https://api.usaspending.gov/api/v2/agency/036/budgetary_resources/',
          fetchedAt,
        }],
      },
      file,
      fileSource: 'fixed file',
      fileAsOf: '2026-02-18T00:00:00.000Z',
    });
    const y2025 = shown.years.find((year) => year.fiscal_year === 2025);
    const y2026 = shown.years.find((year) => year.fiscal_year === 2026);
    expect(y2025).toMatchObject({ label: 'static_file', budget_authority: 27e9, as_of: '2026-02-18T00:00:00.000Z' });
    expect(y2026).toMatchObject({ label: 'usaspending_live', budget_authority: 520360602282.9, fetched_at: fetchedAt });
    expect(shown.fy2025_budget_authority).toBe(27e9);
    expect(shown.fy2026_budget_authority).toBe(520360602282.9);
  });

  it('labels a fully acquired agency usaspending_live', () => {
    const shown = decideAuthorityDisplay({
      table: 'ready',
      live: {
        agency: 'Department of Defense',
        toptierCode: '097',
        years: [
          { fiscalYear: 2025, budgetAuthority: 100, obligated: null, outlays: null, changeAmount: null, changeRatio: null, trend: null, sourceUrl: 'https://api.usaspending.gov/api/v2/agency/097/budgetary_resources/', fetchedAt },
          { fiscalYear: 2026, budgetAuthority: 110, obligated: null, outlays: null, changeAmount: 10, changeRatio: 1.1, trend: 'growing', sourceUrl: 'https://api.usaspending.gov/api/v2/agency/097/budgetary_resources/', fetchedAt },
        ],
      },
      file: { ...file, agency: 'Department of Defense', fy2025: 1, fy2026: 2 },
      fileSource: 'fixed file',
      fileAsOf: '2026-02-18T00:00:00.000Z',
    });
    expect(shown.shown).toBe('usaspending_live');
    expect(shown.fetched_at).toBe(fetchedAt);
    expect(shown.fy2025_budget_authority).toBe(100);
    expect(shown.fy2026_budget_authority).toBe(110);
    expect(shown.as_of).toBeNull();
  });

  it('an unmeasured live read still returns the static file', () => {
    const shown = decideAuthorityDisplay({ table: 'unmeasured', live: null, file, fileSource: 'fixed file', fileAsOf: '2026-02-18T00:00:00.000Z' });
    expect(shown.shown).toBe('static_file');
    expect(shown.shown_reason).toBe('live_unmeasured');
    expect(shown.fy2026_budget_authority).toBe(22e9);
    expect(shown.as_of).toBe('2026-02-18T00:00:00.000Z');
  });

  it('an empty program table is not a list of zero agencies', () => {
    const answer = decideProgramAnswer({ table: 'empty', keyword: 'cybersecurity', matches: null });
    expect(answer.agencies).toBeNull();
    expect(answer.shown_reason).toBe('live_table_empty');
    const none = decideProgramAnswer({ table: 'ready', keyword: 'cybersecurity', matches: [] });
    expect(none.agencies).toEqual([]);
    expect(none.shown_reason).toBe('none_found');
  });

  it('an agency with no live priorities keeps the fixed file even if another agency was acquired', () => {
    const legacy = [{ pain_point: 'file priority', provenance: 'LEGACY_MANUAL' as const, agency: 'VA', source_type: 'legacy_manual' as const, source_url: null, document_number: null, published_at: null, institute_source_id: null, legacy_source_tag: null }];
    const live = [{ ...legacy[0], pain_point: 'Cut the disability claims backlog', provenance: 'SOURCE_FACT' as const, source_type: 'other' as const, source_url: 'https://www.performance.gov/agencies/va/goals/1/' }];
    expect(choosePriorities('empty', [], legacy).priorityBasis).toBe('static_file');
    expect(choosePriorities('ready', live, legacy).priorities[0].pain_point).toMatch(/backlog/);
    expect(choosePriorities('ready', [], legacy).priorities).toEqual(legacy);
    expect(choosePriorities('ready', [], legacy).priorityBasis).toBe('static_file');
    expect(choosePriorities('unmeasured', [], legacy).priorityBasis).toBe('static_file_live_unmeasured');
    expect(formatPainPointForDisplay(live[0])).toContain('performance.gov');
    expect(formatPainPointForDisplay(live[0])).not.toContain('LEGACY_MANUAL');
  });
});

describe('source down', () => {
  it('a non-2xx budgetary response fails the slice', async () => {
    const fetcher = (async () => new Response('down', { status: 503 })) as typeof fetch;
    await expect(fetchBudgetSlice({ agencyIndex: 0, page: 1 }, fetcher)).rejects.toBeInstanceOf(BudgetSourceDown);
  });

  it('source down is HTTP 502 and a preview does not report an outcome', () => {
    expect(sliceHttp({ sourceDown: true, prioritiesSourceDown: false, writeFailed: false, migrationMissing: false })).toEqual({
      status: 502, cronOutcome: 'error',
    });
    const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-budget-intel/route.ts'), 'utf8');
    expect(src).toContain("from '@/lib/cron-self-report'");
    expect(src).toContain('reportCronOutcome');
    const preview = src.slice(src.indexOf('if (preview)'), src.indexOf('let links'));
    expect(preview).not.toContain('reportCronOutcome');
    expect(src).not.toContain('.delete(');
  });
});
