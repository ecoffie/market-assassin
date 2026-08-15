/**
 * The Constitution of the Mindy Observatory — the methodology registry.
 *
 * This is what turns the Observatory from "our dashboard" into a REFERENCE SYSTEM (Eric). Each
 * metric is a first-class CITABLE object with a permanent identity. When someone cites Mindy in a
 * procurement conference or an academic paper, the first question is "how did you calculate that?"
 * — this registry is the public, auditable answer.
 *
 * DESIGN INVARIANTS (do not break):
 *  1. The `OBS-###` id is PERMANENT and OPAQUE. Once assigned it NEVER changes — it is the citation
 *     key that appears in every publication forever. It maps FROM the engine's metric `key` (the
 *     concept), so a metric can be renamed, re-domained, or its query refactored and OBS-014 still
 *     follows the concept. The id encodes nothing (not domain, not status) so it survives any change.
 *  2. This is a SCIENTIFIC record, NOT developer documentation. Calculation is described in PLAIN
 *     LANGUAGE — no SQL, no engineering detail. (The raw query lives on the engine metric's `source`
 *     field as internal provenance; it is deliberately NOT surfaced in "View Standard".)
 *  3. STRUCTURED METADATA sits alongside the prose (category/audience/refresh/publishable/citable/
 *     public/api_ready/confidence). These are cheap now and, in two years, power research pages,
 *     APIs, AI citations, filtering, and benchmark reports with NO additional logic.
 *  4. Every non-trivial definitional change bumps `version` and appends to `versionHistory`. Git is
 *     the audit log; versionHistory is the human-facing "what changed and when".
 *
 * The Observatory card reads this to render "View Standard (OBS-###)" + a lifecycle chip. The
 * future /research library + public methodology pages inherit it for free.
 */

export type Lifecycle = 'research' | 'collecting' | 'beta' | 'production';
export type Audience = 'government' | 'contractor' | 'research' | 'press';
export type Refresh = 'realtime' | 'daily' | 'weekly' | 'monthly' | 'on_demand';

/** The seven scientific questions + structured metadata. NO engineering language in the prose. */
export interface Methodology {
  id: string;                    // OBS-### — PERMANENT, never changes
  name: string;                  // human name (may evolve; the id does not)
  // ── the seven questions ──
  definition: string;            // 1. what does this metric measure?
  whyItMatters: string;          // 2. why should a procurement officer or researcher care?
  calculation: string;          // 3. how is it computed — PLAIN LANGUAGE, no SQL
  dataSources: string[];         // 4. what systems contribute data?
  limitations: string[];         // 5. what does this metric NOT tell us?
  interpretation: string;        // (companion to 5) how to read the number honestly
  lifecycle: Lifecycle;          // 6. research → collecting → beta → production
  versionHistory: { version: string; date: string; change: string }[]; // 7.
  // ── structured metadata (powers research pages / APIs / AI / filtering later) ──
  version: string;               // current definitional version (e.g. 'v1.0')
  since: string;                 // YYYY-MM the metric first appeared in the Observatory
  category: 'supply' | 'behavior' | 'competition';
  audience: Audience[];
  refresh: Refresh;
  publishable: boolean;          // eligible to appear in a public publication when mature
  citable: boolean;              // may be cited by number with its OBS id
  public: boolean;               // is the standard page itself public yet (all false today)
  apiReady: boolean;             // stable enough to expose via a future API
  confidence: 1 | 2 | 3 | 4 | 5; // hidden-but-stored; matures with lifecycle (research 1 → production 5)
}

/**
 * THE REGISTRY. Keyed by the engine's metric `key` (the concept) → its permanent standard.
 * OBS ids are assigned in order of first appearance in the Observatory; gaps are fine (a retired
 * metric's id is never reused). Add new metrics with the NEXT unused number, never reorder.
 */
