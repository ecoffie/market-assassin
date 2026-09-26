/**
 * SBIR/STTR search — the query behind the MCP tool `search_sbir`.
 *
 * ── OPEN TOPICS ARE NOT AWARD HISTORY (2026-09-26) ─────────────────────────────────────────
 * The three sources answer two DIFFERENT questions and are returned in two separate lists:
 *
 *   open_topics    — something a firm can still propose to. Only `dod_sbir_topics` rows (and a
 *                    non-NIH multisite row) whose close date has not passed qualify.
 *   award_history  — projects NIH already FUNDED (who won what). NIH RePORTER, and every
 *                    `aggregated_opportunities` sbir_sttr row sourced from `nih_reporter`
 *                    (measured 2026-09-26: 42/42 rows, each a reporter.nih.gov/project-details
 *                    page whose `close_date` is the PROJECT END date, not a deadline).
 *
 * Before this, all of them were merged into one `opportunities` list with an `endDate`, and the
 * only statement that NIH rows were awards lived in `_ai_hint` — OFF by default. A host asked for
 * "open SBIR topics" received funded biomedical projects with a 2027 "endDate" that reads like a
 * deadline. An award is never placed in open_topics, whatever the caller asked for.
 *
 * ── EVERY SOURCE REPORTS HOW IT ENDED ──────────────────────────────────────────────────────
 * `sources[]` carries ok | empty | error | timeout | unavailable per source. `unavailable` is
 * NOT `empty`: the DoD open-topic cache held 0 rows fleet-wide on 2026-09-26, and "no open topics
 * matched" would have been a false statement about the market. Unknown is never turned into zero.
 *
 * ── BOUNDED ────────────────────────────────────────────────────────────────────────────────
 * The NIH fetch had no timeout, so a hung upstream held the request until the platform killed the
 * function — and a killed invocation writes no mcp_call_log row at all. Each source now has a
 * deadline and NIH gets exactly one retry on 429/5xx, inside the same budget.
 */
import { createClient } from '@supabase/supabase-js';

const NIH_API = 'https://api.reporter.nih.gov/v2/projects/search';
export const NIH_TIMEOUT_MS = 8_000;
export const DB_TIMEOUT_MS = 5_000;
const NIH_RETRY_DELAY_MS = 750;

const PHASE_CODES: Record<string, string[]> = {
  '1': ['R43', 'R41'], // SBIR + STTR Phase I
  '2': ['R44', 'R42'], // SBIR + STTR Phase II
  all: ['R43', 'R44', 'R41', 'R42'],
};
const CODE_PHASE: Record<string, string> = {
  R43: 'SBIR Phase I',
  R44: 'SBIR Phase II',
  R41: 'STTR Phase I',
  R42: 'STTR Phase II',
};

export type SbirSource = 'nih' | 'multisite' | 'dod' | 'all';
export type SbirRecordKind = 'open_topic' | 'award_history';
export type SbirSourceStatus = 'ok' | 'empty' | 'error' | 'timeout' | 'unavailable';
/** Where the caller's keyword was found: in the title, only in the body, or only by the upstream. */
export type SbirRelevance = 'title' | 'body' | 'upstream_only' | 'no_keyword';

export interface SbirSearchInput {
  keyword?: string;
  /** NIH institute (NCI, NIAID, …) or broad agency (NSF, DOD, …). */
  agency?: string;
  phase?: '1' | '2' | 'all';
  source?: SbirSource;
  limit?: number;
}

export interface SbirOpportunity {
  id: string;
  record_kind: SbirRecordKind;
  /** open/future/closed for a topic; `awarded` for a funded project. */
  status: 'open' | 'future' | 'awarded';
  title: string;
  agency: string;
  phase?: string;
  amount?: number;
  /** Topics only — the proposal deadline. Never set on an award. */
  close_date?: string;
  open_date?: string;
  /** Awards only — the funded project's period. Never a deadline. */
  project_start_date?: string;
  project_end_date?: string;
  organization?: string;
  location?: string;
  description?: string;
  relevance: SbirRelevance;
  source: string;
  url?: string;
}

