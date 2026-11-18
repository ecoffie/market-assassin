/**
 * Live reads for one budget slice. No database access.
 */
import {
  ACCOUNTS_PER_RUN,
  PRIOR_YEAR_PAGE_CAP,
  buildBudgetSlice,
  buildRoster,
  consecutivePair,
  federalAccountUrl,
  parseBudgetYears,
  parseFederalAccountPage,
  performanceGovUrl,
  type AccountPage,
  type BudgetCursor,
  type BudgetSlice,
  type RosterAgency,
} from './slice';
import toptierCodes from '@/data/agency-toptier-codes.json';

export class BudgetSourceDown extends Error {
  constructor(public source: string, public status: number | null) {
    super(`${source} returned ${status ?? 'network error'}`);
    this.name = 'BudgetSourceDown';
  }
}

type FetchLike = typeof fetch;

async function getText(url: string, fetcher: FetchLike, timeoutMs: number): Promise<{ status: number; body: string }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/html' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new BudgetSourceDown(url, null);
  }
  const body = await response.text();
  return { status: response.status, body };
}

async function getJson(url: string, fetcher: FetchLike): Promise<unknown> {
  const { status, body } = await getText(url, fetcher, 12_000);
  if (status < 200 || status >= 300) throw new BudgetSourceDown(url, status);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BudgetSourceDown(url, status);
  }
}

async function accountPagesForCodes(
  agency: RosterAgency,
  fiscalYear: number,
  wanted: Set<string>,
  fetcher: FetchLike,
): Promise<AccountPage[]> {
  const pages: AccountPage[] = [];
  for (let page = 1; page <= PRIOR_YEAR_PAGE_CAP; page++) {
    const payload = await getJson(federalAccountUrl(agency.toptierCode, fiscalYear, page), fetcher);
    const parsed = parseFederalAccountPage(payload);
    if (parsed.malformed) throw new BudgetSourceDown(federalAccountUrl(agency.toptierCode, fiscalYear, page), 200);
    pages.push(parsed);
    const seen = new Set(pages.flatMap((item) => item.accounts.map((account) => account.code)));
    const foundAll = [...wanted].every((code) => seen.has(code));
    if (foundAll || !parsed.hasNext) break;
  }
  return pages;
}

export async function fetchBudgetSlice(
  cursor: BudgetCursor,
  fetcher: FetchLike = fetch,
): Promise<BudgetSlice & { skippedDuplicateToptier: string[] }> {
  const { agencies, skippedDuplicateToptier } = buildRoster(
    toptierCodes as Record<string, { code: string; abbreviation: string }>,
  );
  const agency = agencies[cursor.agencyIndex];
  if (!agency) throw new BudgetSourceDown('roster', null);
  const fetchedAt = new Date().toISOString();
  const resources = await getJson(
    `https://api.usaspending.gov/api/v2/agency/${agency.toptierCode}/budgetary_resources/`,
    fetcher,
  );
  const years = parseBudgetYears(resources);
  const pair = consecutivePair(years);

  let accounts = parseFederalAccountPage({ results: [], page_metadata: { page: cursor.page, total: 0, hasNext: false, next: null } });
  let priorPages: AccountPage[] = [];
  if (pair) {
    const currentUrl = federalAccountUrl(agency.toptierCode, pair.newer.fiscalYear, cursor.page);
    const currentPayload = await getJson(currentUrl, fetcher);
    accounts = parseFederalAccountPage(currentPayload);
    if (accounts.malformed) throw new BudgetSourceDown(currentUrl, 200);
    if (pair.older) {
      const wanted = new Set(accounts.accounts.map((account) => account.code));
      priorPages = await accountPagesForCodes(agency, pair.older.fiscalYear, wanted, fetcher);
    }
  }

  let prioritiesBody: string | null = null;
  let prioritiesSourceDown = false;
  if (agency.performanceGovSlug) {
    const url = performanceGovUrl(agency.performanceGovSlug);
    try {
      const response = await getText(url, fetcher, 12_000);
      if (response.status < 200 || response.status >= 300) prioritiesSourceDown = true;
      else prioritiesBody = response.body;
    } catch (error) {
      if (error instanceof BudgetSourceDown) prioritiesSourceDown = true;
      else throw error;
    }
  }

  const slice = buildBudgetSlice({
    agency,
    cursor,
    rosterLength: agencies.length,
    years,
    accounts,
    priorPages,
    prioritiesBody,
    prioritiesSourceDown,
    fetchedAt,
  });
  return { ...slice, skippedDuplicateToptier };
}
