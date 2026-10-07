/**
 * The Mindy Institute Research Standard v1 — the rules every Institute publication follows.
 *
 * Kept as data (not inline HTML) so tests can assert every principle is present and so publications
 * can link to a principle by number. Public at /research/standard. A change to a principle is a new
 * VERSION of the Standard, never a silent edit: bump `version`, add a `history` entry.
 */

export interface Principle { n: number; title: string; rule: string }

export const RESEARCH_STANDARD_V1 = {
  version: 'v1',
  adopted: '2026-10-07',
  url: '/research/standard',
  history: [{ version: 'v1', date: '2026-10-07', note: 'First version.' }],
  principles: [
    {
      n: 1, title: 'Measurement date',
      rule: 'Every publication states when the analysis was performed. A figure recomputed on each page load says so, and is cited with the date it was computed.',
    },
    {
      n: 2, title: 'Historical as-of date',
      rule: 'A historical study states its cutoff date. No information that became available after the cutoff may influence a historical measurement. Later information may appear only in a separately labeled “subsequently reported” section, and is never fed back into the measurement.',
    },
    {
      n: 3, title: 'Provenance',
      rule: 'Every material quantitative claim is traceable to its source. Where practical we record the source, the source record identifier, its as-of date and the calculation that produced the number.',
    },
    {
      n: 4, title: 'Completeness',
      rule: 'Every number carries one completeness status: COMPLETE (the whole population was measured), PARTIAL (some of it, with the gap stated), SOURCE_LAG (the source has not yet caught up) or UNKNOWN. A capped sample is never presented as an exhaustive population.',
    },
    {
      n: 5, title: 'Terminology',
      rule: 'Public federal obligations are not revenue. Potential award value, or ceiling, is not backlog. Federal award records are not financial statements. We do not convert one into another, silently or otherwise.',
    },
    {
      n: 6, title: 'Fact, derived measure, interpretation',
      rule: 'Publications separate three kinds of statement: FEDERAL FACT (what a public record says), DERIVED MEASURE (a number we computed from those records, with its method) and INTERPRETATION (what we think it may mean). A reader can always tell which is which.',
    },
    {
      n: 7, title: 'Decline to conclude',
      rule: 'Unknown is a valid result. When the evidence does not establish a claim, we say NOT ESTABLISHED, UNRESOLVED or INSUFFICIENT EVIDENCE. We do not fill a gap because an answer would make the story stronger.',
    },
    {
      n: 8, title: 'Historical reproducibility',
      rule: 'Published research stays reproducible after the underlying live government data changes. Historical studies are computed from a stored, dated copy of the source data, never re-queried live.',
    },
    {
      n: 9, title: 'Corrections',
      rule: 'Every publication carries a version, a publish date and a correction history. A material correction is dated, states what changed and why, and stays visible. Original text is not silently replaced.',
    },
    {
      n: 10, title: 'Limitations',
      rule: 'Every publication says explicitly what its underlying data cannot establish.',
    },
    {
      n: 11, title: 'Primary sources',
      rule: 'Material factual claims rest on primary sources: government records and the filings or statements of the organizations involved. Secondary sources may provide context and are labeled as secondary.',
    },
    {
      n: 12, title: 'Regulatory and legal questions',
      rule: 'Publications may report federal contract facts and the text of regulations. They do not turn an unresolved regulatory interpretation into a conclusion, and never into a quantitative financial conclusion.',
    },
    {
      n: 13, title: 'Commercial independence',
      rule: 'Methodology does not change to support a Mindy sales claim, a GovCon Giants advisory engagement, a sponsor or a preferred narrative. If a finding is inconvenient, we publish the finding.',
    },
    {
      n: 14, title: 'Null results',
      rule: 'A research question whose answer is “not established” can still be a valid publication.',
    },
    {
      n: 15, title: 'Research engine disclosure',
      rule: 'Mindy may be identified as the technology and data engine behind an analysis. Software, including AI, does not establish truth. The evidence does, and every claim points to it.',
    },
  ] as Principle[],
} as const;
