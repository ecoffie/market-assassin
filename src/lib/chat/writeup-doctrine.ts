/**
 * Write-up doctrine for Ask Mindy research deliverables (Eric's doctrine, 2026-11): pathways before open bids, a
 * who-to-talk-to table with the question to ask, buyer pressure, a readiness checklist, no grading of the company, no
 * pricing CTA, no em dashes. These are STRUCTURE rules (heading synonyms, table hints, ban phrases), not answers: no
 * company, project, person, solicitation or agency-as-answer may appear here (guarded by
 * no-benchmark-answers.unit.test.ts).
 *
 * Moved out of the RBA benchmark fixture, where it used to live; the fixture re-exports it for its tests.
 */
export const WRITEUP_DOCTRINE = {
  pathwaysFirst: true,
  /** Frame = vehicles → sources sought → direct awards only (no single open-bid list). */
  pathwayFrameOnly: ['vehicles', 'sources sought', 'direct awards'] as const,
  noSingleOpenBidList: true,
  paeSectionRequired: true,
  buyerPainRequired: true,
  whoToTalkToTable: true,
  dsbsInChecklist: true,
  noEmDashes: true,
  noGradingCompany: true,
  /** Never a pricing CTA in the write-up (Eric's doctrine: no Mindy pricing in research deliverables). */
  omitMidPlanPrice: true,
  sectionOrder: [
    'pathways in priority order',
    'PAE / defense oversight',
    'buyer pain points',
    'who to talk to and what to say',
    'readiness checklist with DSBS keywords',
  ] as const,
  /** Headings ignored when deciding pathways-first (cover / about / exec). */
  skipHeadingsForPathwaysFirst: [
    /\bthe read\b/i,
    /\bexecutive summary\b/i,
    /\babout (the )?(company|firm|document)\b/i,
    /\bhow to read\b/i,
    /\bsources and method\b/i,
    /\bmethod(ology)?\b/i,
  ] as readonly RegExp[],
  /** First substantive section must match one of these (pathway frame). */
  pathwayHeadingSynonyms: [
    /\bpathways?\b/i,
    /\bvehicles?\b/i,
    /\bMATOC\b/i,
    /\bsources sought\b/i,
    /\bdirect (8\(a\)|award)/i,
    /\bin priority order\b/i,
  ] as readonly RegExp[],
  whoToTalkHeadingSynonyms: [
    /\bwho to talk to\b/i,
    /\bwhat to say\b/i,
    /\bnamed contacts?\b/i,
    /\bcontacts? (and|&) questions?\b/i,
  ] as readonly RegExp[],
  /** Table column labels that count as the who-to-talk-to table. */
  whoToTalkTableColumnHints: [
    /\bcontact\b/i,
    /\bname\b/i,
    /\bwho\b/i,
    /\bquestion\b/i,
    /\bwhat to (ask|say)\b/i,
    /\bsay\b/i,
  ] as readonly RegExp[],
  buyerPainHeadingSynonyms: [
    /\bpain\b/i,
    /\bunder pressure\b/i,
    /\bbuyers? (are|under)\b/i,
    /\bwhat (these )?buyers\b/i,
    /\bpressure to fix\b/i,
  ] as readonly RegExp[],
  checklistHeadingSynonyms: [
    /\breadiness\b/i,
    /\bchecklist\b/i,
    /\bwhat (these )?buyers will ask\b/i,
    /\bask to see\b/i,
  ] as readonly RegExp[],
  paeHeadingSynonyms: [
    /\bPAE\b/i,
    /\bdefense (construction )?oversight\b/i,
    /\bNavy construction\b/i,
    /\bwho owns defense\b/i,
  ] as readonly RegExp[],
  /** Triggers conditional PAE hard-require (customer text or tool digest). */
  defenseBuyerSignals: [
    /\bPAE\b/i,
    /\bdefense\b/i,
    /\bPentagon\b/i,
    /\bNDAA\b/i,
    /\bNavy construction\b/i,
    /\bDoD\b/i,
    /\bDepartment of Defense\b/i,
  ] as readonly RegExp[],
  /** Company-rating phrasing only — not GS/wage grade or "small business". */
  gradingBanPhrases: [
    /\bwe grade\b/i,
    /\boverall grade\b/i,
    /\bscore of\b/i,
    /\bgrading (the )?(company|firm)\b/i,
    /\b(company|firm) grade\b/i,
    /\brated (an? )?[A-F][+-]?\b/i,
    /\bgrade:\s*[A-F][+-]?\b/i,
  ] as readonly RegExp[],
  /**
   * Pricing CTA bans. Must NOT match market dollars ($470M) or "acquisition plan" / QASP.
   */
  midCtaBanPhrases: [
    /\bMid plan\b/i,
    /\bmid-tier plan\b/i,
    /\$\s*5\s*[–—-]\s*\$?\s*10\s*K\b/i,
    /\$\s*5K\s*[–—-]\s*\$?\s*10K\b/i,
    /\bupgrade to\b/i,
    /\bbook a\b/i,
  ] as readonly RegExp[],
  openBidSoftWarn: [
    /\bopen (opportunit|bids?|RFPs?)\b/i,
    /\bcurrent (open )?RFPs?\b/i,
    /\bsingle open bids?\b/i,
  ] as readonly RegExp[],
} as const;
