/**
 * Public /agencies/[slug] identity and pain-point copy.
 *
 * The living claims come from getAgencySourcedIntelligence — the same reader
 * /api/pain-points, Ask Mindy, and MCP get_agency_intel already use. This module
 * does not query. It decides what of that read is safe to print on a public
 * page, and it keeps the agencies-seo.ts snapshot as the floor.
 *
 * Public fields: claim text, an https .gov/.mil source URL, the document
 * number, and the publication date. Internal ids, recommendations, and
 * resolution flags stay off the page. The reader's legacy JSON corpus is not
 * copied here: that list is not what these pages show today, and swapping it
 * in would change the public copy.
 */
import { AGENCIES_SEO, type AgencySeo } from '@/data/agencies-seo';

/** USASpending toptier code for the International Trade Commission, checked 2026-11-18. */
export const USITC_TOPTIER_CODE = '034';
const USITC_SLUG = 'us-international-trade-commission';

const EMPTY_PROCUREMENT: AgencySeo['procurement'] = {
  primarySources: [],
  secondarySources: [],
  spendingPatterns: {},
  topVehicles: [],
  tips: '',
};

/**
 * Canonical agencies that are not in the generated snapshot. The snapshot is
 * left untouched so a regeneration cannot drop them and cannot reassign codes.
 */
export const AGENCY_PAGE_ADDITIONS: AgencySeo[] = [
  {
    slug: 'consumer-product-safety-commission',
    name: 'Consumer Product Safety Commission',
    abbreviation: 'CPSC',
    cgac: '061',
    group: 'independent',
    fy26BudgetB: null,
    fy25BudgetB: null,
    budgetTrend: null,
    budgetChangePct: null,
    painPoints: [],
    priorities: [],
    procurement: EMPTY_PROCUREMENT,
  },
  {
    slug: 'appalachian-regional-commission',
    name: 'Appalachian Regional Commission',
    abbreviation: 'ARC',
    cgac: '309',
    group: 'independent',
    fy26BudgetB: null,
    fy25BudgetB: null,
    budgetTrend: null,
    budgetChangePct: null,
    painPoints: [],
    priorities: [],
    procurement: EMPTY_PROCUREMENT,
  },
  {
    slug: 'election-assistance-commission',
    name: 'Election Assistance Commission',
    abbreviation: 'EAC',
    cgac: '525',
    group: 'independent',
    fy26BudgetB: null,
    fy25BudgetB: null,
    budgetTrend: null,
    budgetChangePct: null,
    painPoints: [],
    priorities: [],
    procurement: EMPTY_PROCUREMENT,
  },
];

function withCorrectedCodes(agency: AgencySeo): AgencySeo {
  if (agency.slug === USITC_SLUG && agency.cgac !== USITC_TOPTIER_CODE) {
    return { ...agency, cgac: USITC_TOPTIER_CODE };
  }
  return agency;
}

let cached: AgencySeo[] | null = null;

/** Snapshot agencies plus the three additions. USITC displays code 034. */
export function listPublicAgencies(): AgencySeo[] {
  if (cached) return cached;
  cached = [
    ...AGENCIES_SEO.map(withCorrectedCodes),
    ...AGENCY_PAGE_ADDITIONS,
  ];
  return cached;
}

const bySlug = new Map<string, AgencySeo>();

export function getPublicAgencyBySlug(slug: string): AgencySeo | undefined {
  if (bySlug.size === 0) {
    for (const agency of listPublicAgencies()) bySlug.set(agency.slug, agency);
  }
  return bySlug.get(slug);
}

export interface PublicSourcedClaim {
  pain_point: string;
  source_type: string;
  source_url: string | null;
  document_number: string | null;
  published_at: string | null;
  provenance: string;
}

/**
 * Copy only the public fields off a living row. Anything else on the reader
 * object — institute id, recommendation, resolution — is dropped.
 */
export function selectPublicSourced<T extends PublicSourcedClaim>(
  rows: readonly T[],
): PublicSourcedClaim[] {
  return rows.map((row) => ({
    pain_point: row.pain_point,
    source_type: row.source_type,
    source_url: row.source_url,
    document_number: row.document_number,
    published_at: row.published_at,
    provenance: row.provenance,
  }));
}

