/**
 * The Market Research Determination memo — one model, three renderers.
 *
 * PRD: tasks/PRD-market-research-workspace.md §6 Step 6 (P5).
 *
 * WHY A MODEL: the memo previously existed only as .docx-building code, so the
 * document's CONTENT and its Word FORMATTING were the same statements. Adding
 * a PDF renderer against that would have meant writing every sentence twice —
 * and two copies of a compliance document drift, which is how a memo ends up
 * asserting one thing in Word and another in PDF. The facts live here once;
 * `route.ts` renders them to .docx and `memo-html.ts` to HTML → PDF.
 *
 * THE HONESTY CONTRACT (identical to the on-screen rule): every value is a real
 * measurement or an explicit null. A section whose source query failed is
 * OMITTED with a stated reason rather than rendered empty — a filable
 * determination must never imply "we looked and found nothing" when the truth
 * is "the lookup failed".
 */

import type { MarketResearchResult, ScoredEntity } from '@/lib/gov-buyer/market-research';
import type { AcquisitionContext } from '@/lib/gov-buyer/acquisition-context';

export const TIER_LABEL: Record<string, string> = {
  active_performer: 'Active Performer',
  capable: 'Capable',
  emerging: 'Emerging',
  registered_only: 'Registered Only',
};

export function usd(n: number | null): string {
  if (n === null || n === undefined) return 'Not measured';
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** Requirement fields a CO types on the planning form; all optional but the memo carries them. */
export interface RequirementInput {
  title?: string;
  agency?: string;
  office?: string;
  naics: string;
  psc?: string;
  keyword?: string;
  estimatedValue?: string;
  pop?: string;
  description?: string;
  state?: string;
  setAside?: string;
}

export interface MemoSection {
  heading: string;
  /** Plain paragraphs. */
  paragraphs: string[];
  /** Optional bolded lead statement (the finding). */
  lead?: string;
  /** Optional simple table. */
  table?: { headers: string[]; rows: string[][]; caption?: string };
  /** Rendered smaller, as footnote-weight text. */
  footnotes?: string[];
}

export interface MemoModel {
  title: string;
  subtitle: string;
  preparedBy: string;
  datePrepared: string;
  scope: string;
  dataSources: string;
  sections: MemoSection[];
  closing: string;
  fileBase: string;
}

/** The requirement block — only fields the CO actually filled. */
function requirementLines(req: RequirementInput): string[] {
  const out: string[] = [];
  if (req.title) out.push(`Requirement: ${req.title}`);
  if (req.description) out.push(`Description: ${req.description}`);
  if (req.agency) out.push(`Requiring agency: ${req.agency}`);
  if (req.office) out.push(`Contracting office: ${req.office}`);
  out.push(`NAICS: ${req.naics}`);
  if (req.psc) out.push(`PSC: ${req.psc}`);
  if (req.keyword) out.push(`Keyword scope: ${req.keyword}`);
  if (req.estimatedValue) out.push(`Estimated value: ${req.estimatedValue}`);
  if (req.pop) out.push(`Period of performance: ${req.pop}`);
  out.push(`Place of performance: ${req.state ? req.state.toUpperCase() : 'nationwide'}`);
  out.push(`Set-aside scope analyzed: ${req.setAside || 'all small businesses'}`);
  return out;
}

/**
 * Assemble the memo. `ctx` is optional: when the acquisition-context read
 * failed or was not requested, the history/signals sections are omitted with a
 * stated reason instead of appearing empty.
 */
export function buildMemoModel(input: {
  research: MarketResearchResult;
  ctx: AcquisitionContext | null;
  req: RequirementInput;
  preparedBy: string;
  includeEmerging: boolean;
}): MemoModel {
  const { research: r, ctx, req, preparedBy, includeEmerging } = input;
  const today = new Date(r.dataAsOf);

  const scope = [
    `NAICS ${req.naics}`,
    req.agency ? `agency: ${req.agency}` : null,
    req.state ? `place of performance: ${req.state.toUpperCase()}` : 'nationwide',
    req.setAside ? `set-aside: ${req.setAside}` : 'all small businesses',
  ].filter(Boolean).join(' · ');

  const sections: MemoSection[] = [];

  // 1 — Requirement
  sections.push({
    heading: '1. Requirement',
    paragraphs: requirementLines(req),
  });

  // 2 — Finding (the determination)
  sections.push({
    heading: '2. Finding',
    lead:
      `Market research identified ${r.marketDepth} qualified small business${r.marketDepth === 1 ? '' : 'es'} ` +
      `with demonstrated capability for this requirement. Based on this analysis, the Rule of Two is ` +
      `${r.ruleOfTwoMet ? 'MET' : 'NOT MET'} — there ${r.ruleOfTwoMet ? 'is a reasonable expectation' : 'is not a reasonable expectation'} ` +
      `of receiving offers from two or more responsible small business concerns at fair market prices.`,
    paragraphs: [],
  });

  // 3 — Supplier market by tier
  sections.push({
    heading: '3. Market Depth by Capability Tier',
    paragraphs: [
      `Active Performer (won relevant work recently): ${r.counts.active_performer}`,
      `Capable (registered, qualified, some history): ${r.counts.capable}`,
      `Emerging (qualified, registered, limited past performance): ${r.counts.emerging}`,
      `Registered Only (registered, no relevant award history — shown for completeness, excluded from the depth count): ${r.registeredOnlyCount}`,
      `The market-depth count above ${includeEmerging ? 'includes' : 'excludes'} Emerging firms. ` +
      `Emerging firms are qualified, registered small businesses building past performance; they are ` +
      `surfaced deliberately so capable new entrants are not overlooked in capacity-building decisions.`,
    ],
  });

  // 4 — Identified businesses
  const listed = r.businesses.slice(0, 50);
  sections.push({
    heading: `4. Identified Businesses (top ${listed.length} by capability)`,
    paragraphs: [],
    table: {
      headers: ['Business', 'State', 'Tier', '5yr Federal $', 'Awards', 'Certifications'],
      rows: listed.map((b: ScoredEntity) => [
        b.legalBusinessName,
        b.state || '—',
        TIER_LABEL[b.tier] || b.tier,
        // A firm with no award history shows "—", never $0.
        b.awardCount > 0 ? usd(b.totalObligated) : '—',
        b.awardCount ? String(b.awardCount) : '—',
        b.certifications.join(', ') || '—',
      ]),
      caption: r.businesses.length > 50
        ? `(${r.businesses.length} total qualified firms identified; top 50 listed.)`
        : undefined,
    },
  });

  // 5 — Procurement history
  if (!ctx) {
    sections.push({
      heading: '5. Procurement History',
      paragraphs: ['Not included: the procurement-history lookup was not performed for this determination.'],
    });
  } else if (!ctx.history.measured) {
    sections.push({
      heading: '5. Procurement History',
      paragraphs: [
        `Not measured. ${ctx.history.note || 'The award-record query did not complete.'} ` +
        'This section is omitted rather than reported as zero, because a failed lookup and an ' +
        'empty market are different findings.',
      ],
    });
  } else if (ctx.history.contracts.length === 0) {
    sections.push({
      heading: '5. Procurement History',
      paragraphs: [
        'No active contracts with a future recompete date were identified in the award record for this ' +
        'scope. This is a measured result. It may indicate a new requirement, or a scope narrower than ' +
        'the award record captures.',
      ],
    });
  } else {
    const h = ctx.history;
    sections.push({
      heading: '5. Procurement History',
      paragraphs: [
        `${h.totalMatching} prior contract${h.totalMatching === 1 ? '' : 's'} matching this scope ` +
        `${h.totalMatching === 1 ? 'was' : 'were'} identified in the federal award record, held by ` +
        `${h.distinctIncumbents} distinct incumbent${h.distinctIncumbents === 1 ? '' : 's'}.` +
        (h.totalValue !== null ? ` Combined ceiling value: ${usd(h.totalValue)}.` : ''),
      ],
      table: {
        headers: ['Incumbent', 'Work', 'Ceiling', 'Est. Recompete', 'Set-Aside'],
        rows: h.contracts.slice(0, 25).map((c) => [
          c.incumbent,
          c.pscDescription || '—',
          c.value !== null ? usd(c.value) : '—',
          c.estimatedRecompete || '—',
          // NULL means unknown, NOT unrestricted.
          c.setAside || 'Not recorded',
        ]),
      },
      footnotes: [
        'Recompete dates are estimated from award period-of-performance data. They are a planning ' +
        'signal, not a commitment that a solicitation will issue on that date.',
        `Set-aside is recorded on ${h.setAsideCoverage.withSetAside} of ${h.setAsideCoverage.total} ` +
        'matched rows. "Not recorded" means the award record does not carry a set-aside value for that ' +
        'contract — it does not mean the contract was unrestricted.',
        ...(h.note ? [h.note] : []),
      ],
    });
  }

  // 6 — Market signals
  if (!ctx) {
    sections.push({
      heading: '6. Market Signals',
      paragraphs: ['Not included: the market-signals lookup was not performed for this determination.'],
    });
  } else {
    const s = ctx.signals;
    const paras: string[] = [];
    if (s.upcomingRecompetes !== null) {
      paras.push(
        `${s.upcomingRecompetes} contract${s.upcomingRecompetes === 1 ? '' : 's'} in this scope ` +
        `${s.upcomingRecompetes === 1 ? 'is' : 'are'} estimated to come up for recompete within the ` +
        `next ${s.horizonMonths} months.`,
      );
    } else {
      paras.push('Upcoming recompete volume: not measured.');
    }
    if (s.events.length > 0) {
      paras.push(
        `${s.samCount} engagement event${s.samCount === 1 ? '' : 's'} (industry days, sources sought, ` +
        'and requests for information) are posted for this agency within the look-ahead window.',
      );
    } else if (s.note) {
      paras.push(s.note);
    }

    sections.push({
      heading: '6. Market Signals',
      paragraphs: paras,
      table: s.events.length > 0 ? {
        headers: ['Type', 'Event', 'Date', 'Office'],
        rows: s.events.slice(0, 15).map((e) => [
          (e.event_type || 'event').replace(/_/g, ' '),
          e.title,
          e.event_date || 'Date TBD',
          e.matched_office || '—',
        ]),
      } : undefined,
      footnotes: [
        'Engagement events are grounded SAM.gov postings only. No inferred or AI-discovered events ' +
        'are included in this determination.',
      ],
    });
  }

  // 7 — Methodology & caveats
  sections.push({
    heading: '7. Methodology & Caveats',
    paragraphs: [],
    footnotes: [
      ...r.caveats,
      'Capability tiers are derived from federal award history (USASpending): recency, volume, ' +
      'frequency, agency breadth, and relevance to the target NAICS. "Active Performer" indicates ' +
      'recent relevant awards; "Registered Only" indicates a current SAM registration with no ' +
      'relevant award history.',
      'Where a value could not be measured, this determination states "Not measured" rather than ' +
      'reporting zero. An unmeasured value and a measured zero are different findings and are not ' +
      'presented interchangeably.',
    ],
  });

  const fileBase = `Market_Research_${req.naics}` +
    (req.state ? `_${req.state.toUpperCase()}` : '') +
    (req.setAside ? `_${req.setAside.replace(/[^a-z0-9]/gi, '')}` : '');

  return {
    title: 'MARKET RESEARCH DETERMINATION',
    subtitle: 'Small Business Market Depth — Set-Aside Analysis',
    preparedBy,
    datePrepared: today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    scope,
    dataSources:
      'SAM.gov entity registrations, USASpending.gov award history, and the federal award record. ' +
      `Data as of ${today.toLocaleDateString()}.`,
    sections,
    closing:
      'This determination was generated to support acquisition planning. The contracting officer ' +
      'remains responsible for the final set-aside decision and any required verification of ' +
      'socioeconomic status.',
    fileBase,
  };
}
