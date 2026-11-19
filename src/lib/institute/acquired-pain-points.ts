/**
 * Incremental pain-point acquisition for the living Institute collector.
 *
 * Extends institute-gao-sync. It does not start a second pipeline:
 *   official page/feed → Institute document → derive.ts → agency_pain_points_db
 *
 * Sources (keyless, public):
 *   - GAO RSS https://www.gao.gov/rss/reports.xml (recent reports; a priority-open
 *     letter is recognized only when that feed states it)
 *   - oversight.gov open recommendations (the source says these are open)
 *   - oversight.gov federal report listing (evidence; a pain point only when the
 *     report text states a problem)
 *
 * One run inserts at most ACQUISITION_NEW_ROW_CAP new Institute rows and never
 * deletes or rewrites an existing row. Resolution status is copied from the
 * source. historical vs confirmed-unresolved is computed only from that status.
 */
import type { InstituteDocument } from './sources';

export const ACQUISITION_NEW_ROW_CAP = 200;
/** Hard stop on how many open-recommendation pages one run may fetch. */
export const ACQUISITION_PAGE_CAP = 8;
export const OVERSIGHT_ORIGIN = 'https://www.oversight.gov';
export const OVERSIGHT_OPEN_RECOMMENDATIONS_URL = `${OVERSIGHT_ORIGIN}/reports/recommendations`;
export const OVERSIGHT_FEDERAL_REPORTS_URL = `${OVERSIGHT_ORIGIN}/reports/federal`;

export type ResolutionStatus = 'open' | 'closed' | 'unknown';
/** Derived only from ResolutionStatus. A missing status is unknown, never historical. */
export type ResolutionFlag = 'historical' | 'confirmed_unresolved' | 'unknown';

export interface AcquiredFields {
  problem: string | null;
  recommendation: string | null;
  resolution_status: ResolutionStatus;
  resolution_flag: ResolutionFlag;
  source_identifier: string;
  agency_as_stated: string;
}

export interface AcquiredDocument {
  sourceOrg: string;
  sourceType: 'gao_report' | 'ig_report';
  documentNumber: string;
  title: string;
  url: string;
  publicationDate: string | null;
  abstract: string | null;
  agencyAsStated: string;
  problem: string | null;
  recommendation: string | null;
  resolutionStatus: ResolutionStatus;
  /** Caller may derive a pain point only when this is true and the agency resolves. */
  statesProblem: boolean;
}

export interface SourceFetch {
  ok: boolean;
  status: number;
  body: string;
  error: string | null;
}

export interface AcquisitionLane {
  name: string;
  ok: boolean;
  httpStatus: number | null;
  /** Set when the lane must not be reported as a quiet zero. */
  error: string | null;
  documents: AcquiredDocument[];
}

/**
 * The bare legacy tag. A living citation is `(Source: GAO-26-107726)` or
 * `(Source: OIG-REC:…)`, never `(Source: GAO)`.
 */
export function isBareLegacyGaoCitation(claim: string): boolean {
  return /\(\s*Source:\s*GAO\s*\)$/i.test(claim.trim());
}

export function resolutionFromSourceStatus(status: ResolutionStatus): {
  resolution_status: ResolutionStatus;
  resolution_flag: ResolutionFlag;
} {
  if (status === 'open') return { resolution_status: 'open', resolution_flag: 'confirmed_unresolved' };
  if (status === 'closed') return { resolution_status: 'closed', resolution_flag: 'historical' };
  return { resolution_status: 'unknown', resolution_flag: 'unknown' };
}

/** Recompute the flag from the status the source stored. Ignore any stored flag. */
export function readAcquiredFields(raw: unknown): AcquiredFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const bag = raw as Record<string, unknown>;
  const block = (bag.acquisition && typeof bag.acquisition === 'object')
    ? bag.acquisition as Record<string, unknown>
    : null;
  if (!block) return null;
  const status = block.resolution_status === 'open' || block.resolution_status === 'closed'
    ? block.resolution_status
    : 'unknown';
  const derived = resolutionFromSourceStatus(status);
  return {
    problem: typeof block.problem === 'string' && block.problem.trim() ? block.problem.trim() : null,
    recommendation: typeof block.recommendation === 'string' && block.recommendation.trim()
      ? block.recommendation.trim()
      : null,
    resolution_status: derived.resolution_status,
    resolution_flag: derived.resolution_flag,
    source_identifier: typeof block.source_identifier === 'string' ? block.source_identifier : '',
    agency_as_stated: typeof block.agency_as_stated === 'string' ? block.agency_as_stated : '',
  };
}

