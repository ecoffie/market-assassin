/**
 * /llms.txt — a plain-text brief for AI assistants and answer engines (2026-11-23).
 *
 * Why: AI answers (ChatGPT, Claude, Perplexity, Google AI Overviews) increasingly decide which
 * GovCon tool a buyer hears about. This file states, in one place, what Mindy is, who it is for,
 * what it can answer and where the canonical pages are — the "OWN" step of the AEO plan.
 *
 * Rules for editing:
 *  - Every claim must be checkable on the linked page. No counts here: counts drift, and an
 *    unsourced number is exactly what #2391 removed from the site.
 *  - Prices: /pricing is the authority. Re-check this file whenever pricing changes
 *    (verified against the live /pricing page on 2026-11-23).
 *  - Link only to public, indexable pages.
 */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai').replace(/\/$/, '');

export const dynamic = 'force-static';

const BODY = `# Mindy

> Mindy is federal market intelligence for government contractors (GovCon). It shows which agencies buy what a company sells, which open solicitations fit, which contracts are expiring and likely to be recompeted, what agencies plan to buy next, and who holds the work today. Built on public federal data: SAM.gov, USASpending.gov, agency procurement forecasts and the Federal Register.

Mindy is made by GovCon Giants. It is used through the web app at ${SITE} and inside AI assistants (Claude, ChatGPT and other MCP-compatible agents) through the Mindy connector.

## Who it is for
- Small and mid-sized businesses starting or growing in federal contracting
- Business development and capture teams tracking several markets
- Consultants and coaches who research markets for clients

## What Mindy answers
- Where is the money for what I sell? Open solicitations, contracts coming back for recompete, and agency forecasts, in one view
- Which contracts expire soon, who the incumbent is, and when a rebid is likely
- Who buys this: agencies, sub-agencies and buying offices, with their recent awards
- Who wins this work: contractors, their award history, agencies and NAICS codes
- Should I bid? A bid / no-bid read and compliance checks before writing a proposal

## Key pages
- [Opportunity map](${SITE}/opportunity-map): open opportunities, recompetes and forecasts on one map
- [Federal contractors](${SITE}/contractors): contractor profiles with award history
- [Agency forecasts](${SITE}/forecasts): what agencies plan to buy in the next 6 to 18 months
- [Expiring contracts](${SITE}/recompetes): contracts nearing their end date, with incumbents
- [DoD buying offices](${SITE}/offices): offices by DoDAAC with open bids and recent awards
- [Agencies](${SITE}/agencies): agency spending and buying patterns
- [Pricing](${SITE}/pricing)
- [Mindy in Claude, ChatGPT and other AI agents](${SITE}/mcp)

## Comparisons
- [Mindy vs GovWin IQ](${SITE}/compare/govwin)
- [Mindy vs GovTribe](${SITE}/compare/govtribe)
- [Mindy vs HigherGov](${SITE}/compare/highergov)
- [Mindy vs SAM.gov](${SITE}/compare/sam-gov)
- [Mindy vs Bloomberg Government](${SITE}/compare/bloomberg-government)
- [Mindy vs Procurement Sciences](${SITE}/compare/procurement-sciences)

## Plans
- Free account
- Pro: $149 per month, 14-day free trial
- Team: $499 per month, 14-day free trial
- Enterprise: contact sales
See ${SITE}/pricing for current terms.

## Data notes
- A contractor page reflects obligations reported to USASpending.gov; recent fiscal years can be incomplete because agencies report with a delay
- Expiring-contract dates come from each contract's current period of performance and can change when an option is exercised
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
