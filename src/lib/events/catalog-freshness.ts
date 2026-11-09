/**
 * Freshness checks for the curated event catalog (src/data/federal-events-sources.json).
 *
 * The catalog is hand-edited and had no monitor at all: on 2026-11-09 its last full review was
 * 2026-04-05, 9 of 43 links were dead or moved, and two conference dates were wrong. These checks
 * run inside the existing check-data-freshness cron and feed its ops alert. They never run in CI —
 * time passing or a slow organizer site must not block an unrelated deploy.
 *
 * Review age is READ from the file's `lastFullReview`, never stamped separately, so the monitor
 * cannot disagree with the file it watches.
 */

export const CATALOG_KEY = 'federal_events_catalog';
/** A full review is due monthly; alert after this many days. */
export const CATALOG_REVIEW_DAYS = 35;

type Occurrence = { start: string; end: string };
type Entry = { name?: string; url?: string; next_occurrence?: Occurrence; verification?: { status?: string } };
export type EventCatalog = {
  lastFullReview?: string;
  eventSources?: Record<string, Entry>;
  majorAnnualConferences?: Entry[];
};

export interface CatalogFinding {
  kind: 'review_overdue' | 'review_missing' | 'occurrence_passed' | 'link_broken';
  entry?: string;
  detail: string;
}

function entries(c: EventCatalog): Entry[] {
  return [...Object.values(c.eventSources || {}), ...(c.majorAnnualConferences || [])];
}

/** Offline checks: review age and dated occurrences that have already ended. */
export function catalogDateFindings(c: EventCatalog, todayStr: string): CatalogFinding[] {
  const out: CatalogFinding[] = [];
  if (!c.lastFullReview) {
    out.push({ kind: 'review_missing', detail: 'catalog has no lastFullReview date' });
  } else {
    const age = Math.round((Date.parse(todayStr) - Date.parse(c.lastFullReview)) / 86_400_000);
    if (age > CATALOG_REVIEW_DAYS) out.push({ kind: 'review_overdue', detail: `last full review ${c.lastFullReview} (${age}d ago)` });
  }
  for (const e of entries(c)) {
    if (e.next_occurrence && e.next_occurrence.end < todayStr) {
      out.push({ kind: 'occurrence_passed', entry: e.name, detail: `ended ${e.next_occurrence.end}; find the next edition on the organizer site or mark no_next_announced` });
    }
  }
  return out;
}

type FetchLike = (url: string, init: { method: string; redirect: 'follow'; signal: AbortSignal; headers: Record<string, string> }) => Promise<{ status: number; url: string }>;

/**
 * One GET per catalog URL, a few at a time, each time-boxed. Broken = 404/410, or a redirect that
 * lands on a site's bare home page from a deeper path (the "moved, now goes to the homepage" case).
 * 403/429 (bot blocks), 5xx and timeouts are NOT reported as broken: a transient or blocked site is
 * not evidence the link is wrong, and a false alarm teaches people to ignore the alert.
 */
export async function catalogLinkFindings(
  c: EventCatalog,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<{ findings: CatalogFinding[]; checked: number; inconclusive: number }> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const concurrency = opts.concurrency ?? 8;
  const urls = [...new Map(entries(c).filter((e) => e.url).map((e) => [e.url!, e.name || e.url!])).entries()];
  const findings: CatalogFinding[] = [];
  let inconclusive = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const [url, name] = urls[next++];
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; MindyCatalogCheck/1.0)' } });
        const from = new URL(url);
        const to = res.url ? new URL(res.url) : from;
        const toHome = to.pathname === '/' || /^\/(sitepages\/home\.aspx|home)?$/i.test(to.pathname);
        if (res.status === 404 || res.status === 410) {
          findings.push({ kind: 'link_broken', entry: name, detail: `${url} returned ${res.status}` });
        } else if (res.status < 400 && from.pathname.replace(/\/$/, '') !== '' && toHome && to.href !== from.href) {
          findings.push({ kind: 'link_broken', entry: name, detail: `${url} now redirects to the home page ${to.href}` });
        } else if (res.status >= 400) {
          inconclusive++;
        }
      } catch {
        inconclusive++;
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return { findings, checked: urls.length, inconclusive };
}