export const METHODOLOGY: Record<string, Methodology> = {
  sb_participation: {
    id: 'OBS-001', name: 'Small-business participation',
    definition: 'The share of a buyer’s active solicitations that are set aside — in whole or in part — for small businesses.',
    whyItMatters: 'Small-business participation is the headline number an agency’s small-business office is graded on. It is the clearest public signal of whether a market is genuinely open to small firms or effectively closed to them.',
    calculation: 'Of all solicitations a buyer currently has open, count how many carry a small-business set-aside of any kind, then divide by the total. Full-and-open solicitations (no set-aside) are excluded from the numerator but counted in the denominator.',
    dataSources: ['SAM.gov active solicitations (mirrored in our opportunity corpus)'],
    limitations: ['Measures set-aside INTENT at solicitation time, not dollars ultimately awarded to small firms.', 'Reflects the current open set only; a year-over-year trend requires the Observatory’s daily snapshot (roadmapped).'],
    interpretation: 'A higher share means more of the market is reserved for small businesses. Read it against the buyer’s mission — some markets are inherently full-and-open.',
    lifecycle: 'production',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Initial definition. Exact head-counts over the whole open set (not a sample).' }],
    version: 'v1.0', since: '2026-08', category: 'supply', audience: ['government', 'contractor', 'research', 'press'], refresh: 'daily', publishable: true, citable: true, public: false, apiReady: true, confidence: 5,
  },
  awarded_setaside_mix: {
    id: 'OBS-002', name: 'Awarded set-aside mix',
    definition: 'The distribution of a market’s awarded contracts across set-aside categories (full-and-open, small-business, 8(a), SDVOSB, WOSB, HUBZone, and others).',
    whyItMatters: 'Where participation measures intent on open solicitations, the awarded mix measures the RECORD — how the market actually resolved. It shows which set-aside programs a buyer relies on in practice.',
    calculation: 'For every enriched award in the record, read its set-aside category and tally the counts, then express each category as a share of all categorized awards.',
    dataSources: ['Enriched federal award record (recompete/award corpus)'],
    limitations: ['Counts awards, not dollars — a market can be majority full-and-open by count but small-business-heavy by value, or vice versa.', 'Covers the enriched award subset, not every historical award.'],
    interpretation: 'The award record is a stronger competition signal than open notices because it reflects outcomes, not intentions.',
    lifecycle: 'production',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Initial definition. Exact per-category head-counts over the full enriched record (not a sampled page).' }],
    version: 'v1.0', since: '2026-08', category: 'supply', audience: ['government', 'contractor', 'research'], refresh: 'daily', publishable: true, citable: true, public: false, apiReady: true, confidence: 5,
  },
  return_behavior: {
    id: 'OBS-003', name: 'Return behavior',
    definition: 'How often contractors come back to the platform — the habit curve — measured as distinct active days per user and the share who return on two or more separate days.',
    whyItMatters: 'A market intelligence tool only compounds if people return to it. Return behavior is the clearest early signal that the market is worth watching daily — the Bloomberg-terminal test.',
    calculation: 'For each observed user, count the distinct calendar days on which they took any tracked action. Report the median across users and the share who were active on at least two distinct days.',
    dataSources: ['Platform engagement events (the behavioral corpus)'],
    limitations: ['“Active day” counts any tracked action, not a qualified session.', 'Not yet controlled for internal/test accounts — the reason this metric is Beta, not Production.'],
    interpretation: 'A real returning cohort. Directional today; treat the exact percentage as provisional until validated.',
    lifecycle: 'collecting',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Initial definition over the distinct-user population.' }],
    version: 'v1.0', since: '2026-08', category: 'behavior', audience: ['research'], refresh: 'daily', publishable: false, citable: false, public: false, apiReady: false, confidence: 3,
  },
  attention_by_agency: {
    id: 'OBS-004', name: 'Attention concentration by agency',
    definition: 'Which buying agencies draw the most contractor attention, measured by how many opportunity views and distinct viewers each agency’s listings attract.',
    whyItMatters: 'This is a signal no public source has: not what agencies POST, but where suppliers actually LOOK. It reveals demand-side interest ahead of the award record.',
    calculation: 'Across opportunity-view events that carry a buying agency, tally views and count distinct viewers per agency, then rank agencies by attention.',
    dataSources: ['Platform engagement events tagged with the listing’s agency (behavioral corpus)'],
    limitations: ['Ranked from a bounded sample of recent events, so treat the ordering as directional, not an exact leaderboard.', 'Attention is not intent to bid — a viewed opportunity is not a pursued one.'],
    interpretation: 'A concentration signal: where supplier attention piles up versus which markets go unwatched. Directional while the corpus is early.',
    lifecycle: 'beta',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Initial definition over agency-tagged attention events.' }],
    version: 'v1.0', since: '2026-08', category: 'behavior', audience: ['government', 'research', 'press'], refresh: 'daily', publishable: false, citable: false, public: false, apiReady: false, confidence: 3,
  },
  discovery_index: {
    id: 'OBS-005', name: 'Discovery index (browse-without-pursue)',
    definition: 'How much contractors browse opportunities relative to how much they pursue them — the share of engaged actions that are exploration rather than commitment.',
    whyItMatters: 'It quantifies a core truth of how the market actually behaves: browsing without pursuing is the normal state, not a funnel failure. That reframes how procurement discovery should be measured.',
    calculation: 'Among engaged actions on opportunity cards, compare the count of “opened for detail” (browsed) against “saved to pursue” (committed), and express browsing as a share of the two.',
    dataSources: ['Platform decision-card events (behavioral corpus)'],
    limitations: ['Currently concentrated in a small number of users — directional support for the thesis, NOT a publishable rate.', 'Does not capture pursuit that happens off-platform.'],
    interpretation: 'A high browse share supports “discovery is exploration, not a leaky funnel.” Needs corpus growth before it is a stated number.',
    lifecycle: 'collecting',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Initial definition over decision-card action events.' }],
    version: 'v1.0', since: '2026-08', category: 'behavior', audience: ['research'], refresh: 'daily', publishable: false, citable: false, public: false, apiReady: false, confidence: 2,
  },
  sharing_flywheel: {
    id: 'OBS-006', name: 'Sharing / referral',
    definition: 'How often contractors share opportunities with one another — the peer-to-peer spread that drives organic growth.',
    whyItMatters: 'Sharing is the flywheel: an opportunity that spreads contractor-to-contractor brings new participants into the market without acquisition spend. It measures the health of that loop.',
    calculation: 'Count the total opportunities shared between contractors on the platform.',
    dataSources: ['Opportunity share events'],
    limitations: ['Small today; grows with the peer-sharing feature.', 'Counts shares, not downstream sign-ups from a share (a later, richer metric).'],
    interpretation: 'A leading indicator of organic, network-driven growth. Early-stage.',
    lifecycle: 'collecting',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Initial definition — total peer shares.' }],
    version: 'v1.0', since: '2026-08', category: 'behavior', audience: ['research'], refresh: 'daily', publishable: false, citable: false, public: false, apiReady: false, confidence: 2,
  },
  decision_time: {
    id: 'OBS-007', name: 'Average decision time',
    definition: 'The typical number of days between a contractor first discovering an opportunity and deciding to pursue it.',
    whyItMatters: 'No public source can produce this — SAM shows what was posted, award data shows what was won, but only the behavioral record shows how long the market takes to DECIDE. It is the Observatory’s most defensible metric.',
    calculation: 'For each pursued opportunity, measure the elapsed time from the contractor’s first recorded discovery of it to the moment they saved it to pursue. Report the median across pursuits. A same-visit save counts as zero days.',
    dataSources: ['Pipeline saves stamped with a discovery timestamp (behavioral corpus)'],
    limitations: ['CANNOT be backfilled — it only exists for pursuits saved after the discovery timestamp began recording (2026-08). Accrues forward from there.', 'The discovery moment is the earliest we observed, so the figure only ever UNDERstates the true deliberation time — it never inflates it.'],
    interpretation: 'A shorter median means faster market decisions. The metric can only understate, never fabricate, so it is a conservative floor.',
    lifecycle: 'collecting',
    versionHistory: [{ version: 'v1.0', date: '2026-08', change: 'Instrumented — discovery timestamp stamped at pursuit save. Accrual begins.' }],
    version: 'v1.0', since: '2026-08', category: 'behavior', audience: ['government', 'contractor', 'research', 'press'], refresh: 'daily', publishable: false, citable: false, public: false, apiReady: false, confidence: 2,
  },
  procurement_health_score: {
    id: 'OBS-008', name: 'Procurement Health Score',
    definition: 'A single composite score for how competitive and healthy a market is — combining small-business participation, competition depth, and supplier-base breadth into one figure per market.',
    whyItMatters: 'The flagship index. One defensible number a procurement director can be measured on and a market can be ranked by — the kind of standard that becomes industry language.',
    calculation: 'Not yet defined. Will be a weighted composite of its component metrics once each reaches Production; the weighting will itself be published here before the score is.',
    dataSources: ['Composite of OBS-001 (participation, Production) + OBS-009 (competition depth, Beta) + supplier-base breadth (not yet defined)'],
    limitations: ['No composite computed yet — defined here so the roadmap and the eventual formula are transparent from day one. A composite is only as trustworthy as its least-mature component; its competition-depth input (OBS-009) is Beta and its supplier-base-breadth input is not yet defined.'],
    interpretation: 'Not interpretable until its components are Production and the weighting is set. Listed to make the direction of the science visible.',
    lifecycle: 'research',
    versionHistory: [
      { version: 'v0.1', date: '2026-08', change: 'Defined as a roadmap target. No computation yet.' },
      { version: 'v0.2', date: '2026-08', change: 'Competition-depth component grounded as OBS-009 (Beta). Score still Research pending supplier-base breadth + a published weighting.' },
    ],
    version: 'v0.2', since: '2026-08', category: 'competition', audience: ['government', 'contractor', 'research', 'press'], refresh: 'on_demand', publishable: false, citable: false, public: false, apiReady: false, confidence: 1,
  },
  competition_depth: {
    id: 'OBS-009', name: 'Competition depth',
    definition: 'How many offers a buyer’s awards actually attract — the average number of bidders per award, and the share of awards that drew only a single bid.',
    whyItMatters: 'This is the measure that separates a market that is under-SUPPLIED from one that is under-COMPETED. A high single-bid rate means the work is being awarded, but not contested — the clearest sign that more suppliers, better outreach, or a fairer solicitation could improve price and access.',
    calculation: 'Take a recent sample of a buyer’s awarded contracts, read the number of offers each one received, and report two figures: the average bidders across the sample, and the percentage of awards that received exactly one offer. Awards that do not report an offer count (indefinite-delivery vehicles and simplified acquisitions, which do not carry the field) are excluded from the calculation rather than counted as zero. **Minimum observation threshold:** competition depth is reported only when at least twelve awards in the sample carry a real offer count. Below that threshold no figure is published for that buyer \u2014 not a zero, not an estimate, and not a caveated number. A missing result is preferable to a misleading one: an average drawn from a handful of awards is unstable enough that publishing it would mislead more often than it informs. The same rule governs which buyers appear at all \u2014 agencies whose solicitation volume is too small to produce a sufficient sample are deliberately not offered, so every omission is explainable and intentional rather than an accident of coverage.',
    dataSources: ['USASpending.gov per-award competition detail (number of offers received). NOTE: this is USASpending, not FPDS — FPDS.gov retired February 24, 2026.'],
    limitations: ['Computed from a recent SAMPLE of a buyer’s awards, not the buyer’s entire history — the reason this metric is Beta, not Production. A larger, validated sample and a stated confidence interval are required before it graduates.', 'Vehicles and simplified acquisitions carry no offer count and are excluded, so the figure describes competed stand-alone awards, not every transaction.', 'A single-bid award is not automatically a problem — some markets are genuinely thin — but a persistently high single-bid rate is a strong signal worth investigating.', 'Buyers below the minimum observation threshold are ABSENT rather than shown as low or zero. An agency missing from this measure has not been judged uncompetitive \u2014 it has not been measured, which is a different statement.'],
    interpretation: 'An absent figure carries information: it means the sample was too thin to measure, NOT that competition is poor. Read the two numbers together. A low average-bidders figure with a high single-bid rate is the signature of an under-competed market. Compare buyers within the same kind of work, not across dissimilar markets.',
    lifecycle: 'beta',
    versionHistory: [{ version: 'v1.0-beta', date: '2026-08', change: 'Initial Beta. Grounded via USASpending per-award detail (avg bidders + single-bid rate) over a per-buyer sample; feeds OBS-008.' }, { version: 'v1.1-beta', date: '2026-08', change: 'Codified the MINIMUM OBSERVATION THRESHOLD that the implementation already enforced: a buyer is reported only when at least twelve sampled awards carry a real offer count, and buyers too small to reach it are not offered at all. \u201cNo result\u201d is stated as a valid scientific outcome rather than an implementation detail, so every omission is explainable and intentional.' }],
    version: 'v1.1-beta', since: '2026-08', category: 'competition', audience: ['government', 'contractor', 'research', 'press'], refresh: 'on_demand', publishable: false, citable: true, public: false, apiReady: false, confidence: 3,
  },
};

