/**
 * No data-freshness dates in customer-facing reports (Eric, 2026-11-27: "apply the no date rules everywhere").
 *
 * REMOVED from rendered text: "as of <date>", "Data as of", "Retrieved <date>", "last synced", "awards through",
 * "current as of", and report "generated on" stamps. KEPT: opportunity facts (response deadlines, contract end
 * dates, periods of performance), fiscal-year windows, and a date that is part of a cited document's title.
 * Stored fields are unchanged; only the rendered text changes.
 *
 * These renderers carry no staleness warning today, so there is none to keep; if one is added it must say the
 * data may be out of date in words, without a date.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FULL_REPORT } from '@/lib/market/__fixtures__/market-report-full';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';
import { generateCondensedBriefingEmail } from '@/lib/briefings/recompete/email-templates';

/** Freshness / provenance date wording that must not reach a customer. */
const FRESHNESS = /\b(?:as of|data as of|retrieved|last synced|awards through|award data through|current as of|data current through|report generated|generated on)\b/i;
const visible = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe('packaged market report (hosted page and PDF HTML)', () => {
  const text = visible(renderStoredReportHtml(FULL_REPORT as never));

  it('prints no data-freshness date or generated stamp', () => {
    expect(text.match(FRESHNESS)?.[0] ?? null).toBeNull();
    expect(text).not.toMatch(/how current they are|stated source or date/i);
    expect(text).toContain('Where each section\u2019s figures come from, as recorded in this report\u2019s data. Sections without a stated source are not listed.');
    expect(text).not.toMatch(/November 2[0-2], 2026/); // the fixture's generated / synced / through dates
  });

  it('keeps opportunity facts and fiscal-year windows', () => {
    expect(text).toContain('Ends'); // the period-of-performance end column
    expect(text).toMatch(/2026-11-23|Nov(?:ember)? 23, 2026|11\/23\/2026/); // a recompete's end date
    expect(text).toMatch(/FY20\d\d/);
  });
});

describe('recompete alert email', () => {
  const briefing = {
    id: 'b1', generatedAt: '2026-11-27T09:15:00Z', briefingDate: '2026-11-27', timezone: 'ET',
    opportunities: [{ name: 'Base facilities maintenance', value: '$4.2M', incumbent: 'Example Holder A', displacementAngle: 'Ends Sep 30, 2027; incumbent rated marginal' }],
    teamingPlays: [{ theme: 'Facilities', primes: ['Example Prime'], whatYouBring: 'Local crews' }],
  };
  const email = generateCondensedBriefingEmail(briefing);

  it('carries no "As of <date, time>" stamp in the HTML or text body', () => {
    expect(visible(email.htmlBody)).not.toMatch(/\bAs of\b/i);
    expect(email.textBody).not.toMatch(/\bAs of\b/i);
    expect(email.textBody).not.toContain('4:15 AM');
  });

  it('keeps the opportunity facts, including an end date', () => {
    expect(email.textBody).toContain('Base facilities maintenance');
    expect(email.textBody).toContain('Ends Sep 30, 2027');
  });
});

describe('source guards for renderers built from live data (no fixture-friendly entry point)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('MICC market research report: no "as of <today>" or "Auto-drafted <today>"', () => {
    const s = src('src/app/api/app/micc/mrr/route.ts');
    expect(s).not.toMatch(/as of \$\{today\}/);
    expect(s).not.toMatch(/Auto-drafted \$\{today\}/);
  });

  it('gov-buyer set-aside memo: no "Data as of" in the data-sources line', () => {
    expect(src('src/lib/gov-buyer/memo-model.ts')).not.toMatch(/Data as of/);
  });

  it('recompete full email: no "As of" stamp', () => {
    expect(src('src/lib/briefings/recompete/email-templates.ts')).not.toMatch(/As of:? \$\{dateStr\}/);
  });

  it('SBA size standard citation: no "current as of"', () => {
    expect(src('src/lib/mrr/sba-size-standards.ts')).not.toMatch(/current as of \$\{/); // behavior: demo-readiness.unit.test.ts
  });
});
