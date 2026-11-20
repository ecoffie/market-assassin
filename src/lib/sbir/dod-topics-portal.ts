/**
 * DoD SBIR/STTR topics from the public DSIP topics app.
 *
 * Measured 2026-11-20 from this environment:
 * - https://api.www.sbir.gov/public/api/solicitations?agency=DOD&open=1 → HTTP 403
 * - https://www.defensesbirsttr.mil/ → HTTP 403
 * - GET https://www.dodsbirsttr.mil/topics/api/public/topics/search
 *   with searchParam.topicReleaseStatus [591, 592] → HTTP 200, total 110
 *   (24 Open, 86 Pre-Release). Those two ids are the topics app's default
 *   open selection (topicWrapperDefaultSelections.topicStatus).
 *
 * The search list has no description field. Description stays null. It is
 * not invented from the preface PDF. Closed topics (33,044 in the unfiltered
 * list) are not collected.
 */
import type { DodSbirTopic } from './dod-sbir';

export const DOD_TOPICS_PORTAL_SEARCH =
  'https://www.dodsbirsttr.mil/topics/api/public/topics/search';

/** Open + Pre-Release, the ids the public topics app selects by default. */
export const DOD_PORTAL_OPEN_STATUS_IDS = [591, 592] as const;

export const DOD_PORTAL_DETAILS_URL = 'https://www.dodsbirsttr.mil/topics/api/public/topics';

function ymdFromEpoch(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().slice(0, 10);
}

/** One public search hit → the dod_sbir_topics row. Null when there is no topic code. */
export function dodPortalTopicToRow(raw: unknown): DodSbirTopic | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const topicNumber = String(row.topicCode ?? '').trim();
  const title = String(row.topicTitle ?? '').trim();
  if (!topicNumber || !title) return null;
  const topicId = typeof row.topicId === 'string' && row.topicId ? row.topicId : null;
  const status = typeof row.topicStatus === 'string' ? row.topicStatus.toLowerCase() : null;
  return {
    topic_number: topicNumber,
    title,
    solicitation_title: typeof row.solicitationTitle === 'string' ? row.solicitationTitle : null,
    agency: 'DOD',
    branch: typeof row.component === 'string' ? row.component : null,
    program: typeof row.program === 'string' ? row.program.toUpperCase() : null,
    phase: null,
    open_date: ymdFromEpoch(row.topicStartDate),
    close_date: ymdFromEpoch(row.topicEndDate),
    status,
    description: null,
    url: topicId ? `${DOD_PORTAL_DETAILS_URL}/${encodeURIComponent(topicId)}/details` : null,
    solicitation: typeof row.solicitationNumber === 'string' ? row.solicitationNumber : null,
  };
}

export interface DodPortalRead {
  rows: DodSbirTopic[];
  reportedTotal: number | null;
  pages: number;
  complete: boolean;
  degraded: boolean;
  error?: string;
}

export async function fetchDodPortalOpenTopics(opts: {
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
} = {}): Promise<DodPortalRead> {
  const doFetch = opts.fetchImpl ?? fetch;
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const maxPages = Math.max(1, opts.maxPages ?? 6);
  const searchParam = JSON.stringify({
    topicReleaseStatus: [...DOD_PORTAL_OPEN_STATUS_IDS],
    sortBy: 'topicEndDate,asc',
  });
  const rows: DodSbirTopic[] = [];
  const seen = new Set<string>();
  let reportedTotal: number | null = null;
  let pages = 0;
  for (let page = 0; page < maxPages; page++) {
    const url = `${DOD_TOPICS_PORTAL_SEARCH}?page=${page}&size=${pageSize}&searchParam=${encodeURIComponent(searchParam)}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'GovConGiants-Mindy/1.0' },
      });
    } catch (err) {
      return {
        rows, reportedTotal, pages, complete: false, degraded: true,
        error: err instanceof Error ? err.message : 'DSIP topics fetch failed',
      };
    }
    if (!res.ok) {
      return {
        rows, reportedTotal, pages, complete: false, degraded: true,
        error: `DSIP topics HTTP ${res.status}`,
      };
    }
    let body: unknown;
    try { body = await res.json(); } catch {
      return { rows, reportedTotal, pages, complete: false, degraded: true, error: 'DSIP topics body was not JSON' };
    }
    if (!body || typeof body !== 'object') {
      return { rows, reportedTotal, pages, complete: false, degraded: true, error: 'DSIP topics payload was not an object' };
    }
    const bag = body as { total?: unknown; data?: unknown };
    if (typeof bag.total === 'number' && Number.isFinite(bag.total)) reportedTotal = bag.total;
    if (!Array.isArray(bag.data)) {
      return { rows, reportedTotal, pages, complete: false, degraded: true, error: 'DSIP topics data was not an array' };
    }
    pages += 1;
    if (bag.data.length === 0) break;
    for (const item of bag.data) {
      const mapped = dodPortalTopicToRow(item);
      if (!mapped || seen.has(mapped.topic_number)) continue;
      seen.add(mapped.topic_number);
      rows.push(mapped);
    }
    if (reportedTotal != null && rows.length >= reportedTotal) break;
    if (bag.data.length < pageSize) break;
  }
  const complete = reportedTotal != null && reportedTotal > 0 && rows.length >= reportedTotal;
  return { rows, reportedTotal, pages, complete, degraded: !complete };
}
