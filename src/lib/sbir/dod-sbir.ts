/**
 * DoD SBIR/STTR topics — the defense gap in search_sbir (Eric #6, 2026-07-28). The existing
 * search_sbir reads NIH RePORTER (biomedical AWARDS) + multisite, so it returned NOTHING for defense
 * work like EOD. This adds DoD SBIR/STTR OPEN TOPICS (Army/Navy/AF/SOCOM/DTRA — topic numbers + close
 * dates), the actual game for a defense small business.
 *
 * SOURCE (verified reachable 2026-07-28): the OFFICIAL cross-agency SBIR API,
 *   https://api.www.sbir.gov/public/api/solicitations?agency=DOD&open=1
 * It is a real public JSON API, but two constraints (both handled here):
 *   1. bot-blocks a bare curl → send a browser User-Agent;
 *   2. rate-limited HARD from one IP + intermittently under maintenance → NEVER call it live per user
 *      query. A cron drains it into `dod_sbir_topics`; the search reads the CACHE. This file is that
 *      client (used by the sync cron); the tool never calls SBIR.gov directly.
 *
 * Field names from the sbir.gov Topics data dictionary: a solicitation carries agency/program/
 * open_date/close_date/current_status/solicitation_title and a nested `solicitation_topics[]`, each
 * with { topic_number|number, topic_title|title, branch, topic_description|description, sbir_topic_link }.
 * Shapes vary a little across the API's history, so the parser reads several field aliases.
 */

const SBIR_API = 'https://api.www.sbir.gov/public/api/solicitations';
// A browser UA — the API 403s / "Forbidden"s a bare fetch (verified 2026-07-28).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** One normalized DoD SBIR/STTR topic row — matches the `dod_sbir_topics` table. */
export interface DodSbirTopic {
  topic_number: string;      // the topic code — the thing a defense firm cites (e.g. "A254-001")
  title: string;
  solicitation_title: string | null;
  agency: string;            // 'DOD'
  branch: string | null;     // Army / Navy / Air Force / SOCOM / DTRA / MDA …
  program: string | null;    // 'SBIR' | 'STTR'
  phase: string | null;
  open_date: string | null;  // YYYY-MM-DD
  close_date: string | null;
  status: string | null;     // open | future | closed (current_status)
  description: string | null;
  url: string | null;        // sbir_topic_link
  solicitation: string | null; // the parent solicitation id (for a DSIP deep-link)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function pick(o: any, ...keys: string[]): any {
  for (const k of keys) if (o != null && o[k] != null && o[k] !== '') return o[k];
  return null;
}
function toYmd(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // API returns either YYYY-MM-DD or M/D/YYYY — normalize to YYYY-MM-DD, else pass through.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s.slice(0, 10);
}

