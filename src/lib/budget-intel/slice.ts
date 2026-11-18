/**
 * One capped USASpending slice for the existing budget tables.
 *
 * A run is one roster agency and one page of federal accounts (plus the two
 * latest consecutive fiscal years that the budgetary-resources call already
 * returned). It does not walk the roster and it does not import history.
 *
 * Null money stays null. The government-wide `total_budgetary_resources`
 * figure is never copied onto an agency row.
 */
import { classifyAgencyTrend, type BudgetTrend } from '@/lib/utils/budget-authority';

export function sliceHttp(input: {
  sourceDown: boolean;
  prioritiesSourceDown: boolean;
  writeFailed: boolean;
  migrationMissing: boolean;
}): { status: number; cronOutcome: 'success' | 'error' | 'partial' } {
  if (input.sourceDown) return { status: 502, cronOutcome: 'error' };
  if (input.migrationMissing || input.writeFailed) return { status: 503, cronOutcome: 'error' };
  if (input.prioritiesSourceDown) return { status: 503, cronOutcome: 'partial' };
  return { status: 200, cronOutcome: 'success' };
}

export const ACCOUNTS_PER_RUN = 10;
export const PRIOR_YEAR_PAGE_CAP = 2;
export const RUN_TYPE = 'usaspending_slice';

export const USASPENDING_ORIGIN = 'https://api.usaspending.gov/api/v2';
export const PERFORMANCE_GOV_ORIGIN = 'https://www.performance.gov';

/** performance.gov agency-profile slugs. Agencies without a profile are skipped, not scraped. */
export const PERFORMANCE_GOV_SLUG: Readonly<Record<string, string>> = {
  DOD: 'dod', HHS: 'hhs', ED: 'ed', VA: 'va', DHS: 'dhs', DOE: 'doe',
  USDA: 'usda', TREAS: 'usdt', DOT: 'dot', DOJ: 'doj', DOI: 'doi',
  DOL: 'dol', DOC: 'doc', DOS: 'dos', HUD: 'hud', EPA: 'epa',
  NASA: 'nasa', GSA: 'gsa', SBA: 'sba', SSA: 'ssa', NRC: 'nrc',
  NSF: 'nsf', USAID: 'usaid', OPM: 'opm',
};

export interface RosterAgency {
  agency: string;
  toptierCode: string;
  abbreviation: string;
  performanceGovSlug: string | null;
}

export interface BudgetCursor {
  agencyIndex: number;
  page: number;
}

export interface BudgetYear {
  fiscalYear: number;
  budgetAuthority: number;
  obligated: number | null;
  outlays: number | null;
}

export interface FederalAccount {
  code: string;
  name: string;
  obligated: number | null;
  outlay: number | null;
}

export interface AccountPage {
  accounts: FederalAccount[];
  page: number | null;
  total: number | null;
  hasNext: boolean;
  next: number | null;
  malformed: boolean;
}

export interface AuthorityRow {
  agency: string;
  toptier_code: string;
  fiscal_year: number;
  budget_authority: number;
  obligated: number | null;
  outlays: number | null;
  prior_year_authority: number | null;
  change_amount: number | null;
  change_percent: number | null;
  trend: BudgetTrend | null;
  source_url: string;
  fetched_at: string;
  source_key: string;
}

export interface ProgramRow {
  agency: string;
  fiscal_year: number;
  document_url: string;
  source_url: string;
  program_name: string;
  program_code: string;
  obligated_amount: number | null;
  gross_outlay_amount: number | null;
  prior_year_obligated: number | null;
  funding_trend: 'surging' | 'growing' | 'stable' | 'declining' | 'cut' | 'new' | null;
  category: string | null;
  amount_basis: 'obligations';
  extraction_method: 'import';
  fetched_at: string;
  source_key: string;
}

