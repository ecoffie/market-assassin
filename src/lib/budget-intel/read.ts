/**
 * Customer reads. The live table wins when it has any row. The fixed file is
 * used only when that table is confirmed empty, or when the read itself failed
 * (labeled unmeasured — not labeled empty). Search ranking does not call this.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBudgetForAgency } from '@/lib/utils/budget-authority';

export interface FileAuthority {
  agency: string;
  toptierCode: string | null;
  fy2025: number | null;
  fy2026: number | null;
  changeAmount: number | null;
  changeRatio: number | null;
  trend: string | null;
}

export type TableProbe = 'empty' | 'unmeasured' | 'ready';

export interface LiveAuthorityYear {
  fiscalYear: number;
  budgetAuthority: number | null;
  obligated: number | null;
  outlays: number | null;
  changeAmount: number | null;
  changeRatio: number | null;
  trend: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

export interface LiveAuthority {
  agency: string;
  toptierCode: string | null;
  years: LiveAuthorityYear[];
}

export interface AuthorityDisplay {
  shown: 'live_table' | 'static_file';
  shown_reason: 'live_table' | 'live_table_empty' | 'live_table_unmeasured' | 'agency_not_in_live_table';
  agency: string | null;
  toptier_code: string | null;
  fiscal_years: number[];
  fy2025_budget_authority: number | null;
  fy2026_budget_authority: number | null;
  change_amount: number | null;
  /** Ratio, same meaning as the fixed file: 1.05 is +5%. */
  change_percent: number | null;
  /** Percent change. -18.3 means down 18.3%. */
  change_percent_points: number | null;
  trend: string | null;
  source: string;
  source_url: string | null;
  fetched_at: string | null;
  grounded: boolean;
}

export interface ProgramMatch {
  agency: string;
  program_name: string;
  program_code: string | null;
  fiscal_year: number | null;
  obligated_amount: number | null;
  funding_trend: string | null;
  category: string | null;
  source_url: string | null;
  fetched_at: string | null;
}

export interface ProgramAnswer {
  shown: 'live_table' | 'unavailable';
  shown_reason: 'live_table' | 'none_found' | 'live_table_empty' | 'live_table_unmeasured' | 'keyword_rejected';
  keyword: string | null;
  agencies: ProgramMatch[] | null;
  note: string;
}

function points(ratio: number | null): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return Math.round((ratio - 1) * 10000) / 100;
}

export function decideAuthorityDisplay(input: {
  table: TableProbe;
  live: LiveAuthority | null;
  file: FileAuthority | null;
  fileSource: string;
}): AuthorityDisplay {
  const blank: AuthorityDisplay = {
    shown: 'static_file',
    shown_reason: 'live_table_empty',
    agency: input.file?.agency ?? null,
    toptier_code: input.file?.toptierCode ?? null,
    fiscal_years: [],
    fy2025_budget_authority: null,
    fy2026_budget_authority: null,
    change_amount: null,
    change_percent: null,
    change_percent_points: null,
    trend: null,
    source: input.fileSource,
    source_url: null,
    fetched_at: null,
    grounded: false,
  };
  if (input.table === 'ready') {
    if (!input.live || input.live.years.length === 0) {
      return {
        ...blank,
        shown: 'live_table',
        shown_reason: 'agency_not_in_live_table',
        agency: null,
        toptier_code: null,
        source: 'USASpending budgetary resources (agency_budget_authority)',
        grounded: false,
      };
    }
    const newest = [...input.live.years].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
    const y2025 = input.live.years.find((year) => year.fiscalYear === 2025);
    const y2026 = input.live.years.find((year) => year.fiscalYear === 2026);
    return {
      shown: 'live_table',
      shown_reason: 'live_table',
      agency: input.live.agency,
      toptier_code: input.live.toptierCode,
      fiscal_years: input.live.years.map((year) => year.fiscalYear).sort((a, b) => a - b),
      fy2025_budget_authority: y2025?.budgetAuthority ?? null,
      fy2026_budget_authority: y2026?.budgetAuthority ?? null,
      change_amount: newest?.changeAmount ?? null,
      change_percent: newest?.changeRatio ?? null,
      change_percent_points: points(newest?.changeRatio ?? null),
      trend: newest?.trend ?? null,
      source: 'USASpending budgetary resources (agency_budget_authority)',
      source_url: newest?.sourceUrl ?? null,
      fetched_at: newest?.fetchedAt ?? null,
      grounded: newest?.budgetAuthority != null,
    };
  }
  if (!input.file) return { ...blank, shown_reason: input.table === 'unmeasured' ? 'live_table_unmeasured' : 'live_table_empty' };
  return {
    ...blank,
    shown_reason: input.table === 'unmeasured' ? 'live_table_unmeasured' : 'live_table_empty',
    fiscal_years: [2025, 2026],
    fy2025_budget_authority: input.file.fy2025,
    fy2026_budget_authority: input.file.fy2026,
    change_amount: input.file.changeAmount,
    change_percent: input.file.changeRatio,
    change_percent_points: points(input.file.changeRatio),
    trend: input.file.trend,
    grounded: true,
  };
}

