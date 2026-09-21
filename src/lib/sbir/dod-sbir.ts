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
export async function fetchDodSbirPage(opts: { start?: number; rows?: number; scope?: 'open' | 'future' | 'closed' } = {}):
  Promise<{ rows: DodSbirTopic[]; rateLimited: boolean; degraded: boolean; raw: number }> {
  const rows = Math.min(opts.rows ?? 100, 100);
  const start = Math.max(opts.start ?? 0, 0);
  const scope = opts.scope ?? 'open';
  const url = `${SBIR_API}?agency=DOD&${scope}=1&rows=${rows}&start=${start}&format=json`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) return { rows: [], rateLimited: true, degraded: false, raw: 0 };
    if (!res.ok) return { rows: [], rateLimited: false, degraded: true, raw: 0 };
    const text = await res.text();
    // The API can answer 200 with a rate-limit / maintenance BODY (not a 429). Detect it.
    if (/TooManyRequests|not available at this time|Forbidden/i.test(text)) {
      return { rows: [], rateLimited: true, degraded: false, raw: 0 };
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { rows: [], rateLimited: false, degraded: true, raw: 0 }; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = Array.isArray(data) ? data : ((data as any)?.solicitations || (data as any)?.results || (data as any)?.data || []);
    const topics = arr.flatMap(normalizeSolicitation);
    return { rows: topics, rateLimited: false, degraded: false, raw: arr.length };
  } catch {
    return { rows: [], rateLimited: false, degraded: true, raw: 0 };
  }
}