export interface SbirSourceReport {
  source: 'nih_reporter' | 'multisite' | 'dod_sbir_topics';
  kind: SbirRecordKind | 'mixed';
  status: SbirSourceStatus;
  rows: number;
  ms: number;
  attempts?: number;
  /** Upstream HTTP status / error class — diagnosable in-band, not only in a log that expires. */
  detail?: string;
}

export interface SbirSearchResult {
  open_topics: SbirOpportunity[];
  award_history: SbirOpportunity[];
  sources: SbirSourceReport[];
  /** Any requested source errored or timed out. */
  degraded: boolean;
  /** Some sources answered and some did not — the lists are incomplete, not empty. */
  partial: boolean;
  /** False when no requested source could establish open topics (cache empty, errored, or not asked). */
  open_topics_established: boolean;
}

/* ── dependencies (injected by tests) ─────────────────────────────────────────────────── */

type Fetch = typeof fetch;
// A thin surface over the two reads we need, so tests can drive errors/timeouts without a DB.
export interface SbirDb {
  multisite(keyword: string, agency: string, limit: number, signal: AbortSignal): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  dodTopics(keyword: string, today: string, limit: number, signal: AbortSignal): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
  dodOpenCount(today: string, signal: AbortSignal): Promise<{ count: number | null; error: { message: string } | null }>;
}
export interface SbirDeps {
  fetch: Fetch;
  db: SbirDb;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  nihTimeoutMs: number;
  dbTimeoutMs: number;
}

/**
 * PostgREST `.or()` is a comma/paren-delimited logic tree. A keyword like "cybersecurity, AI"
 * fails to parse (measured: "failed to parse logic tree") and the source silently returned
 * nothing. `%`/`*` are wildcards. Replace all of them with spaces.
 */
