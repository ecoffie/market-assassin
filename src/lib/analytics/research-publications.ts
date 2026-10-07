/**
 * The Mindy Institute Research Library — the publications registry.
 *
 * This is the citable-object model (the Observatory Constitution) applied to PUBLICATIONS. Every
 * report, white paper, and index the Institute produces is a first-class object that CITES Observatory
 * metrics by their permanent OBS-### id — so a publication automatically inherits the credibility (and
 * the maturity honesty) of the metrics it rests on. When a metric is only Beta, a publication that
 * cites it can't credibly claim more than Beta.
 *
 * ⚠️ HONESTY (the whole point): we have ZERO published reports today. This registry is seeded with the
 * REAL forthcoming pipeline as status:'planned' — NOTHING here claims to be published that isn't.
 * `url`/`publishedDate` are set ONLY when a publication actually ships. A research library that lists
 * fabricated reports would be the exact trap the Observatory guards against. When a report ships, flip
 * its status to 'published' and add the url — that's the only edit.
 *
 * The library reads this + the methodology registry so each publication resolves its cited metrics'
 * names + live maturity. Public /research inherits this registry later (same data, different gate).
 */
import { METHODOLOGY, methodologyById, type Methodology, type Audience } from './observatory-methodology';

export type PubKind = 'annual' | 'white_paper' | 'press' | 'index' | 'dataset' | 'transaction_study';

/**
 * Release 001 date — the day the Research Standard v1, the RES-003 correction and Transaction Study 001
 * go live together. ⚠️ Set this to the ACTUAL release date in the final release commit; it is the
 * published date of RES-004 and the dated correction on RES-003.
 */
export const RELEASE_001_DATE = '2026-10-07';

/** Research Standard v1 — the rules every publication follows. Public at /research/standard. */
export const RESEARCH_STANDARD = { version: 'v1', url: '/research/standard' } as const;

/**
 * How a publication's numbers were produced (Research Standard v1, principles 1, 2 and 8).
 *  - live:   recomputed from current data on each request. NOT a fixed historical edition; cite the
 *            computed date with any figure.
 *  - frozen: computed once on `measuredOn` from data as of `asOf` and stored; reproducible.
 */
export type Measurement =
  | { mode: 'live' }
  | { mode: 'frozen'; measuredOn: string; asOf: string };

/** A dated, permanently visible correction (Research Standard v1, principle 9). */
export interface Correction { date: string; version: string; note: string }
export type PubStatus = 'planned' | 'drafting' | 'review' | 'published' | 'archived';

/**
 * The Institute's TYPE SYSTEM (Eric) — the layer of the pyramid, orthogonal to `kind` (the format).
 * Standards define a measure · Benchmarks apply one · Research interprets several. Research is built
 * ON TOP of standards, exactly like engineering — so a publication's class says WHERE it sits in the
 * hierarchy, while `kind` still says what FORMAT it takes (index, white paper, annual report).
 */
export type PubClass = 'standard' | 'benchmark' | 'research';

export const PUB_CLASS_META: Record<PubClass, { label: string; blurb: string; order: number }> = {
  standard:  { label: 'Standards',  blurb: 'Define a measure.',           order: 0 },
  benchmark: { label: 'Benchmarks', blurb: 'Apply a standard.',           order: 1 },
  research:  { label: 'Research',   blurb: 'Interpret measured evidence.', order: 2 },
};

export interface Publication {
  id: string;                 // RES-### — permanent publication id (like OBS-### for metrics)
  title: string;
  class: PubClass;            // WHERE it sits in the type system (Standard/Benchmark/Research)
  kind: PubKind;             // what FORMAT it takes (index, white paper, annual report, ...)
  status: PubStatus;
  summary: string;            // one honest sentence: what it argues / delivers
  citesMetrics: string[];     // the OBS-### ids this publication rests on (resolved against the registry)
  audience: Audience[];
  edition: string | null;     // e.g. '2026' — the EDITION is a field, NOT part of the URL (NIST/Bloomberg
                              // model: the /research/<slug> URL is PERMANENT, the edition evolves under it).
  version: string | null;     // e.g. 'v1.0' — bumps as a published edition is corrected/updated
  // PUBLIC route slug — set once a publication is published to /research/<slug>. NEVER include a year
  // (the URL is permanent); the year lives in `edition`. null = not yet on a public URL.
  slug: string | null;
  // set ONLY when actually published — never for planned/drafting entries:
  url: string | null;
  publishedDate: string | null;
  // honest note on WHY it's not published yet (usually: a cited metric isn't mature enough)
  gate: string;
  /** Research Standard v1 fields — REQUIRED once published (enforced by research-standard.unit.test.ts). */
  standard?: typeof RESEARCH_STANDARD.version;
  measurement?: Measurement;
  corrections?: Correction[];
}