export interface PriorityRow {
  agency: string;
  priority_description: string;
  fiscal_year: string | null;
  source: 'performance.gov';
  source_url: string;
  fetched_at: string;
  source_key: string;
  category: string | null;
}

export interface LinkRow {
  source_table: 'budget_programs';
  source_key: string;
  target_table: 'agency_forecasts';
  target_id: string;
  link_status: 'verified' | 'inferred';
  match_basis: string;
  evidence: Record<string, string | null>;
}

export interface BudgetSlice {
  cursor: BudgetCursor;
  nextCursor: BudgetCursor;
  agency: RosterAgency;
  fiscalYears: number[];
  authoritySourceUrl: string;
  programSourceUrl: string | null;
  prioritiesSourceUrl: string | null;
  prioritiesOutcome: 'objectives' | 'no_structured_objectives' | 'no_profile' | 'source_down' | 'malformed';
  authority: AuthorityRow[];
  programs: ProgramRow[];
  priorities: PriorityRow[];
  accountsOnPage: number;
  priorScanComplete: boolean;
}

const ACCOUNT_CODE = /^\d{3}-\d{4}$/;

export function buildRoster(
  codes: Record<string, { code: string; abbreviation: string }>,
): { agencies: RosterAgency[]; skippedDuplicateToptier: string[] } {
  const seen = new Set<string>();
  const agencies: RosterAgency[] = [];
  const skippedDuplicateToptier: string[] = [];
  for (const [agency, value] of Object.entries(codes)) {
    const toptierCode = String(value.code).padStart(3, '0');
    if (seen.has(toptierCode)) {
      skippedDuplicateToptier.push(agency);
      continue;
    }
    seen.add(toptierCode);
    agencies.push({
      agency,
      toptierCode,
      abbreviation: value.abbreviation,
      performanceGovSlug: PERFORMANCE_GOV_SLUG[value.abbreviation] ?? null,
    });
  }
  return { agencies, skippedDuplicateToptier };
}

export function normalizeCursor(raw: unknown, rosterLength: number): BudgetCursor | null {
  if (rosterLength <= 0) return null;
  if (raw == null) return { agencyIndex: 0, page: 1 };
  if (typeof raw !== 'object') return null;
  const agencyIndex = (raw as { agencyIndex?: unknown }).agencyIndex;
  const page = (raw as { page?: unknown }).page;
  if (!Number.isInteger(agencyIndex) || !Number.isInteger(page)) return null;
  if ((page as number) < 1 || (agencyIndex as number) < 0) return null;
  if ((agencyIndex as number) >= rosterLength) return { agencyIndex: 0, page: 1 };
  return { agencyIndex: agencyIndex as number, page: page as number };
}

export function advanceCursor(
  cursor: BudgetCursor,
  page: { hasNext: boolean; next: number | null },
  rosterLength: number,
): BudgetCursor {
  if (page.hasNext && page.next != null && page.next > cursor.page) {
    return { agencyIndex: cursor.agencyIndex, page: page.next };
  }
  const agencyIndex = cursor.agencyIndex + 1;
  if (agencyIndex >= rosterLength) return { agencyIndex: 0, page: 1 };
  return { agencyIndex, page: 1 };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function yearOverYear(
  current: number,
  prior: number,
): { amount: number; ratio: number; trend: BudgetTrend } | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  const ratio = current / prior;
  if (!Number.isFinite(ratio)) return null;
  return { amount: roundMoney(current - prior), ratio: roundRatio(ratio), trend: classifyAgencyTrend(ratio) };
}

/** Category only when the account's own name says so. No match stays null. */
export function categoryFromProgramName(name: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/\bcyber ?security\b|\binformation security\b/i, 'cybersecurity'],
    [/\binfrastructure\b/i, 'infrastructure'],
    [/\bmodernization\b/i, 'modernization'],
    [/\bcompliance\b/i, 'compliance'],
    [/\bworkforce\b/i, 'workforce'],
    [/\blogistics\b/i, 'logistics'],
    [/\bresearch\b/i, 'research'],
    [/\boperation and maintenance\b/i, 'operations'],
  ];
  for (const [re, category] of rules) {
    if (re.test(name)) return category;
  }
  return null;
}