/** Flatten one API solicitation → its normalized topic rows (a solicitation holds N topics). */
export function normalizeSolicitation(sol: any): DodSbirTopic[] {
  const agency = String(pick(sol, 'agency') || 'DOD').toUpperCase();
  const program = pick(sol, 'program', 'sbir_sttr'); // SBIR / STTR
  const openD = toYmd(pick(sol, 'open_date', 'release_date'));
  const closeD = toYmd(pick(sol, 'close_date', 'proposal_end_date'));
  const status = pick(sol, 'current_status', 'status');
  const solTitle = pick(sol, 'solicitation_title', 'title');
  const solId = pick(sol, 'solicitation_number', 'solicitation_id', 'solicitation');
  const topics = pick(sol, 'solicitation_topics', 'topics') || [];
  const out: DodSbirTopic[] = [];
  for (const t of Array.isArray(topics) ? topics : []) {
    const num = String(pick(t, 'topic_number', 'number', 'topic_code') || '').trim();
    if (!num) continue; // a topic without a number isn't citable — skip (never fabricate one)
    out.push({
      topic_number: num,
      title: String(pick(t, 'topic_title', 'title') || '').trim() || num,
      solicitation_title: solTitle ? String(solTitle) : null,
      agency,
      branch: pick(t, 'branch') || pick(sol, 'branch'),
      program: program ? String(program).toUpperCase() : null,
      phase: pick(t, 'phase') || pick(sol, 'phase'),
      open_date: openD,
      close_date: toYmd(pick(t, 'topic_closed_date', 'close_date')) || closeD,
      status: status ? String(status).toLowerCase() : null,
      description: pick(t, 'topic_description', 'description'),
      url: pick(t, 'sbir_topic_link', 'topic_link', 'url'),
      solicitation: solId ? String(solId) : null,
    });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Fetch a page of DoD solicitations from the live sbir.gov API → normalized topic rows. Used ONLY by
 * the sync cron (never a user query). Sends a browser UA. On a rate-limit / maintenance / non-2xx it
 * returns { rows: [], rateLimited/degraded } rather than throwing — the cron backs off and retries.
 */
export type DodSbirListEvidence = 'json_array' | 'envelope';

export type DodSbirStopped = 'budget' | 'last-page' | 'rate-limit' | 'error' | 'api-down';

export type DodSbirSyncOutcome =
  | 'complete'
  | 'empty_verified'
  | 'partial'
  | 'source_unavailable'
  | 'shape_changed'
  | 'parser_empty'
  | 'ingest_error';

export interface DodSbirSyncClassification {
  outcome: DodSbirSyncOutcome;
  /** True only for a finished write, or a zero that the source proved with a parsed list. */
  success: boolean;
  httpStatus: number;
  cronOutcome: 'success' | 'error';
  recordsReceived: number;
  emptyEvidence: string | null;
}

/**
 * Decide what a sync run is allowed to claim.
 *
 * The dispatcher records success on any HTTP 2xx and never reads the body, so a
 * down API that returns 200 is a false green. A zero-record run is success only
 * when the body was a real parsed list (json_array or the known envelope) of
 * length 0 — not a rate-limit, a maintenance page, or an unrecognized shape.
 */
export function classifyDodSbirSync(input: {
  stopped: DodSbirStopped;
  pages: number;
  upserted: number;
  solicitationsSeen: number;
  topicsSeen: number;
  emptyListEvidence: DodSbirListEvidence | null;
}): DodSbirSyncClassification {
  const recordsReceived = input.topicsSeen;
  const fail = (
    outcome: DodSbirSyncOutcome,
    httpStatus: number,
  ): DodSbirSyncClassification => ({
    outcome,
    success: false,
    httpStatus,
    cronOutcome: 'error',
    recordsReceived,
    emptyEvidence: null,
  });

  if (input.stopped === 'api-down' || (input.stopped === 'rate-limit' && input.upserted === 0)) {
    return fail('source_unavailable', 503);
  }
  if (input.stopped === 'error') return fail('ingest_error', 502);
  if (input.stopped === 'budget' || input.stopped === 'rate-limit') return fail('partial', 503);

  // stopped === 'last-page': the source answered through the end of the catalog.
  if (input.solicitationsSeen === 0 && input.upserted === 0) {
    if (input.emptyListEvidence) {
      return {
        outcome: 'empty_verified',
        success: true,
        httpStatus: 200,
        cronOutcome: 'success',
        recordsReceived: 0,
        emptyEvidence: `parsed_${input.emptyListEvidence}_length_0`,
      };
    }
    return fail('shape_changed', 502);
  }
  if (input.solicitationsSeen > 0 && input.topicsSeen === 0 && input.upserted === 0) {
    return fail('parser_empty', 502);
  }
  if (input.upserted > 0) {
    return {
      outcome: 'complete',
      success: true,
      httpStatus: 200,
      cronOutcome: 'success',
      recordsReceived,
      emptyEvidence: null,
    };
  }
  return fail('ingest_error', 502);
}

/**
 * What search_sbir may say about the DoD cache.
 * A table that holds nothing has never had a nonempty ingest — that is not
 * "no topics match". An uncounted table is the same: unknown is not zero.
 */
export function dodCacheReadState(input: { matched: number; tableCount: number | null }): {
  degraded: boolean;
  warning: string | null;
  dodCache: 'unverified_empty' | 'unmeasured' | 'ok';
} {
  if (input.tableCount == null) {
    return {
      degraded: true,
      dodCache: 'unmeasured',
      warning: 'DoD SBIR cache could not be counted. An empty result is not a verified empty market and is not current.',
    };
  }
  if (input.tableCount === 0) {
    return {
      degraded: true,
      dodCache: 'unverified_empty',
      warning: 'DoD SBIR cache holds 0 topics. No successful nonempty ingest is on record, so this is not a verified empty market and the feed is not current.',
    };
  }
  return { degraded: input.matched < 0, dodCache: 'ok', warning: null };
}

/** Pull the solicitation list only from a JSON array or a known envelope key. */
export function parseDodSbirList(data: unknown): { arr: unknown[]; evidence: DodSbirListEvidence | null } {
  if (Array.isArray(data)) return { arr: data, evidence: 'json_array' };
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const key of ['solicitations', 'results', 'data'] as const) {
      if (Array.isArray(o[key])) return { arr: o[key] as unknown[], evidence: 'envelope' };
    }
  }
  return { arr: [], evidence: null };
}

export async function fetchDodSbirPage(opts: { start?: number; rows?: number; scope?: 'open' | 'future' | 'closed' } = {}):
  Promise<{ rows: DodSbirTopic[]; rateLimited: boolean; degraded: boolean; raw: number; listEvidence: DodSbirListEvidence | null }> {
  const rows = Math.min(opts.rows ?? 100, 100);
  const start = Math.max(opts.start ?? 0, 0);
  const scope = opts.scope ?? 'open';
  const url = `${SBIR_API}?agency=DOD&${scope}=1&rows=${rows}&start=${start}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) return { rows: [], rateLimited: true, degraded: false, raw: 0, listEvidence: null };
    if (!res.ok) return { rows: [], rateLimited: false, degraded: true, raw: 0, listEvidence: null };
    const text = await res.text();
    // The API can answer 200 with a rate-limit / maintenance BODY (not a 429). Detect it.
    if (/TooManyRequests|not available at this time|Forbidden/i.test(text)) {
      return { rows: [], rateLimited: true, degraded: false, raw: 0, listEvidence: null };
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { rows: [], rateLimited: false, degraded: true, raw: 0, listEvidence: null }; }
    const parsed = parseDodSbirList(data);
    // A 200 object that is not the solicitation list is a shape change, not an empty catalog.
    if (!parsed.evidence) return { rows: [], rateLimited: false, degraded: true, raw: 0, listEvidence: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topics = (parsed.arr as any[]).flatMap(normalizeSolicitation);
    return { rows: topics, rateLimited: false, degraded: false, raw: parsed.arr.length, listEvidence: parsed.evidence };
  } catch {
    return { rows: [], rateLimited: false, degraded: true, raw: 0, listEvidence: null };
  }
}