/** Confidence stars, matured with lifecycle (used when AI/agents cite an Observatory metric). */
export function confidenceStars(c: 1 | 2 | 3 | 4 | 5): string {
  return '★'.repeat(c) + '☆'.repeat(5 - c);
}

/** Look up a metric's standard by its engine key. Returns null if none is registered yet. */
export function methodologyFor(key: string): Methodology | null {
  return METHODOLOGY[key] ?? null;
}

/**
 * Look up a metric's standard by its PERMANENT OBS-### id — the citation key. This is how a
 * publication (which cites metrics by their stable OBS id, never their engine key) resolves what it
 * references. Returns null for an unknown id (a publication citing a non-existent metric is a bug
 * to surface, not a silent gap).
 */
export function methodologyById(id: string): Methodology | null {
  for (const m of Object.values(METHODOLOGY)) if (m.id === id) return m;
  return null;
}

/** One public-safe rung of the maturity ladder: a metric with the honest reason it sits where it does. */
export interface LadderMetric {
  id: string;
  name: string;
  definition: string;
  reason: string;   // WHY it's at this tier — the first limitation, the honest "not-yet" (or "" for production)
}

export interface LadderTier {
  lifecycle: Lifecycle;
  label: string;    // human tier name
  dot: '🟢' | '🟡' | '🔴';
  blurb: string;    // what this tier MEANS for publishing
  metrics: LadderMetric[];
}