export function parseBudgetYears(payload: unknown): BudgetYear[] {
  const rows = payload && typeof payload === 'object'
    ? (payload as { agency_data_by_year?: unknown }).agency_data_by_year
    : null;
  if (!Array.isArray(rows)) return [];
  const out: BudgetYear[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const fiscalYear = (row as { fiscal_year?: unknown }).fiscal_year;
    const authority = finiteNumber((row as { agency_budgetary_resources?: unknown }).agency_budgetary_resources);
    if (!Number.isInteger(fiscalYear) || authority == null) continue;
    out.push({
      fiscalYear: fiscalYear as number,
      budgetAuthority: authority,
      obligated: finiteNumber((row as { agency_total_obligated?: unknown }).agency_total_obligated),
      outlays: finiteNumber((row as { agency_total_outlayed?: unknown }).agency_total_outlayed),
    });
  }
  return out.sort((a, b) => b.fiscalYear - a.fiscalYear);
}

export function consecutivePair(years: BudgetYear[]): { newer: BudgetYear; older: BudgetYear | null } | null {
  if (years.length === 0) return null;
  const newer = years[0];
  const older = years.find((year) => year.fiscalYear === newer.fiscalYear - 1) ?? null;
  return { newer, older };
}

export function parseFederalAccountPage(payload: unknown): AccountPage {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) {
    return { accounts: [], page: null, total: null, hasNext: false, next: null, malformed: true };
  }
  const body = payload as {
    results: unknown[];
    page_metadata?: { page?: unknown; total?: unknown; hasNext?: unknown; next?: unknown };
  };
  const meta = body.page_metadata;
  if (!meta || typeof meta !== 'object') {
    return { accounts: [], page: null, total: null, hasNext: false, next: null, malformed: true };
  }
  const accounts: FederalAccount[] = [];
  for (const row of body.results) {
    if (!row || typeof row !== 'object') continue;
    const code = (row as { code?: unknown }).code;
    const name = (row as { name?: unknown }).name;
    if (typeof code !== 'string' || !ACCOUNT_CODE.test(code)) continue;
    if (typeof name !== 'string' || name.trim().length < 3) continue;
    accounts.push({
      code,
      name: name.trim(),
      obligated: finiteNumber((row as { obligated_amount?: unknown }).obligated_amount),
      outlay: finiteNumber((row as { gross_outlay_amount?: unknown }).gross_outlay_amount),
    });
  }
  return {
    accounts: accounts.slice(0, ACCOUNTS_PER_RUN),
    page: Number.isInteger(meta.page) ? meta.page as number : null,
    total: typeof meta.total === 'number' ? meta.total : null,
    hasNext: meta.hasNext === true,
    next: Number.isInteger(meta.next) ? meta.next as number : null,
    malformed: false,
  };
}

export function authoritySourceUrl(toptierCode: string): string {
  return `${USASPENDING_ORIGIN}/agency/${toptierCode}/budgetary_resources/`;
}

export function federalAccountUrl(toptierCode: string, fiscalYear: number, page: number): string {
  return `${USASPENDING_ORIGIN}/agency/${toptierCode}/federal_account/?fiscal_year=${fiscalYear}&limit=${ACCOUNTS_PER_RUN}&page=${page}`;
}

export function performanceGovUrl(slug: string): string {
  return `${PERFORMANCE_GOV_ORIGIN}/agencies/${slug}/`;
}