const STATUS_ORDER: Record<PubStatus, number> = { published: 0, review: 1, drafting: 2, planned: 3, archived: 4 };

/**
 * THE PIPELINE. Real forthcoming work only — nothing fabricated as published. RES ids assigned in
 * planning order; never reused. Each cites the OBS metrics it will rest on, so the library shows the
 * dependency honestly (and can compute "is every cited metric mature enough to publish this yet?").
 */
export const PUBLICATIONS: Publication[] = [
  {
    id: 'RES-001',
    title: 'The Competition Gap',
    class: 'research',
    kind: 'white_paper',
    status: 'planned',
    summary: 'The thesis that under-served federal markets are under-COMPETED, not under-supplied — using participation, attention concentration, and (once mature) competition depth to show where more outreach would most improve price and small-business access.',
    citesMetrics: ['OBS-001', 'OBS-004', 'OBS-008'],
    audience: ['government', 'research', 'press'],
    edition: null, version: null, slug: null,
    url: null, publishedDate: null,
    gate: 'Planned. Rests on OBS-008 (Procurement Health Score), which is still Research — the white paper can\'t make its central claim until the competition-depth component reaches at least Beta.',
  },
  {
    id: 'RES-002',
    title: 'The Mindy Procurement Intelligence Report — 2026',
    class: 'research',
    kind: 'annual',
    status: 'planned',
    summary: 'The Institute\'s flagship annual: how the public procurement market actually behaves — supply-side participation + the behavioral moat (return, attention, discovery, decision time) no public source can produce.',
    citesMetrics: ['OBS-001', 'OBS-002', 'OBS-003', 'OBS-004', 'OBS-005', 'OBS-006', 'OBS-007'],
    audience: ['government', 'contractor', 'research', 'press'],
    edition: '2026', version: null, slug: null,
    url: null, publishedDate: null,
    gate: 'Planned for January. Publishable sections (OBS-001/002) are ready now; the behavioral sections (OBS-003..007) are Collecting/Beta and accrue toward the edition — the report ships when enough of them are publishable.',
  },
  {
    id: 'RES-003',
    title: 'Small-Business Participation Benchmark',
    class: 'benchmark',
    kind: 'index',
    status: 'published',
    summary: 'A per-agency benchmark ranking federal buyers by the share of their active solicitations that carry a small-business set-aside — the OSDBU scorecard, derived directly from the production supply-side metrics with exact head-counts.',
    // Computes OBS-001 only (sam_opportunities set-aside head-counts). It previously also cited OBS-002;
    // nothing in the benchmark computes OBS-002, so the citation was corrected in v1.1 (see corrections).
    citesMetrics: ['OBS-001'],
    audience: ['government', 'contractor', 'research'],
    edition: '2026', version: 'v1.1',
    // PERMANENT public URL — no year (the edition is a field). The Mindy Institute's first publication.
    slug: 'small-business-participation-benchmark',
    url: '/research/small-business-participation-benchmark',
    publishedDate: '2026-08-07',
    gate: 'Published. Its cited metric (OBS-001) is Production — the benchmark rests entirely on exact head-counts. Low-volume agencies are excluded (a percentage below the minimum-volume floor is noise) and that exclusion is disclosed on the page. It is LIVE: recomputed on every request, not a frozen edition — a stored snapshot is not built yet, and the page says so.',
    standard: 'v1',
    measurement: { mode: 'live' },
    corrections: [
      {
        date: RELEASE_001_DATE,
        version: 'v1.1',
        note: 'Corrected the methodology note. Earlier versions said this benchmark is derived from two Observatory metrics, OBS-001 and OBS-002. It computes only OBS-001 (the small-business set-aside share of active solicitations); OBS-002 was never an input. No figure changed. The page also now states that it is recomputed from live data on each load rather than being a fixed edition.',
      },
    ],
  },
  {
    id: 'RES-004',
    title: 'The Federal Portfolio Behind a $210 Million Acquisition',
    class: 'research',
    kind: 'transaction_study',
    status: 'published',
    summary: "Transaction Study 001: Halvik's federal prime-contract portfolio reconstructed as it stood on January 21, 2026, the day before Tetra Tech announced the acquisition — and what that public record can and cannot tell a buyer.",
    citesMetrics: [],
    audience: ['contractor', 'research', 'press'],
    edition: null, version: 'v1.0',
    // PERMANENT public URL. Studies stay flat under /research/<slug>; a future series view groups them
    // without moving the URL.
    slug: 'halvik-tetra-tech',
    url: '/research/halvik-tetra-tech',
    publishedDate: RELEASE_001_DATE,
    gate: 'Frozen historical study. Every material claim is traced in tasks/halvik-transaction-study-publication-gate-2026-10-07.md. It cites no Observatory metric: its measures are defined in its own published methodology, as Research Standard v1 allows.',
    standard: 'v1',
    measurement: { mode: 'frozen', measuredOn: '2026-10-07', asOf: '2026-01-21' },
    corrections: [],
  },
];