export function decideProgramAnswer(input: {
  table: TableProbe;
  keyword: string | null;
  matches: ProgramMatch[] | null;
}): ProgramAnswer {
  if (!input.keyword) {
    return {
      shown: 'unavailable',
      shown_reason: 'keyword_rejected',
      keyword: null,
      agencies: null,
      note: 'Program keyword was empty or not a plain word. No agency list was queried.',
    };
  }
  if (input.table === 'empty') {
    return {
      shown: 'unavailable',
      shown_reason: 'live_table_empty',
      keyword: input.keyword,
      agencies: null,
      note: 'budget_programs has no rows. The fixed budget file has no federal-account obligations, so it is not used as a zero.',
    };
  }
  if (input.table !== 'ready' || input.matches == null) {
    return {
      shown: 'unavailable',
      shown_reason: 'live_table_unmeasured',
      keyword: input.keyword,
      agencies: null,
      note: 'budget_programs could not be read. This is not a finding that no agency is increasing spending.',
    };
  }
  if (input.matches.length === 0) {
    return {
      shown: 'live_table',
      shown_reason: 'none_found',
      keyword: input.keyword,
      agencies: [],
      note: 'Live federal-account rows were read. None with this keyword are marked growing or surging. Accounts without a prior-year comparison are not listed.',
    };
  }
  return {
    shown: 'live_table',
    shown_reason: 'live_table',
    keyword: input.keyword,
    agencies: input.matches,
    note: 'Obligations from USASpending federal accounts stored in budget_programs. amount_basis is obligations, not enacted budget authority.',
  };
}

export function safeProgramKeyword(raw: string): string | null {
  const keyword = raw.trim().toLowerCase().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (keyword.length < 3 || keyword.length > 40) return null;
  if (!/^[a-z0-9][a-z0-9 -]*$/.test(keyword)) return null;
  return keyword;
}