function authorityRow(
  agency: RosterAgency,
  year: BudgetYear,
  prior: BudgetYear | null,
  fetchedAt: string,
): AuthorityRow {
  const change = prior ? yearOverYear(year.budgetAuthority, prior.budgetAuthority) : null;
  return {
    agency: agency.agency,
    toptier_code: agency.toptierCode,
    fiscal_year: year.fiscalYear,
    budget_authority: roundMoney(year.budgetAuthority),
    obligated: year.obligated == null ? null : roundMoney(year.obligated),
    outlays: year.outlays == null ? null : roundMoney(year.outlays),
    prior_year_authority: prior ? roundMoney(prior.budgetAuthority) : null,
    change_amount: change?.amount ?? null,
    change_percent: change?.ratio ?? null,
    trend: change?.trend ?? null,
    source_url: authoritySourceUrl(agency.toptierCode),
    fetched_at: fetchedAt,
    source_key: `usaspending:budgetary-resources:${agency.toptierCode}:${year.fiscalYear}`,
  };
}

export function buildAuthorityRows(
  agency: RosterAgency,
  years: BudgetYear[],
  fetchedAt: string,
): AuthorityRow[] {
  const pair = consecutivePair(years);
  if (!pair) return [];
  const rows = [authorityRow(agency, pair.newer, pair.older, fetchedAt)];
  if (pair.older) {
    const olderPrior = years.find((year) => year.fiscalYear === pair.older!.fiscalYear - 1) ?? null;
    rows.push(authorityRow(agency, pair.older, olderPrior, fetchedAt));
  }
  return rows;
}

export function buildProgramRows(input: {
  agency: RosterAgency;
  fiscalYear: number;
  page: number;
  accounts: FederalAccount[];
  priorObligated: Map<string, number | null>;
  priorScanComplete: boolean;
  fetchedAt: string;
}): ProgramRow[] {
  const sourceUrl = federalAccountUrl(input.agency.toptierCode, input.fiscalYear, input.page);
  return input.accounts.slice(0, ACCOUNTS_PER_RUN).map((account) => {
    const prior = input.priorObligated.has(account.code) ? input.priorObligated.get(account.code) ?? null : undefined;
    let fundingTrend: ProgramRow['funding_trend'] = null;
    let priorAmount: number | null = null;
    if (prior === undefined || account.obligated == null) {
      fundingTrend = null;
    } else if (prior == null) {
      fundingTrend = null;
      priorAmount = null;
    } else {
      priorAmount = roundMoney(prior);
      const change = yearOverYear(account.obligated, prior);
      fundingTrend = change?.trend ?? null;
    }
    if (prior === undefined && input.priorScanComplete && account.obligated != null) {
      fundingTrend = 'new';
    }
    return {
      agency: input.agency.agency,
      fiscal_year: input.fiscalYear,
      document_url: sourceUrl,
      source_url: sourceUrl,
      program_name: account.name,
      program_code: account.code,
      obligated_amount: account.obligated == null ? null : roundMoney(account.obligated),
      gross_outlay_amount: account.outlay == null ? null : roundMoney(account.outlay),
      prior_year_obligated: priorAmount,
      funding_trend: fundingTrend,
      category: categoryFromProgramName(account.name),
      amount_basis: 'obligations',
      extraction_method: 'import',
      fetched_at: input.fetchedAt,
      source_key: `usaspending:federal-account:${input.fiscalYear}:${account.code}`,
    };
  });
}

export interface ParsedObjective {
  id: string;
  title: string;
  url: string | null;
  fiscalYear: string | null;
}