export function sanitizeForOrFilter(keyword: string): string {
  return keyword.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function supabaseDb(): SbirDb {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return {
    async multisite(keyword, agency, limit, signal) {
      let q = sb
        .from('aggregated_opportunities')
        .select('id,title,agency,set_aside,estimated_value,posted_date,close_date,description,source,source_url')
        .eq('opportunity_type', 'sbir_sttr')
        .order('posted_date', { ascending: false })
        .limit(limit)
        .abortSignal(signal);
      if (keyword) q = q.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
      if (agency) q = q.ilike('agency', `%${agency}%`);
      const { data, error } = await q;
      return { data: data as Record<string, unknown>[] | null, error };
    },
    async dodTopics(keyword, today, limit, signal) {
      let q = sb
        .from('dod_sbir_topics')
        .select('topic_number,title,solicitation_title,agency,branch,program,phase,open_date,close_date,status,description,url')
        // Open = deadline today or later. A NULL close date is kept only when the feed itself says
        // open/future — never assumed open.
        .or(`close_date.gte.${today},and(close_date.is.null,status.in.(open,future))`)
        .order('close_date', { ascending: true })
        .limit(limit)
        .abortSignal(signal);
      if (keyword) q = q.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%,topic_number.ilike.%${keyword}%`);
      const { data, error } = await q;
      return { data: data as Record<string, unknown>[] | null, error };
    },
    async dodOpenCount(today, signal) {
      const { count, error } = await sb
        .from('dod_sbir_topics')
        .select('topic_number', { count: 'exact', head: true })
        .or(`close_date.gte.${today},and(close_date.is.null,status.in.(open,future))`)
        .abortSignal(signal);
      return { count, error };
    },
  };
}

function defaultDeps(): SbirDeps {
  return {
    fetch,
    db: supabaseDb(),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    nihTimeoutMs: NIH_TIMEOUT_MS,
    dbTimeoutMs: DB_TIMEOUT_MS,
  };
}

/* ── relevance ──────────────────────────────────────────────────────────────────────────── */

const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'in', 'on', 'to', 'a', 'an', 'or']);
function keywordTerms(keyword: string): string[] {
  return keyword.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
}
function hasWord(text: string, term: string): boolean {
  // Word boundary on BOTH sides: "cyber" must not match "cyberbullying", "ai" must not match "said".
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}
export function classifyRelevance(keyword: string, title: string, description?: string): SbirRelevance {
  const terms = keywordTerms(keyword);
  if (!terms.length) return 'no_keyword';
  if (terms.every((t) => hasWord(title, t))) return 'title';
  if (description && terms.every((t) => hasWord(`${title} ${description}`, t))) return 'body';
  return 'upstream_only';
}
const RELEVANCE_RANK: Record<SbirRelevance, number> = { title: 0, no_keyword: 1, body: 2, upstream_only: 3 };

/* ── sources ────────────────────────────────────────────────────────────────────────────── */

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

async function fetchNih(
  deps: SbirDeps, keyword: string, agency: string, phase: string, limit: number,
): Promise<{ rows: SbirOpportunity[]; report: SbirSourceReport }> {
  const started = Date.now();
  const deadline = started + deps.nihTimeoutMs;
  const year = deps.now().getUTCFullYear();
  const criteria: Record<string, unknown> = {
    fiscal_years: [year, year + 1],
    activity_codes: PHASE_CODES[phase] ?? PHASE_CODES.all,
  };
  if (keyword) criteria.advanced_text_search = { operator: 'and', search_field: 'all', search_text: keyword };
  if (agency) criteria.agencies = [agency];
  const body = JSON.stringify({ criteria, offset: 0, limit, sort_field: 'award_notice_date', sort_order: 'desc' });
  const report = (status: SbirSourceStatus, rows: number, attempts: number, detail?: string): SbirSourceReport => ({
    source: 'nih_reporter', kind: 'award_history', status, rows, ms: Date.now() - started, attempts, ...(detail ? { detail } : {}),
  });

  let attempts = 0;
  let lastDetail = '';
  while (attempts < 2) {
    attempts++;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { rows: [], report: report('timeout', 0, attempts - 1, `budget ${deps.nihTimeoutMs}ms exhausted; ${lastDetail}`.trim()) };
    try {
      const res = await deps.fetch(NIH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(remaining),
      });
      if (!res.ok) {
        lastDetail = `HTTP ${res.status}`;
        console.error('[sbir:nih] returned', res.status, `(attempt ${attempts})`);
        // One retry, only for throttling / server-side failure, only if the budget allows it.
        if ((res.status === 429 || res.status >= 500) && attempts < 2 && deadline - Date.now() > NIH_RETRY_DELAY_MS + 500) {
          await deps.sleep(NIH_RETRY_DELAY_MS);
          continue;
        }
        return { rows: [], report: report('error', 0, attempts, lastDetail) };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: SbirOpportunity[] = (data.results || []).map((p: any) => {
        const org = p.organization || {};
        const title = p.project_title ?? '';
        const description = (p.abstract_text || '').slice(0, 500) || undefined;
        return {
          id: String(p.project_num ?? ''),
          record_kind: 'award_history',
          status: 'awarded',
          title,
          agency: p.agency_ic_admin?.abbreviation ?? 'NIH',
          phase: CODE_PHASE[p.activity_code] ?? undefined,
          amount: typeof p.award_amount === 'number' ? p.award_amount : undefined,
          project_start_date: p.project_start_date ?? undefined,
          project_end_date: p.project_end_date ?? undefined,
          organization: org.org_name ?? undefined,
          location: [org.org_city, org.org_state].filter(Boolean).join(', ') || undefined,
          description,
          relevance: classifyRelevance(keyword, title, p.abstract_text || ''),
          source: 'NIH RePORTER',
          url: p.project_num ? `https://reporter.nih.gov/project-details/${p.project_num}` : undefined,
        };
      });
      return { rows, report: report(rows.length ? 'ok' : 'empty', rows.length, attempts) };
    } catch (err) {
      if (isAbort(err)) {
        console.error(`[sbir:nih] timed out after ${Date.now() - started}ms (attempt ${attempts})`);
        return { rows: [], report: report('timeout', 0, attempts, `no response within ${deps.nihTimeoutMs}ms`) };
      }
      console.error('[sbir:nih] fetch failed:', err);
      return { rows: [], report: report('error', 0, attempts, (err as Error)?.message || 'fetch failed') };
    }
  }
  return { rows: [], report: report('error', 0, attempts, lastDetail) };
}