/** A cited metric resolved to its live standard (name + maturity + confidence), for rendering. */
export interface CitedMetric { id: string; standard: Methodology | null }

export function resolveCitations(pub: Publication): CitedMetric[] {
  return pub.citesMetrics.map((id) => ({ id, standard: methodologyById(id) }));
}

/**
 * Publish-readiness on DATA grounds: are all cited metrics at least Production? (A publication can only
 * be as credible as its least-mature cited metric.) Returns the blocking metrics, honestly.
 * NOTE: this is a data-readiness signal, NOT an auto-publish — publishing is still a deliberate decision.
 */
export function publishReadiness(pub: Publication): { ready: boolean; blockedBy: { id: string; maturity: string }[] } {
  const blockedBy: { id: string; maturity: string }[] = [];
  for (const { id, standard } of resolveCitations(pub)) {
    const lc = standard?.lifecycle;
    if (lc !== 'production') blockedBy.push({ id, maturity: lc ?? 'unknown' });
  }
  return { ready: blockedBy.length === 0, blockedBy };
}

/** Publications sorted for display: published first, then by pipeline stage. */
export function publicationsForDisplay(): Publication[] {
  return [...PUBLICATIONS].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id.localeCompare(b.id));
}

/**
 * Resolve a PUBLISHED publication by its public slug (for the /research/<slug> route).
 * Returns null for an unknown slug OR a publication that isn't actually published — the public
 * route must 404 an unpublished slug, never render a planned/draft report as if it were live.
 */
export function publishedBySlug(slug: string): Publication | null {
  const p = PUBLICATIONS.find((x) => x.slug === slug);
  return p && p.status === 'published' ? p : null;
}

/** All published publications (for the public /research index + sitemap). */
export function publishedPublications(): Publication[] {
  return publicationsForDisplay().filter((p) => p.status === 'published' && p.slug);
}

/** One class group for the public index: the class + its blurb + the publications in it (display-sorted). */
export interface ClassGroup { class: PubClass; label: string; blurb: string; publications: Publication[] }

/**
 * Publications grouped by CLASS (Standard → Benchmark → Research), each group's members display-sorted
 * (published first). Every class is present even when empty — so the pyramid always shows all three
 * rungs and a reader sees "Standards — none published yet" rather than the tier silently vanishing.
 */
export function publicationsByClass(): ClassGroup[] {
  const groups: ClassGroup[] = (Object.keys(PUB_CLASS_META) as PubClass[])
    .map((c) => ({ class: c, label: PUB_CLASS_META[c].label, blurb: PUB_CLASS_META[c].blurb, publications: [] as Publication[] }));
  const byClass = new Map(groups.map((g) => [g.class, g]));
  for (const p of publicationsForDisplay()) byClass.get(p.class)!.publications.push(p);
  return groups.sort((a, b) => PUB_CLASS_META[a.class].order - PUB_CLASS_META[b.class].order);
}

/**
 * The Institute's HONEST current state — computed live so the manifesto never goes stale as the
 * Observatory matures. When RES-001 ships, `published` ticks up on its own; when a metric reaches
 * Production, `productionMetrics` follows. The whole point of the manifesto (bold mission, honest
 * present) rests on these being REAL counts, not hardcoded prose.
 */
export function instituteState(): {
  totalMetrics: number;
  productionMetrics: number;
  published: number;
  forthcoming: number;
} {
  const metrics = Object.values(METHODOLOGY);
  const pubs = publicationsForDisplay();
  return {
    totalMetrics: metrics.length,
    productionMetrics: metrics.filter((m) => m.lifecycle === 'production').length,
    published: pubs.filter((p) => p.status === 'published').length,
    forthcoming: pubs.filter((p) => p.status !== 'published' && p.status !== 'archived').length,
  };
}
