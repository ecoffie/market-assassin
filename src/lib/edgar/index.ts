/**
 * SEC EDGAR client — turns an incumbent company NAME into a competitive financial
 * read (revenue, net income, gross margin, public float, employees, latest 10-K).
 *
 * WHY: EDGAR is the public-filers financial ground truth. A public incumbent's
 * financial shape predicts how it competes (a multi-billion slow mover sub-
 * contracts set-asides differently than a lean commercial firm). Private
 * contractors have no EDGAR filing → this client returns null and the tool reports
 * grounded=false (honest miss, not invented numbers). (PRD §5a — EDGAR net-new.)
 *
 * API: free, NO key. Two hard SEC rules:
 *   1. `User-Agent: <name> (<contact email>)` is REQUIRED on every request — SEC
 *      blocks requests without it (10 req/s ceiling, generously enforced).
 *   2. `data.sec.gov` (companyfacts/submissions) and `www.sec.gov` (static files)
 *      are separate hosts — use the right one per endpoint.
 *
 * Caching: company_tickers.json (24h, static-ish), companyfacts (24h, financials
 * don't move intraday), submissions (6h, filings land during the day). Backed by
 * the shared `mcp_external_cache` table; degrades to no-cache on any error
 * (see src/lib/mcp/external-cache.ts). Rate-limited via the shared KV limiter
 * (fails open).
 */
import { withCache } from '@/lib/mcp/external-cache';
import { checkRateLimit } from '@/lib/rate-limit';

const TICKERS_TTL = 24 * 60 * 60; // 24h
const FACTS_TTL = 24 * 60 * 60; // 24h
const SUBMISSIONS_TTL = 6 * 60 * 60; // 6h

const HOST_FILES = 'https://www.sec.gov';
const HOST_DATA = 'https://data.sec.gov';

function contactEmail(): string {
  return (process.env.MCP_CONTACT_EMAIL || 'hello@govcongiants.com').trim();
}

function userAgent(): string {
  return `Mindy-MCP-GovConGiants (${contactEmail()})`;
}

async function edgarFetch(url: string): Promise<Response> {
  // Shared KV limiter — fails open (KV down => allow). SEC's own 10 req/s ceiling
  // is the real backstop; this just keeps us polite across the fleet.
  await checkRateLimit('mcp:edgar', 10, 1).catch(() => {});
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`EDGAR ${res.status} for ${url}`);
  }
  return res;
}

/** Normalize a company name for matching against EDGAR's title field. */
function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(INC|CORPORATION|CORP|LLC|LP|CO|LTD|HOLDINGS|GROUP|THE|COMPANY)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface EdgartickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

/** Cache the full company_tickers.json index (name + ticker → CIK). ~6000 rows. */
async function loadTickerIndex(): Promise<EdgartickerEntry[]> {
  const { value } = await withCache<EdgartickerEntry[]>(
    'edgar:tickers',
    {},
    TICKERS_TTL,
    async () => {
      const res = await edgarFetch(`${HOST_FILES}/files/company_tickers.json`);
      const obj = (await res.json()) as Record<string, EdgartickerEntry>;
      return Object.values(obj);
    },
  );
  return value;
}

export interface EdgarCompanyMatch {
  cik: number;
  ticker: string | null;
  title: string;
  /** 0..1 — how well the query matched the title (1 = exact normalized). */
  matchScore: number;
}

/**
 * Resolve a free-text company name to a CIK via the ticker index. Best-effort:
 * exact normalized title → normalized contains (query in title OR title in query)
 * → first token match. Returns null when nothing plausible is found (a private
 * contractor or a name EDGAR doesn't index).
 */