async function fetchMultisite(
  deps: SbirDeps, keyword: string, agency: string, limit: number, today: string,
): Promise<{ rows: SbirOpportunity[]; report: SbirSourceReport; closedDropped: number }> {
  const started = Date.now();
  const rep = (status: SbirSourceStatus, rows: number, detail?: string): SbirSourceReport => ({
    source: 'multisite', kind: 'mixed', status, rows, ms: Date.now() - started, ...(detail ? { detail } : {}),
  });
  try {
    const { data, error } = await deps.db.multisite(sanitizeForOrFilter(keyword), agency, limit, AbortSignal.timeout(deps.dbTimeoutMs));
    if (error) {
      const timedOut = /abort|timeout/i.test(error.message);
      console.error('[sbir:multisite] supabase error:', error.message);
      return { rows: [], report: rep(timedOut ? 'timeout' : 'error', 0, error.message), closedDropped: 0 };
    }
    const rows: SbirOpportunity[] = [];
    let closedDropped = 0;
    for (const r of data || []) {
      const src = String(r.source ?? '');
      const url = (r.source_url as string) ?? undefined;
      const title = String(r.title ?? '');
      const description = String(r.description || '').slice(0, 500) || undefined;
      const close = typeof r.close_date === 'string' ? r.close_date.slice(0, 10) : undefined;
      const isNihAward = src === 'nih_reporter' || /reporter\.nih\.gov\/project-details/.test(url || '');
      const base = {
        id: String(r.id ?? ''),
        title,
        agency: String(r.agency ?? 'Unknown'),
        amount: typeof r.estimated_value === 'number' ? r.estimated_value : undefined,
        description,
        relevance: classifyRelevance(keyword, title, String(r.description || '')),
        source: src || 'Multisite',
        url,
      };
      if (isNihAward) {
        // A funded project. Its close_date is the project END date — never report it as a deadline.
        rows.push({ ...base, record_kind: 'award_history', status: 'awarded', project_start_date: (r.posted_date as string)?.slice(0, 10), project_end_date: close });
      } else if (close && close >= today) {
        rows.push({ ...base, record_kind: 'open_topic', status: 'open', phase: (r.set_aside as string) ?? undefined, open_date: (r.posted_date as string)?.slice(0, 10), close_date: close });
      } else {
        closedDropped++; // closed or undated notice: not open, not an award → not returned as either.
      }
    }
    return { rows, report: rep(rows.length ? 'ok' : 'empty', rows.length, closedDropped ? `${closedDropped} closed/undated notice(s) omitted` : undefined), closedDropped };
  } catch (err) {
    console.error('[sbir:multisite] failed:', err);
    return { rows: [], report: rep(isAbort(err) ? 'timeout' : 'error', 0, (err as Error)?.message), closedDropped: 0 };
  }
}

/**
 * DoD SBIR/STTR OPEN topics from the dod_sbir_topics cache (never the rate-limited sbir.gov API).
 * Reports `unavailable` — not `empty` — when the cache holds no open topic at all, because then a
 * zero says nothing about the keyword.
 */
