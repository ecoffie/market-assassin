/**
 * DoD SBIR/STTR topics from the public DSIP Topics API (the current authoritative
 * DoD source as of 2026-09-08). search_sbir's original drain used
 * api.www.sbir.gov?agency=DOD; that feed is now 403 from Vercel and the agency
 * code is DOW. DSIP's public topics search is reachable and returns live
 * Open / Pre-Release topics (topic codes + close dates).
 *
 * Endpoints (verified live):
 *   GET https://www.dodsbirsttr.mil/topics/api/public/topics/solicitations
 *   GET https://www.dodsbirsttr.mil/topics/api/public/topics/search?searchParam={"searchText":"..."}&size=N
 *
 * A failed feed returns { rows: [], degraded: true } — never an unflagged [].
 * total=0 with degraded=false is a genuine miss.
 */

export interface DsipOpportunity {
  id: string;
  title: string;
  agency: string;
  phase?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  source: 'DoD DSIP';
  url?: string;
}

const DSIP_TOPICS = 'https://www.dodsbirsttr.mil/topics/api/public/topics';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSE_URL = 'https://www.dodsbirsttr.mil/topics-app/';

/** Statuses a small business can still pursue. Closed is historical, not an open topic. */
export const LIVE_TOPIC_STATUSES = new Set(['Open', 'Pre-Release']);

export interface DsipTopicRow {
  topicId?: string;
  topicCode?: string;
  topicTitle?: string;
  topicStatus?: string;
  program?: string;
  component?: string;
  command?: string;
  solicitationNumber?: string;
  solicitationTitle?: string;
  cycleName?: string;
  topicStartDate?: number;
  topicEndDate?: number;
  topicPreReleaseStartDate?: number;
  topicPreReleaseEndDate?: number;
}

export interface DsipSearchResult {
  rows: DsipOpportunity[];
  /** Null when the feed did not answer; 0 when it did and matched nothing. */
  total: number | null;
  degraded: boolean;
}

function dsipHeaders(): HeadersInit {
  return { 'User-Agent': UA, Accept: 'application/json' };
}

export function epochToYmd(v: unknown): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  const ms = v > 1e12 ? v : v * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function isLiveTopicStatus(status: string | undefined): boolean {
  return LIVE_TOPIC_STATUSES.has(String(status || '').trim());
}