export async function resolveCompany(query: string): Promise<EdgarCompanyMatch | null> {
  const q = normalizeName(query);
  if (!q) return null;
  let entries: EdgartickerEntry[];
  try {
    entries = await loadTickerIndex();
  } catch (err) {
    console.error('[mcp:edgar] ticker index load failed:', err);
    return null;
  }
  if (!entries.length) return null;

  const norm = (s: string) => normalizeName(s);
  // 1) exact normalized
  let best: EdgarCompanyMatch | null = null;
  for (const e of entries) {
    if (norm(e.title) === q) {
      best = { cik: e.cik_str, ticker: e.ticker, title: e.title, matchScore: 1 };
      break;
    }
  }
  if (best) return best;

  // 2) query tokens contained in title (and vice versa) — pick the tightest
  let score = 0;
  for (const e of entries) {
    const t = norm(e.title);
    if (!t) continue;
    let s = 0;
    // Substring containment both ways — but guard against TINY normalized titles
    // (e.g. "XYZ Inc" → "XYZ", len 3) being "contained" in a long query and
    // manufacturing a false match. Require the shorter side to be substantial.
    if (q.length >= 3 && t.includes(q)) s = 0.9;
    else if (t.length >= 4 && t.length >= q.length * 0.4 && q.includes(t)) s = 0.85;
    else {
      // token overlap — count only SIGNIFICANT tokens (len >= 3) so single letters
      // and common suffixes (CO/INC, already stripped) don't manufacture false
      // matches against a 6000-row index.
      const qt = q.split(' ').filter((w) => w.length >= 3);
      const tt = new Set(t.split(' ').filter((w) => w.length >= 3));
      const overlap = qt.filter((w) => tt.has(w)).length;
      // Require at least 2 significant tokens shared — a single common word like
      // "PRIVATE" is NOT enough to claim this is the company.
      if (overlap >= 2 && overlap >= Math.ceil(qt.length * 0.5)) s = 0.5 + 0.1 * overlap;
    }
    if (s > score) {
      score = s;
      best = { cik: e.cik_str, ticker: e.ticker, title: e.title, matchScore: s };
    }
  }
  return best && score >= 0.5 ? best : null;
}

/** CIK padded to 10 digits — the form data.sec.gov URLs require. */
function padCik(cik: number): string {
  return String(cik).padStart(10, '0');

}

interface XbrlUnit {
  start?: string | null;
  end?: string | null;
  val: number;
  accn?: string;
  fy?: number | null;
  fp?: string | null;
  form?: string;
  frame?: string;
}

interface CompanyFacts {
  entityName?: string;
  facts?: {
    'us-gaap'?: Record<string, { units?: Record<string, XbrlUnit[]> }>;
    'dei'?: Record<string, { units?: Record<string, XbrlUnit[]> }>;
  };
}

async function loadCompanyFacts(cik: number): Promise<CompanyFacts | null> {
  try {
    const { value } = await withCache<CompanyFacts | null>(
      'edgar:facts',
      { cik },
      FACTS_TTL,
      async () => {
        const res = await edgarFetch(`${HOST_DATA}/api/xbrl/companyfacts/CIK${padCik(cik)}.json`);
        return (await res.json()) as CompanyFacts;
      },
    );
    return value;
  } catch (err) {
    console.error('[mcp:edgar] companyfacts load failed:', err);
    return null;
  }
}

/**
 * Pull the annual (FY) values for a us-gaap concept, most-recent fiscal year first.
 * Tries a list of concept names in order (filers don't all use the same tag).
 */
function annualValues(
  facts: CompanyFacts,
  concepts: string[],
  limit = 4,
): Array<{ fy: number; fp: string; val: number; end: string | null }> {
  const usgaap = facts.facts?.['us-gaap'];
  if (!usgaap) return [];
  for (const c of concepts) {
    const units = usgaap[c]?.units;
    if (!units) continue;
    // USD for dollar amounts; for shares/other the unit key varies — try USD then any.
    const bucket = units['USD'] ?? units[Object.keys(units)[0]];
    if (!bucket?.length) continue;
    const fyRows = bucket
      .filter((r) => r.fp === 'FY' && typeof r.fy === 'number' && r.val !== undefined)
      .sort((a, b) => (b.fy ?? 0) - (a.fy ?? 0));
    // dedupe by fy (keep the first = most recent filing for that fy)
    const seen = new Set<number>();
    const out: Array<{ fy: number; fp: string; val: number; end: string | null }> = [];
    for (const r of fyRows) {
      if (r.fy === undefined || r.fy === null) continue;
      if (seen.has(r.fy)) continue;
      seen.add(r.fy);
      out.push({ fy: r.fy, fp: r.fp as string, val: r.val, end: r.end ?? null });
      if (out.length >= limit) break;
    }
    if (out.length) return out;
  }
  return [];
}

function latestValue(facts: CompanyFacts, concepts: string[]): { val: number; fy?: number; end?: string | null } | null {
  const rows = annualValues(facts, concepts, 1);
  if (!rows.length) return null;
  return { val: rows[0].val, fy: rows[0].fy, end: rows[0].end };
}

export interface EdgarFilings {
  recent: {
    form: string[];
    filingDate: string[];
    accessionNumber: string[];
    primaryDocument: string[];
  };
}

async function loadSubmissions(cik: number): Promise<EdgarFilings | null> {
  try {
    const { value } = await withCache<EdgarFilings | null>(
      'edgar:submissions',
      { cik },
      SUBMISSIONS_TTL,
      async () => {
        const res = await edgarFetch(`${HOST_DATA}/submissions/CIK${padCik(cik)}.json`);
        const j = (await res.json()) as { filings?: EdgarFilings };
        return j.filings ?? null;
      },
    );
    return value;
  } catch (err) {
    console.error('[mcp:edgar] submissions load failed:', err);
    return null;
  }
}

