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
import { methodologyById, type Methodology, type Audience } from './observatory-methodology';

export type PubKind = 'annual' | 'white_paper' | 'press' | 'index' | 'dataset';
export type PubStatus = 'planned' | 'drafting' | 'review' | 'published' | 'archived';

export interface Publication {
  id: string;                 // RES-### — permanent publication id (like OBS-### for metrics)
  title: string;
  kind: PubKind;
  status: PubStatus;
  summary: string;            // one honest sentence: what it argues / delivers
  citesMetrics: string[];     // the OBS-### ids this publication rests on (resolved against the registry)
  audience: Audience[];
  edition: string | null;     // e.g. '2026' for the annual; null for one-offs
  // set ONLY when actually published — never for planned/drafting entries:
  url: string | null;
  publishedDate: string | null;
  // honest note on WHY it's not published yet (usually: a cited metric isn't mature enough)
  gate: string;
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
    kind: 'white_paper',
    status: 'planned',
    summary: 'The thesis that under-served federal markets are under-COMPETED, not under-supplied — using participation, attention concentration, and (once mature) competition depth to show where more outreach would most improve price and small-business access.',
    citesMetrics: ['OBS-001', 'OBS-004', 'OBS-008'],
    audience: ['government', 'research', 'press'],
    edition: null,
    url: null, publishedDate: null,
    gate: 'Planned. Rests on OBS-008 (Procurement Health Score), which is still Research — the white paper can\'t make its central claim until the competition-depth component reaches at least Beta.',
  },
  {
    id: 'RES-002',
    title: 'The Mindy Procurement Intelligence Report — 2026',
    kind: 'annual',
    status: 'planned',
    summary: 'The Institute\'s flagship annual: how the public procurement market actually behaves — supply-side participation + the behavioral moat (return, attention, discovery, decision time) no public source can produce.',
    citesMetrics: ['OBS-001', 'OBS-002', 'OBS-003', 'OBS-004', 'OBS-005', 'OBS-006', 'OBS-007'],
    audience: ['government', 'contractor', 'research', 'press'],
    edition: '2026',
    url: null, publishedDate: null,
    gate: 'Planned for January. Publishable sections (OBS-001/002) are ready now; the behavioral sections (OBS-003..007) are Collecting/Beta and accrue toward the edition — the report ships when enough of them are publishable.',
  },
  {
    id: 'RES-003',
    title: 'Small-Business Participation Benchmark',
    kind: 'index',
    status: 'planned',
    summary: 'A per-agency benchmark ranking buyers by small-business participation — the OSDBU scorecard, derived directly from the production supply-side metrics.',
    citesMetrics: ['OBS-001', 'OBS-002'],
    audience: ['government', 'contractor', 'research'],
    edition: null,
    url: null, publishedDate: null,
    gate: 'Planned. Its cited metrics (OBS-001/002) are already Production, so this is the FIRST publication that could ship on data grounds — pending a design + public-exposure decision.',
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