export function agencyFromOigName(name: string): string {
  return name
    .replace(/\s+office of the inspector general$/i, '')
    .replace(/\s+oig$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Problem language, minus "oversight". An Inspector General report says
 * "oversight" because that is the office, not because it found a problem.
 */
const IG_PROBLEM_MARKERS =
  /\b(needed|needs|should|improve|improvements?|challenges?|weakness(es)?|deficienc\w*|risks?|gaps?|lacks?|failed|shortfalls?|vulnerab\w*|delays?)\b/i;

export function igReportStatesProblem(text: string | null | undefined): boolean {
  if (!text) return false;
  return IG_PROBLEM_MARKERS.test(text);
}

const NOT_A_RECOMMENDATION =
  /GAO is not making recommendations|GAO did not make recommendations|GAO makes no recommendations/i;
const GAO_RECOMMENDS = /GAO recommends(?: that)? ([^.]{20,400})\./i;
const PRIORITY_OPEN = /priority open recommendations/i;

function decode(s: string): string {
  return s
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;/g, '’');
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function absUrl(href: string): string {
  try {
    return new URL(href, OVERSIGHT_ORIGIN).href;
  } catch {
    return href;
  }
}

function dayFromDatetime(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function slug(href: string): string {
  const path = href.replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '').replace(/\/$/, '');
  return path.replace(/[^A-Za-z0-9._~-]+/g, '~').slice(0, 180);
}

function acquisitionRaw(doc: AcquiredDocument): Record<string, unknown> {
  const derived = resolutionFromSourceStatus(doc.resolutionStatus);
  return {
    acquisition: {
      problem: doc.problem,
      recommendation: doc.recommendation,
      resolution_status: derived.resolution_status,
      source_identifier: doc.documentNumber,
      agency_as_stated: doc.agencyAsStated,
    },
  };
}

export function toInstituteDocument(doc: AcquiredDocument): InstituteDocument {
  return {
    sourceOrg: doc.sourceOrg,
    sourceType: doc.sourceType,
    documentNumber: doc.documentNumber,
    title: doc.title.slice(0, 500),
    url: doc.url,
    publicationDate: doc.publicationDate,
    abstract: doc.abstract,
    raw: acquisitionRaw(doc),
  };
}

/**
 * Fields the GAO RSS itself states. A priority-open letter is open because the
 * title says so. A recommendation is copied only from "GAO recommends …".
 * "GAO is not making recommendations" stays null. Age never becomes a status.
 */
export function gaoRssAcquisition(doc: Pick<InstituteDocument, 'documentNumber' | 'title' | 'abstract'>): AcquiredFields {
  const title = doc.title.trim();
  const body = doc.abstract ?? '';
  let recommendation: string | null = null;
  if (!NOT_A_RECOMMENDATION.test(body)) {
    const match = body.match(GAO_RECOMMENDS);
    if (match) recommendation = match[1].trim();
  }
  const status: ResolutionStatus = PRIORITY_OPEN.test(title) ? 'open' : 'unknown';
  const derived = resolutionFromSourceStatus(status);
  return {
    problem: title || null,
    recommendation,
    resolution_status: derived.resolution_status,
    resolution_flag: derived.resolution_flag,
    source_identifier: doc.documentNumber,
    agency_as_stated: '',
  };
}

/** Attach acquisition fields onto a GAO RSS document without changing its identity. */
export function annotateGaoRssDocument(doc: InstituteDocument): InstituteDocument {
  const fields = gaoRssAcquisition(doc);
  const prior = (doc.raw && typeof doc.raw === 'object') ? doc.raw : {};
  return {
    ...doc,
    raw: {
      ...prior,
      acquisition: {
        problem: fields.problem,
        recommendation: fields.recommendation,
        resolution_status: fields.resolution_status,
        source_identifier: fields.source_identifier,
        agency_as_stated: fields.agency_as_stated,
      },
    },
  };
}

export function parseOversightOpenRecommendations(html: string): AcquiredDocument[] {
  const out: AcquiredDocument[] = [];
  const marker = 'node--type-report node--view-mode-list-item-table';
  const starts: number[] = [];
  let from = 0;
  while (from < html.length) {
    const at = html.indexOf(marker, from);
    if (at < 0) break;
    starts.push(at);
    from = at + marker.length;
  }
  for (let i = 0; i < starts.length; i++) {
    const slice = html.slice(starts[i], starts[i + 1] ?? html.length);
    const href = slice.match(/href="(\/reports\/[^"]+)"/i)?.[1] ?? null;
    if (!href) continue;
    const published = dayFromDatetime(slice.match(/datetime="([^"]+)"/i)?.[1] ?? null);
    const oig = textOf(slice.match(/class="oig-name"[\s\S]*?field__item">([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const title = textOf(slice.match(/list-item-table-row__field--title[\s\S]*?<span>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const agency = agencyFromOigName(oig);
    const recBlocks = slice.split('node--type-recommendation').slice(1);
    for (const block of recBlocks) {
      const number = textOf(block.match(/field-rec-number[\s\S]*?field__item">([\s\S]*?)<\/div>/i)?.[1] ?? '');
      const recommendation = textOf(block.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? '');
      if (!number || !recommendation) continue;
      const id = `OIG-REC:${slug(href)}:${number}`;
      const derived = resolutionFromSourceStatus('open');
      // The report title is the public finding. The recommendation body stays
      // in `recommendation` (and institute raw) for signed-in readers only.
      const finding = title || 'Inspector General report';
      out.push({
        sourceOrg: oig || 'OIG',
        sourceType: 'ig_report',
        documentNumber: id,
        title: finding.slice(0, 500),
        url: absUrl(href),
        publicationDate: published,
        abstract: recommendation.slice(0, 4000),
        agencyAsStated: agency,
        problem: finding,
        recommendation,
        resolutionStatus: derived.resolution_status,
        // The page is Oversight.gov "Open Recommendations" and the control is
        // "View Open Recommendations". The source states open. We do not infer closed.
        statesProblem: true,
      });
    }
  }
  return out;
}

export function parseOversightFederalReports(html: string): AcquiredDocument[] {
  const out: AcquiredDocument[] = [];
  const parts = html.split('listing-table__row table-row').slice(1);
  for (const slice of parts) {
    const href = slice.match(/href="(\/reports\/[^"]+)"/i)?.[1] ?? null;
    const published = dayFromDatetime(slice.match(/datetime="([^"]+)"/i)?.[1] ?? null);
    const agency = textOf(slice.match(/data-label="Agency Reviewed \/ Investigated">([\s\S]*?)<\/td>/i)?.[1] ?? '');
    const title = textOf(slice.match(/data-label="Report Title">([\s\S]*?)<\/td>/i)?.[1] ?? '');
    if (!href || !title) continue;
    const description = textOf(
      slice.match(/Report Description[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ?? '',
    );
    const reportType = textOf(slice.match(/data-label="Type">([\s\S]*?)<\/td>/i)?.[1] ?? '');
    // A semiannual report's statutory blurb ("recommendations for improvement",
    // "address risks") is the office describing itself, not a stated finding.
    const semiannual = /semiannual/i.test(reportType) || /semiannual report/i.test(title);
    const problem = !semiannual && igReportStatesProblem(description) ? description.slice(0, 1000) : null;
    const derived = resolutionFromSourceStatus('unknown');
    out.push({
      sourceOrg: 'OIG',
      sourceType: 'ig_report',
      documentNumber: `OIG-RPT:${slug(href)}`,
      title: title.slice(0, 500),
      url: absUrl(href),
      publicationDate: published,
      abstract: description ? description.slice(0, 4000) : null,
      agencyAsStated: agency,
      problem,
      recommendation: null,
      resolutionStatus: derived.resolution_status,
      statesProblem: problem !== null,
    });
  }
  return out;
}

export function oversightPageUrl(base: string, page: number): string {
  if (page <= 0) return base;
  const url = new URL(base);
  url.searchParams.set('page', String(page));
  return url.toString();
}

export type PageWalkStop = 'continue' | 'all_held' | 'row_cap';

/**
 * Newest page first. A page whose ids are all already held means we have
 * caught up: do not read older pages. A page that still has new ids is taken
 * until the row cap, and the rest of that page is deferred.
 */
export function takeNewFromPage<T extends { documentNumber: string }>(
  documents: readonly T[],
  held: ReadonlySet<string>,
  alreadySelected: number,
  rowCap: number,
): { take: T[]; heldOnPage: number; stop: PageWalkStop } {
  const fresh = documents.filter((doc) => !held.has(doc.documentNumber));
  const heldOnPage = documents.length - fresh.length;
  if (documents.length > 0 && fresh.length === 0) {
    return { take: [], heldOnPage, stop: 'all_held' };
  }
  const room = Math.max(0, rowCap - alreadySelected);
  return {
    take: fresh.slice(0, room),
    heldOnPage,
    stop: fresh.length > room ? 'row_cap' : 'continue',
  };
}

export interface OpenRecommendationWalk {
  documents: AcquiredDocument[];
  pagesFetched: number;
  stop: 'all_held' | 'row_cap' | 'page_cap' | 'source_down';
  error: string | null;
  httpStatus: number | null;
  heldSkipped: number;
  deferredOverCap: number;
}

/**
 * Walk oversight.gov open recommendations from page 0 forward.
 * Stops at the first page whose source ids are all already held, at the row
 * cap, at the page cap, or when a page is down. Older pages after a fully
 * held page are not requested.
 */
export async function collectOpenRecommendations(opts: {
  fetchImpl?: typeof fetch;
  heldIds: (documentNumbers: string[]) => Promise<{ ids: ReadonlySet<string>; error: string | null }>;
  rowCap?: number;
  pageCap?: number;
}): Promise<OpenRecommendationWalk> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rowCap = opts.rowCap ?? ACQUISITION_NEW_ROW_CAP;
  const pageCap = opts.pageCap ?? ACQUISITION_PAGE_CAP;
  const selected: AcquiredDocument[] = [];
  const seen = new Set<string>();
  let heldSkipped = 0;
  let deferredOverCap = 0;

  for (let page = 0; page < pageCap; page++) {
    const url = oversightPageUrl(OVERSIGHT_OPEN_RECOMMENDATIONS_URL, page);
    const fetched = await fetchTextSource(url, fetchImpl);
    const lane = laneFromFetch('oversight_open_recommendations', fetched, parseOversightOpenRecommendations);
    if (!lane.ok) {
      return {
        documents: selected,
        pagesFetched: page + 1,
        stop: 'source_down',
        error: lane.error,
        httpStatus: lane.httpStatus,
        heldSkipped,
        deferredOverCap,
      };
    }
    const lookup = await opts.heldIds(lane.documents.map((doc) => doc.documentNumber));
    if (lookup.error) {
      return {
        documents: selected,
        pagesFetched: page + 1,
        stop: 'source_down',
        error: lookup.error,
        httpStatus: lane.httpStatus,
        heldSkipped,
        deferredOverCap,
      };
    }
    const novel = lane.documents.filter((doc) => !seen.has(doc.documentNumber));
    if (lane.documents.length > 0 && novel.length === 0) {
      return {
        documents: selected,
        pagesFetched: page + 1,
        stop: 'all_held',
        error: null,
        httpStatus: 200,
        heldSkipped,
        deferredOverCap,
      };
    }
    const decision = takeNewFromPage(novel, lookup.ids, selected.length, rowCap);
    heldSkipped += decision.heldOnPage;
    for (const doc of decision.take) {
      selected.push(doc);
      seen.add(doc.documentNumber);
    }
    if (decision.stop === 'row_cap') {
      deferredOverCap += novel.filter((doc) => !lookup.ids.has(doc.documentNumber)).length - decision.take.length;
    }
    if (decision.stop !== 'continue') {
      return {
        documents: selected,
        pagesFetched: page + 1,
        stop: decision.stop,
        error: null,
        httpStatus: 200,
        heldSkipped,
        deferredOverCap,
      };
    }
  }

  return {
    documents: selected,
    pagesFetched: pageCap,
    stop: 'page_cap',
    error: null,
    httpStatus: 200,
    heldSkipped,
    deferredOverCap,
  };
}

export function capNewAcquisition<T extends { documentNumber: string }>(
  newestFirst: readonly T[],
  held: ReadonlySet<string>,
  cap = ACQUISITION_NEW_ROW_CAP,
): { selected: T[]; heldSkipped: number; deferredOverCap: number } {
  const selected: T[] = [];
  let heldSkipped = 0;
  let deferredOverCap = 0;
  for (const row of newestFirst) {
    if (held.has(row.documentNumber)) {
      heldSkipped++;
      continue;
    }
    if (selected.length >= cap) {
      deferredOverCap++;
      continue;
    }
    selected.push(row);
  }
  return { selected, heldSkipped, deferredOverCap };
}

/**
 * A non-2xx response, a network error, or a 200 that parses to nothing is a
 * down source. It is not "zero new rows".
 */
export function laneFromFetch(
  name: string,
  fetched: SourceFetch,
  parse: (html: string) => AcquiredDocument[],
): AcquisitionLane {
  if (!fetched.ok) {
    return {
      name,
      ok: false,
      httpStatus: fetched.status || null,
      error: fetched.error ?? `HTTP ${fetched.status || 'error'}`,
      documents: [],
    };
  }
  const documents = parse(fetched.body);
  if (documents.length === 0) {
    return {
      name,
      ok: false,
      httpStatus: fetched.status,
      error: 'feed_parsed_zero_documents',
      documents: [],
    };
  }
  return { name, ok: true, httpStatus: fetched.status, error: null, documents };
}

export async function loadOversightLanes(fetchImpl: typeof fetch = fetch): Promise<AcquisitionLane[]> {
  const [openRecs, federal] = await Promise.all([
    fetchTextSource(OVERSIGHT_OPEN_RECOMMENDATIONS_URL, fetchImpl),
    fetchTextSource(OVERSIGHT_FEDERAL_REPORTS_URL, fetchImpl),
  ]);
  return [
    laneFromFetch('oversight_open_recommendations', openRecs, parseOversightOpenRecommendations),
    laneFromFetch('oversight_federal_reports', federal, parseOversightFederalReports),
  ];
}

export async function fetchTextSource(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceFetch> {
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mindy-Institute (hello@getmindy.ai)',
        Accept: 'text/html, application/rss+xml, application/xml;q=0.9',
      },
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, body, error: null };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