function cleanText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function parsePerformanceGovPriorities(body: string): {
  objectives: ParsedObjective[];
  outcome: 'objectives' | 'no_structured_objectives' | 'malformed';
} {
  const trimmed = body.trim();
  if (!trimmed) return { objectives: [], outcome: 'malformed' };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? (parsed as { objectives?: unknown; goals?: unknown }).objectives
            ?? (parsed as { goals?: unknown }).goals
          : null;
      if (!Array.isArray(list)) return { objectives: [], outcome: 'no_structured_objectives' };
      const objectives: ParsedObjective[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as { id?: unknown }).id;
        const title = (item as { title?: unknown }).title;
        if (typeof id !== 'string' || typeof title !== 'string') continue;
        const text = cleanText(title);
        if (text.length < 8) continue;
        const url = (item as { url?: unknown }).url;
        const fy = (item as { fiscal_year?: unknown }).fiscal_year;
        objectives.push({
          id: id.slice(0, 80),
          title: text,
          url: typeof url === 'string' ? url : null,
          fiscalYear: typeof fy === 'string' || typeof fy === 'number' ? String(fy) : null,
        });
      }
      return { objectives, outcome: objectives.length ? 'objectives' : 'no_structured_objectives' };
    } catch {
      return { objectives: [], outcome: 'malformed' };
    }
  }

  const objectives: ParsedObjective[] = [];
  const block = /<([a-z0-9]+)([^>]*\bdata-priority-id="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = block.exec(trimmed))) {
    const id = match[3];
    const open = match[2];
    const inner = match[4];
    const titleMatch = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(inner);
    const title = cleanText(titleMatch?.[1] ?? '');
    if (title.length < 8) continue;
    const href = /href="([^"]+)"/i.exec(inner)?.[1] ?? null;
    const fy = /data-fiscal-year="(\d{4})"/i.exec(open)?.[1] ?? null;
    objectives.push({ id, title, url: href, fiscalYear: fy });
  }
  return { objectives, outcome: objectives.length ? 'objectives' : 'no_structured_objectives' };
}

export function buildPriorityRows(input: {
  agency: RosterAgency;
  objectives: ParsedObjective[];
  profileUrl: string;
  fetchedAt: string;
}): PriorityRow[] {
  return input.objectives.map((objective) => {
    const sourceUrl = objective.url
      ? new URL(objective.url, input.profileUrl).toString()
      : input.profileUrl;
    return {
      agency: input.agency.agency,
      priority_description: objective.title,
      fiscal_year: objective.fiscalYear,
      source: 'performance.gov',
      source_url: sourceUrl,
      fetched_at: input.fetchedAt,
      source_key: `performance-gov:${input.agency.performanceGovSlug ?? input.agency.toptierCode}:${objective.id}`,
      category: categoryFromProgramName(objective.title),
    };
  });
}

export function buildBudgetSlice(input: {
  agency: RosterAgency;
  cursor: BudgetCursor;
  rosterLength: number;
  years: BudgetYear[];
  accounts: AccountPage;
  priorPages: AccountPage[];
  prioritiesBody: string | null;
  prioritiesSourceDown: boolean;
  fetchedAt: string;
}): BudgetSlice {
  const pair = consecutivePair(input.years);
  const authority = buildAuthorityRows(input.agency, input.years, input.fetchedAt);
  const newerFy = pair?.newer.fiscalYear ?? null;
  const priorObligated = new Map<string, number | null>();
  for (const page of input.priorPages) {
    if (page.malformed) continue;
    for (const account of page.accounts) priorObligated.set(account.code, account.obligated);
  }
  const lastPrior = input.priorPages[input.priorPages.length - 1];
  const priorScanComplete = input.priorPages.length > 0 && !!lastPrior && !lastPrior.malformed && !lastPrior.hasNext;
  const programs = newerFy == null || input.accounts.malformed
    ? []
    : buildProgramRows({
      agency: input.agency,
      fiscalYear: newerFy,
      page: input.cursor.page,
      accounts: input.accounts.accounts,
      priorObligated,
      priorScanComplete,
      fetchedAt: input.fetchedAt,
    });

  let prioritiesOutcome: BudgetSlice['prioritiesOutcome'] = 'no_profile';
  let priorities: PriorityRow[] = [];
  const profileUrl = input.agency.performanceGovSlug
    ? performanceGovUrl(input.agency.performanceGovSlug)
    : null;
  if (!input.agency.performanceGovSlug) {
    prioritiesOutcome = 'no_profile';
  } else if (input.prioritiesSourceDown) {
    prioritiesOutcome = 'source_down';
  } else if (input.prioritiesBody == null) {
    prioritiesOutcome = 'malformed';
  } else {
    const parsed = parsePerformanceGovPriorities(input.prioritiesBody);
    prioritiesOutcome = parsed.outcome;
    if (profileUrl) {
      priorities = buildPriorityRows({
        agency: input.agency,
        objectives: parsed.objectives,
        profileUrl,
        fetchedAt: input.fetchedAt,
      });
    }
  }

  const pageMeta = input.accounts.malformed
    ? { hasNext: false, next: null }
    : { hasNext: input.accounts.hasNext, next: input.accounts.next };
  return {
    cursor: input.cursor,
    nextCursor: advanceCursor(input.cursor, pageMeta, input.rosterLength),
    agency: input.agency,
    fiscalYears: authority.map((row) => row.fiscal_year),
    authoritySourceUrl: authoritySourceUrl(input.agency.toptierCode),
    programSourceUrl: newerFy == null ? null : federalAccountUrl(input.agency.toptierCode, newerFy, input.cursor.page),
    prioritiesSourceUrl: profileUrl,
    prioritiesOutcome,
    authority,
    programs,
    priorities,
    accountsOnPage: input.accounts.malformed ? 0 : input.accounts.accounts.length,
    priorScanComplete,
  };
}