async function fetchDodSbir(
  deps: SbirDeps, keyword: string, limit: number, today: string,
): Promise<{ rows: SbirOpportunity[]; report: SbirSourceReport }> {
  const started = Date.now();
  const rep = (status: SbirSourceStatus, rows: number, detail?: string): SbirSourceReport => ({
    source: 'dod_sbir_topics', kind: 'open_topic', status, rows, ms: Date.now() - started, ...(detail ? { detail } : {}),
  });
  try {
    const signal = AbortSignal.timeout(deps.dbTimeoutMs);
    const [topics, open] = await Promise.all([
      deps.db.dodTopics(sanitizeForOrFilter(keyword), today, limit, signal),
      deps.db.dodOpenCount(today, signal),
    ]);
    const err = topics.error || open.error;
    if (err) {
      console.error('[sbir:dod] cache read failed:', err.message);
      return { rows: [], report: rep(/abort|timeout/i.test(err.message) ? 'timeout' : 'error', 0, err.message) };
    }
    const rows: SbirOpportunity[] = (topics.data || []).map((r) => {
      const title = `${r.topic_number} — ${r.title}`;
      const close = (r.close_date as string) || undefined;
      return {
        id: `dod-sbir:${r.topic_number}`,
        record_kind: 'open_topic',
        status: String(r.status || '').toLowerCase() === 'future' ? 'future' : 'open',
        title,
        agency: [r.agency, r.branch].filter(Boolean).join(' / ') || 'DOD',
        phase: (r.program as string) || (r.phase as string) || undefined,
        open_date: (r.open_date as string) || undefined,
        close_date: close,
        description: String(r.description || '').slice(0, 500) || undefined,
        relevance: classifyRelevance(keyword, String(r.title ?? ''), String(r.description || '')),
        source: 'DoD SBIR',
        url: (r.url as string) || undefined,
      };
    });
    if (rows.length) return { rows, report: rep('ok', rows.length) };
    // count null with no error = UNKNOWN (missing relation answers that way), never zero.
    if (open.count === null) return { rows, report: rep('error', 0, 'open-topic count unknown') };
    if (open.count === 0) return { rows, report: rep('unavailable', 0, 'the DoD open-topic cache holds 0 open topics — open DoD topics cannot be established') };
    return { rows, report: rep('empty', 0, `${open.count} open topic(s) cached; none matched`) };
  } catch (err) {
    console.error('[sbir:dod] failed:', err);
    return { rows: [], report: rep(isAbort(err) ? 'timeout' : 'error', 0, (err as Error)?.message) };
  }
}

/* ── entry point ────────────────────────────────────────────────────────────────────────── */

export async function searchSbir(input: SbirSearchInput, deps: SbirDeps = defaultDeps()): Promise<SbirSearchResult> {
  const keyword = (input.keyword || '').trim();
  const agency = (input.agency || '').trim();
  const phase = input.phase || 'all';
  // Default `all`: one call answers both questions, each in its own labeled list. The old
  // default `nih` answered "open topics?" with award history alone.
  const source: SbirSource = input.source || 'all';
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 50);
  const today = deps.now().toISOString().slice(0, 10);

  const wantsNih = source === 'nih' || source === 'all';
  const wantsMulti = source === 'multisite' || source === 'all';
  // DoD topics: explicit, `all`, or an agency filter that names defense.
  const wantsDod = source === 'dod' || source === 'all' || /\bdo[dw]\b|defense|army|navy|air ?force|socom|dtra|marine/i.test(agency);

  const [nih, multi, dod] = await Promise.all([
    wantsNih ? fetchNih(deps, keyword, agency, phase, limit) : null,
    wantsMulti ? fetchMultisite(deps, keyword, agency, limit, today) : null,
    wantsDod ? fetchDodSbir(deps, keyword, limit, today) : null,
  ]);

  const sources = [nih?.report, multi?.report, dod?.report].filter(Boolean) as SbirSourceReport[];
  const all = [...(dod?.rows ?? []), ...(multi?.rows ?? []), ...(nih?.rows ?? [])];

  const dedupe = (rows: SbirOpportunity[]) => {
    const seen = new Set<string>();
    const out: SbirOpportunity[] = [];
    for (const o of rows.sort((a, b) => RELEVANCE_RANK[a.relevance] - RELEVANCE_RANK[b.relevance])) {
      const key = (o.title || '').toLowerCase().slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(o);
      if (out.length >= limit) break;
    }
    return out;
  };

  const failed = sources.filter((s) => s.status === 'error' || s.status === 'timeout');
  const answered = sources.filter((s) => s.status === 'ok' || s.status === 'empty');
  // Open topics are established only if an open-topic source actually answered. Multisite counts
  // only when it answered AND is not purely NIH awards; DoD counts when it answered.
  const openSourceAnswered =
    (dod?.report.status === 'ok' || dod?.report.status === 'empty') ||
    (multi != null && (multi.report.status === 'ok' || multi.report.status === 'empty') && multi.rows.some((r) => r.record_kind === 'open_topic'));

  return {
    open_topics: dedupe(all.filter((r) => r.record_kind === 'open_topic')),
    award_history: dedupe(all.filter((r) => r.record_kind === 'award_history')),
    sources,
    degraded: failed.length > 0,
    partial: failed.length > 0 && answered.length > 0,
    open_topics_established: openSourceAnswered,
  };
}