export type LivePainRead =
  | { ok: true; sourced: readonly PublicSourcedClaim[]; checkedAt?: string | null }
  | { ok: false; checkedAt?: string | null };

export interface PublicPainItem {
  claim: string;
  kind: 'snapshot' | 'sourced';
  href: string | null;
  documentNumber: string | null;
  publishedAt: string | null;
  sourceLabel: string;
}

export interface PublicPainSection {
  items: PublicPainItem[];
  /** True when the section is the snapshot alone because the live read failed or returned no cited rows. */
  snapshotFloor: boolean;
  freshnessLabel: string;
  /** Newest cited report publication day, when one is present. */
  asOf: string | null;
  /** When this read ran. Null when the page could not record a check. */
  checkedAt: string | null;
}

const DAILY = 'The intelligence refreshes daily.';

/** `2026-11-18T23:40:00.000Z` → `2026-11-18 23:40 UTC`. Invalid input is omitted. */
export function formatCheckedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function claimKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\s*source:\s*[^)]+\)/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** https URLs on a .gov or .mil host only. Anything else is not linked. */
export function publicCitationHref(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!(host.endsWith('.gov') || host.endsWith('.mil'))) return null;
  return parsed.toString();
}

function publishedDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function sourceLabel(sourceType: string): string {
  if (sourceType === 'ig_report') return 'Inspector General';
  if (sourceType === 'gao') return 'GAO';
  return 'Source report';
}

function citedItem(claim: string, row: PublicSourcedClaim, kind: 'snapshot' | 'sourced'): PublicPainItem {
  return {
    claim,
    kind,
    href: publicCitationHref(row.source_url),
    documentNumber: row.document_number?.trim() || null,
    publishedAt: publishedDay(row.published_at),
    sourceLabel: sourceLabel(row.source_type),
  };
}

/**
 * Snapshot lines stay, in their current order and wording. A living SOURCE_FACT
 * that repeats one of them attaches its citation to that line instead of
 * appearing twice. Novel cited rows follow the snapshot. A failed read, or a
 * read with no SOURCE_FACT rows, returns the snapshot unchanged.
 */
export function buildPublicPainSection(
  snapshot: readonly string[],
  live: LivePainRead,
): PublicPainSection {
  const sourced = live.ok
    ? live.sourced.filter((row) => row.provenance === 'SOURCE_FACT' && row.pain_point.trim().length > 0)
    : [];

  const used = new Set<number>();
  const items: PublicPainItem[] = snapshot.map((claim) => {
    const key = claimKey(claim);
    const match = key.length === 0
      ? -1
      : sourced.findIndex((row, index) => !used.has(index) && claimKey(row.pain_point) === key);
    if (match < 0) {
      return {
        claim,
        kind: 'snapshot',
        href: null,
        documentNumber: null,
        publishedAt: null,
        sourceLabel: 'Published snapshot',
      };
    }
    used.add(match);
    return citedItem(claim, sourced[match], 'snapshot');
  });

  sourced.forEach((row, index) => {
    if (!used.has(index)) items.push(citedItem(row.pain_point, row, 'sourced'));
  });

  const cited = items.filter((item) => item.href || item.documentNumber);
  const asOf = cited
    .map((item) => item.publishedAt)
    .filter((day): day is string => !!day)
    .sort()
    .at(-1) ?? null;
  const checkedAt = formatCheckedAt(live.checkedAt);
  const checkedClause = checkedAt ? ` Mindy last checked ${checkedAt}.` : '';

  if (cited.length === 0) {
    const why = live.ok
      ? 'No sourced GAO or inspector general report is on file for this agency yet.'
      : 'The live source could not be read, so this list is unchanged.';
    return {
      items,
      snapshotFloor: true,
      asOf: null,
      checkedAt,
      freshnessLabel: `Published snapshot. ${why}${checkedClause} ${DAILY}`,
    };
  }

  const asOfClause = asOf ? `, as of ${asOf}` : '';
  return {
    items,
    snapshotFloor: false,
    asOf,
    checkedAt,
    freshnessLabel: `Sourced from GAO and inspectors general${asOfClause}.${checkedClause} ${DAILY}`,
  };
}