export interface EdgarFinancialYear {
  fy: number;
  revenue: number | null;
  net_income: number | null;
  gross_profit: number | null;
  gross_margin_pct: number | null;
}

export interface EdgarIntel {
  company: {
    name: string;
    cik: number;
    ticker: string | null;
    sic_code?: string;
    sic_description?: string;
    match_score: number;
  };
  financials: EdgarFinancialYear[];
  employees: number | null;
  public_float_usd: number | null;
  latest_10k_url: string | null;
  latest_10k_filed: string | null;
  filings: Array<{ type: string; date: string; url: string }>;
}

const REVENUE_CONCEPTS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
const NET_INCOME_CONCEPTS = ['NetIncomeLoss', 'ProfitLoss'];
const GROSS_PROFIT_CONCEPTS = ['GrossProfit'];
const FLOAT_CONCEPTS = ['EntityPublicFloat'];
const EMPLOYEE_CONCEPTS = ['EntityEmployeesNumber'];

function accessionToUrl(cik: number, accessionNumber: string): string {
  const clean = accessionNumber.replace(/-/g, '');
  return `${HOST_FILES}/Archives/edgar/data/${cik}/${clean}/`;
}

/**
 * Resolve a name → CIK → full financial read. Returns null when the company isn't
 * a public filer (private contractor / no CIK match) — the tool reports that as a
 * grounded=false honest miss, NOT invented numbers.
 */
export async function getIncumbentFinancialsFromEdgar(query: string): Promise<EdgarIntel | null> {
  const match = await resolveCompany(query);
  if (!match) return null;

  const [facts, submissions] = await Promise.all([loadCompanyFacts(match.cik), loadSubmissions(match.cik)]);

  // Assemble annual financials by joining revenue / net income / gross profit on fy.
  const rev = facts ? annualValues(facts, REVENUE_CONCEPTS, 4) : [];
  const ni = facts ? annualValues(facts, NET_INCOME_CONCEPTS, 4) : [];
  const gp = facts ? annualValues(facts, GROSS_PROFIT_CONCEPTS, 4) : [];
  const niByFy = new Map(ni.map((r) => [r.fy, r.val]));
  const gpByFy = new Map(gp.map((r) => [r.fy, r.val]));

  const financials: EdgarFinancialYear[] = rev.map((r) => {
    const netIncome = niByFy.get(r.fy) ?? null;
    const grossProfit = gpByFy.get(r.fy) ?? null;
    const grossMarginPct =
      grossProfit !== null && r.val ? (grossProfit / r.val) * 100 : null;
    return {
      fy: r.fy,
      revenue: r.val,
      net_income: netIncome,
      gross_profit: grossProfit,
      gross_margin_pct: grossMarginPct,
    };
  });

  const employees = facts ? latestValue(facts, EMPLOYEE_CONCEPTS)?.val ?? null : null;
  const publicFloat = facts ? latestValue(facts, FLOAT_CONCEPTS)?.val ?? null : null;

  // Latest 10-K URL + recent filings list from submissions.
  let latest10kUrl: string | null = null;
  let latest10kFiled: string | null = null;
  const filings: Array<{ type: string; date: string; url: string }> = [];
  if (submissions?.recent) {
    const r = submissions.recent;
    const n = Math.min(r.form?.length ?? 0, r.filingDate?.length ?? 0, r.accessionNumber?.length ?? 0, r.primaryDocument?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const form = r.form[i];
      const url = `${accessionToUrl(match.cik, r.accessionNumber[i])}${r.primaryDocument[i] || ''}`;
      filings.push({ type: form, date: r.filingDate[i], url });
      if (!latest10kUrl && form === '10-K') {
        latest10kUrl = url;
        latest10kFiled = r.filingDate[i];
      }
      if (filings.length >= 5) break;
    }
    // If the 10-K wasn't in the first 5, scan the rest just for it.
    if (!latest10kUrl) {
      for (let i = 0; i < n; i++) {
        if (r.form[i] === '10-K') {
          latest10kUrl = `${accessionToUrl(match.cik, r.accessionNumber[i])}${r.primaryDocument[i] || ''}`;
          latest10kFiled = r.filingDate[i];
          break;
        }
      }
    }
  }

  return {
    company: {
      name: match.title,
      cik: match.cik,
      ticker: match.ticker,
      match_score: match.matchScore,
    },
    financials,
    employees,
    public_float_usd: publicFloat,
    latest_10k_url: latest10kUrl,
    latest_10k_filed: latest10kFiled,
    filings,
  };
}