function db(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function tableState(client: SupabaseClient, table: string): Promise<TableProbe> {
  const { count, error } = await client.from(table).select('id', { count: 'exact', head: true });
  if (error || count == null) return 'unmeasured';
  return count === 0 ? 'empty' : 'ready';
}

export async function probeLiveAuthority(
  names: string[],
  client?: SupabaseClient | null,
): Promise<{ table: TableProbe; live: LiveAuthority | null }> {
  const sb = client === undefined ? db() : client;
  if (!sb) return { table: 'unmeasured', live: null };
  try {
    const table = await tableState(sb, 'agency_budget_authority');
    if (table !== 'ready') return { table, live: null };
    const unique = [...new Set(names.filter(Boolean))];
    if (unique.length === 0) return { table: 'ready', live: null };
    let query = sb.from('agency_budget_authority').select(
      'agency, toptier_code, fiscal_year, budget_authority, obligated, outlays, change_amount, change_percent, trend, source_url, fetched_at',
    ).limit(8);
    query = unique.length === 1 ? query.eq('agency', unique[0]) : query.in('agency', unique);
    const { data, error } = await query;
    if (error) return { table: 'unmeasured', live: null };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return { table: 'ready', live: null };
    return {
      table: 'ready',
      live: {
        agency: String(rows[0].agency),
        toptierCode: rows[0].toptier_code == null ? null : String(rows[0].toptier_code),
        years: rows.map((row) => ({
          fiscalYear: Number(row.fiscal_year),
          budgetAuthority: typeof row.budget_authority === 'number' ? row.budget_authority : null,
          obligated: typeof row.obligated === 'number' ? row.obligated : null,
          outlays: typeof row.outlays === 'number' ? row.outlays : null,
          changeAmount: typeof row.change_amount === 'number' ? row.change_amount : null,
          changeRatio: typeof row.change_percent === 'number' ? row.change_percent : null,
          trend: row.trend == null ? null : String(row.trend),
          sourceUrl: row.source_url == null ? null : String(row.source_url),
          fetchedAt: row.fetched_at == null ? null : String(row.fetched_at),
        })),
      },
    };
  } catch {
    return { table: 'unmeasured', live: null };
  }
}

export async function listLiveAuthority(
  client?: SupabaseClient | null,
): Promise<{ table: TableProbe; rows: AuthorityDisplay[] }> {
  const sb = client === undefined ? db() : client;
  if (!sb) return { table: 'unmeasured', rows: [] };
  try {
    const table = await tableState(sb, 'agency_budget_authority');
    if (table !== 'ready') return { table, rows: [] };
    const { data, error } = await sb.from('agency_budget_authority').select(
      'agency, toptier_code, fiscal_year, budget_authority, obligated, outlays, change_amount, change_percent, trend, source_url, fetched_at',
    ).limit(500);
    if (error || !data) return { table: 'unmeasured', rows: [] };
    const byAgency = new Map<string, LiveAuthority>();
    for (const row of data as Array<Record<string, unknown>>) {
      const agency = String(row.agency ?? '');
      const year: LiveAuthorityYear = {
        fiscalYear: Number(row.fiscal_year),
        budgetAuthority: typeof row.budget_authority === 'number' ? row.budget_authority : null,
        obligated: typeof row.obligated === 'number' ? row.obligated : null,
        outlays: typeof row.outlays === 'number' ? row.outlays : null,
        changeAmount: typeof row.change_amount === 'number' ? row.change_amount : null,
        changeRatio: typeof row.change_percent === 'number' ? row.change_percent : null,
        trend: row.trend == null ? null : String(row.trend),
        sourceUrl: row.source_url == null ? null : String(row.source_url),
        fetchedAt: row.fetched_at == null ? null : String(row.fetched_at),
      };
      const existing = byAgency.get(agency);
      if (existing) existing.years.push(year);
      else byAgency.set(agency, {
        agency,
        toptierCode: row.toptier_code == null ? null : String(row.toptier_code),
        years: [year],
      });
    }
    return {
      table: 'ready',
      rows: [...byAgency.values()].map((live) => decideAuthorityDisplay({
        table: 'ready', live, file: null, fileSource: '',
      })),
    };
  } catch {
    return { table: 'unmeasured', rows: [] };
  }
}

export async function presentAgencyBudget(agencyName: string, client?: SupabaseClient | null): Promise<AuthorityDisplay> {
  const row = getBudgetForAgency(agencyName);
  const file: FileAuthority | null = row ? {
    agency: row.agency,
    toptierCode: row.toptierCode,
    fy2025: row.fy2025?.budgetAuthority ?? null,
    fy2026: row.fy2026?.budgetAuthority ?? null,
    changeAmount: row.change?.amount ?? null,
    changeRatio: row.change?.percent ?? null,
    trend: row.change?.trend ?? null,
  } : null;
  const fileSource = 'OMB FY2026 discretionary request + agency CBJs (agency-budget-data.json)';
  const names = [file?.agency, agencyName].filter((name): name is string => !!name);
  const probe = await probeLiveAuthority(names, client);
  return decideAuthorityDisplay({ table: probe.table, live: probe.live, file, fileSource });
}

export async function readIncreasingPrograms(input: {
  keyword: string;
  agency?: string | null;
  client?: SupabaseClient | null;
}): Promise<ProgramAnswer> {
  const keyword = safeProgramKeyword(input.keyword);
  if (!keyword) return decideProgramAnswer({ table: 'empty', keyword: null, matches: null });
  const sb = input.client === undefined ? db() : input.client;
  if (!sb) return decideProgramAnswer({ table: 'unmeasured', keyword, matches: null });
  try {
    const table = await tableState(sb, 'budget_programs');
    if (table !== 'ready') return decideProgramAnswer({ table, keyword, matches: null });
    let query = sb.from('budget_programs').select(
      'agency, program_name, program_code, fiscal_year, obligated_amount, funding_trend, category, source_url, document_url, fetched_at',
    ).ilike('program_name', `%${keyword}%`).in('funding_trend', ['growing', 'surging']).limit(25);
    if (input.agency) {
      const file = getBudgetForAgency(input.agency);
      query = query.eq('agency', file?.agency || input.agency);
    }
    const { data, error } = await query;
    if (error) return decideProgramAnswer({ table: 'unmeasured', keyword, matches: null });
    const matches: ProgramMatch[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      agency: String(row.agency ?? ''),
      program_name: String(row.program_name ?? ''),
      program_code: row.program_code == null ? null : String(row.program_code),
      fiscal_year: typeof row.fiscal_year === 'number' ? row.fiscal_year : null,
      obligated_amount: typeof row.obligated_amount === 'number' ? row.obligated_amount : null,
      funding_trend: row.funding_trend == null ? null : String(row.funding_trend),
      category: row.category == null ? null : String(row.category),
      source_url: row.source_url == null ? (row.document_url == null ? null : String(row.document_url)) : String(row.source_url),
      fetched_at: row.fetched_at == null ? null : String(row.fetched_at),
    }));
    return decideProgramAnswer({ table: 'ready', keyword, matches });
  } catch {
    return decideProgramAnswer({ table: 'unmeasured', keyword, matches: null });
  }
}