function norm(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function codeToken(haystack: string | null | undefined, code: string): boolean {
  if (!haystack) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(haystack);
}

export interface ForecastCandidate {
  id: string;
  source_agency: string | null;
  title: string | null;
  program_office: string | null;
  external_id: string | null;
}

const MIN_INFERRED_NAME = 24;

/**
 * Verified: the forecast row carries the federal account code and its
 * source_agency is one of this department's forecast codes.
 * Inferred: the forecast title or program office equals the account name
 * (case and whitespace only) and the name is long enough to be distinctive.
 * Anything else is not a link.
 */
export function classifyBudgetLinks(input: {
  forecastCodes: string[];
  programs: Array<{ sourceKey: string; code: string; name: string }>;
  forecasts: ForecastCandidate[];
}): LinkRow[] {
  const allowed = new Set(input.forecastCodes);
  if (allowed.size === 0) return [];
  const links: LinkRow[] = [];
  const seen = new Set<string>();
  for (const program of input.programs) {
    const name = norm(program.name);
    for (const forecast of input.forecasts) {
      if (!forecast.source_agency || !allowed.has(forecast.source_agency)) continue;
      if (!forecast.id) continue;
      let status: LinkRow['link_status'] | null = null;
      let basis: string | null = null;
      if (
        norm(forecast.external_id) === program.code
        || norm(forecast.program_office) === program.code
        || norm(forecast.title) === program.code
        || codeToken(forecast.external_id, program.code)
        || codeToken(forecast.title, program.code)
        || codeToken(forecast.program_office, program.code)
      ) {
        status = 'verified';
        basis = 'federal_account_code';
      } else if (name.length >= MIN_INFERRED_NAME && (norm(forecast.title) === name || norm(forecast.program_office) === name)) {
        status = 'inferred';
        basis = 'exact_account_name';
      }
      if (!status || !basis) continue;
      const key = `${program.sourceKey}:${forecast.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        source_table: 'budget_programs',
        source_key: program.sourceKey,
        target_table: 'agency_forecasts',
        target_id: forecast.id,
        link_status: status,
        match_basis: basis,
        evidence: {
          federal_account_code: program.code,
          program_name: program.name,
          forecast_source_agency: forecast.source_agency,
          forecast_title: forecast.title,
          forecast_program_office: forecast.program_office,
          forecast_external_id: forecast.external_id,
        },
      });
    }
  }
  return links;
}