export function normalizeDsipTopic(raw: DsipTopicRow): DsipOpportunity | null {
  const code = String(raw.topicCode || '').trim();
  const title = String(raw.topicTitle || '').trim();
  if (!code && !title) return null;
  const status = String(raw.topicStatus || '').trim() || undefined;
  const component = String(raw.component || raw.command || '').trim();
  const solTitle = String(raw.solicitationTitle || '').trim();
  const solNum = String(raw.solicitationNumber || '').trim();
  const start = epochToYmd(raw.topicStartDate) || epochToYmd(raw.topicPreReleaseStartDate);
  const end = epochToYmd(raw.topicEndDate) || epochToYmd(raw.topicPreReleaseEndDate);
  const provenance = [
    solTitle || null,
    solNum ? `solicitation ${solNum}` : null,
    status ? `status ${status}` : null,
    start ? `opens ${start}` : null,
    end ? `closes ${end}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id: `dod-sbir:${code || raw.topicId || title}`,
    title: code ? `${code} — ${title || code}` : title,
    agency: component ? `DOD / ${component}` : 'DOD',
    phase: raw.program ? String(raw.program) : undefined,
    startDate: start,
    endDate: end,
    description: provenance || undefined,
    source: 'DoD DSIP',
    url: BROWSE_URL,
  };
}

async function dsipGet(url: string): Promise<{ ok: true; json: unknown } | { ok: false; degraded: true }> {
  try {
    const res = await fetch(url, { headers: dsipHeaders() });
    if (!res.ok) {
      console.error('[sbir:dsip] HTTP', res.status, url);
      return { ok: false, degraded: true };
    }
    const text = await res.text();
    if (/TooManyRequests|not available at this time|"message"\s*:\s*"Forbidden"/i.test(text)) {
      console.error('[sbir:dsip] feed unavailable:', text.slice(0, 180));
      return { ok: false, degraded: true };
    }
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch {
      console.error('[sbir:dsip] non-JSON body');
      return { ok: false, degraded: true };
    }
  } catch (err) {
    console.error('[sbir:dsip] fetch failed:', err);
    return { ok: false, degraded: true };
  }
}

function liveRows(raw: unknown[]): DsipOpportunity[] {
  const out: DsipOpportunity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = normalizeDsipTopic(item as DsipTopicRow);
    if (!row) continue;
    if (!isLiveTopicStatus((item as DsipTopicRow).topicStatus)) continue;
    out.push(row);
  }
  return out;
}

async function searchDsipPage(searchText: string, size: number, page = 0): Promise<DsipSearchResult> {
  const params = new URLSearchParams({
    searchParam: JSON.stringify({ searchText }),
    size: String(Math.min(Math.max(size, 1), 500)),
    page: String(Math.max(page, 0)),
  });
  const got = await dsipGet(`${DSIP_TOPICS}/search?${params.toString()}`);
  if (!got.ok) return { rows: [], total: null, degraded: true };
  const body = got.json as { total?: unknown; data?: unknown; errorMessages?: unknown };
  if (body && Array.isArray(body.errorMessages) && body.errorMessages.length) {
    console.error('[sbir:dsip] errorMessages', body.errorMessages[0]);
    return { rows: [], total: null, degraded: true };
  }
  const data = Array.isArray(body?.data) ? body.data : [];
  const total = typeof body?.total === 'number' && Number.isFinite(body.total) ? body.total : data.length;
  return { rows: liveRows(data), total, degraded: false };
}

async function activeCycleTokens(): Promise<{ tokens: string[]; degraded: boolean }> {
  const got = await dsipGet(`${DSIP_TOPICS}/solicitations`);
  if (!got.ok) return { tokens: [], degraded: true };
  const body = got.json as { active?: unknown };
  const active = Array.isArray(body?.active) ? body.active : [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const item of active) {
    if (!item || typeof item !== 'object') continue;
    const num = String((item as { solicitationNumber?: string }).solicitationNumber || '').trim();
    const token = num.replace(/\./g, '');
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return { tokens, degraded: false };
}

function mergeById(rows: DsipOpportunity[], limit: number): DsipOpportunity[] {
  const seen = new Set<string>();
  const out: DsipOpportunity[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Live DSIP topic search. Keyword hits the public search box. Empty keyword
 * fans out across currently active DSIP cycles (26BZ / 26BX / …) so source=dod
 * without a term still lists pursuable topics instead of the closed-first dump.
 */
export async function searchDsipTopics(opts: { keyword?: string; limit?: number }): Promise<DsipSearchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const keyword = (opts.keyword || '').trim();

  if (keyword) {
    // Closed topics rank first; pull a wide page then keep only Open / Pre-Release.
    const page = await searchDsipPage(keyword, 500, 0);
    if (page.degraded) return page;
    return { rows: mergeById(page.rows, limit), total: page.total, degraded: false };
  }

  const cycles = await activeCycleTokens();
  if (cycles.degraded) return { rows: [], total: null, degraded: true };
  if (cycles.tokens.length === 0) return { rows: [], total: 0, degraded: false };

  const pages = await Promise.all(cycles.tokens.map((token) => searchDsipPage(token, 200, 0)));
  if (pages.some((p) => p.degraded)) {
    const anyLive = pages.filter((p) => !p.degraded).flatMap((p) => p.rows);
    if (anyLive.length) return { rows: mergeById(anyLive, limit), total: anyLive.length, degraded: true };
    return { rows: [], total: null, degraded: true };
  }
  const merged = mergeById(pages.flatMap((p) => p.rows), limit);
  const total = pages.reduce((n, p) => n + (typeof p.total === 'number' ? p.total : 0), 0);
  return { rows: merged, total, degraded: false };
}