const TIER_META: Record<Lifecycle, { label: string; dot: '🟢' | '🟡' | '🔴'; blurb: string; order: number }> = {
  production: { label: 'Production', dot: '🟢', blurb: 'Enough validated data to publish now. A finding may cite this.', order: 0 },
  beta:       { label: 'Beta', dot: '🟡', blurb: 'A real, grounded signal — but not yet validated broadly enough to rest a public claim on.', order: 1 },
  collecting: { label: 'Collecting', dot: '🟡', blurb: 'The measure is defined and accruing data, but there isn’t yet enough to report responsibly.', order: 2 },
  research:   { label: 'Research', dot: '🔴', blurb: 'Defined on the roadmap so our direction is transparent — but no data behind it yet.', order: 3 },
};

/**
 * The maturity ladder, grouped by tier — the public "here's exactly what we can and can't stand
 * behind" view. Computed LIVE from the registry, so it never goes stale: when a metric graduates,
 * it moves tiers here on its own. Every tier is present (even if empty) so the ladder always shows
 * the full four rungs. The `reason` surfaces the metric's own first stated limitation — the honest
 * "why not further along yet" — with production metrics carrying no caveat.
 */
export function maturityLadder(): LadderTier[] {
  const tiers: LadderTier[] = (Object.keys(TIER_META) as Lifecycle[])
    .map((lc) => ({ lifecycle: lc, label: TIER_META[lc].label, dot: TIER_META[lc].dot, blurb: TIER_META[lc].blurb, metrics: [] as LadderMetric[] }));
  const byLc = new Map(tiers.map((t) => [t.lifecycle, t]));
  for (const m of Object.values(METHODOLOGY)) {
    byLc.get(m.lifecycle)!.metrics.push({
      id: m.id,
      name: m.name,
      definition: m.definition,
      reason: m.lifecycle === 'production' ? '' : (m.limitations[0] ?? ''),
    });
  }
  for (const t of tiers) t.metrics.sort((a, b) => a.id.localeCompare(b.id));
  return tiers.sort((a, b) => TIER_META[a.lifecycle].order - TIER_META[b.lifecycle].order);
}
