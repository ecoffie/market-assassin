/**
 * GET /api/gov-buyer/market-research/export
 *
 * Generates the Market Research Determination memo (.docx) a contracting
 * officer files to support a set-aside decision. Same query params as the
 * research API; runs the rubric, renders a formatted, defensible memo with
 * the market-depth count, Rule-of-Two finding, tier breakdown, the firm
 * list, and the methodology + caveats footnotes.
 *
 * Gated to gov_buyer (requireGovBuyer). PRD: docs/PRD-gov-buyer-market-research.md §8
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import { requireGovBuyer } from '@/lib/gov-buyer/auth';
import { runMarketResearch, type ScoredEntity } from '@/lib/gov-buyer/market-research';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = {
  active_performer: 'Active Performer',
  capable: 'Capable',
  emerging: 'Emerging',
  registered_only: 'Registered Only',
};

function usd(n: number): string {
  if (!n) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function p(text: string, opts: { bold?: boolean; size?: number; spacingAfter?: number } = {}) {
  return new Paragraph({
    spacing: { after: opts.spacingAfter ?? 120 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 22 })],
  });
}

function cell(text: string, opts: { bold?: boolean; width?: number } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: 18 })] })],
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');
  const naics = sp.get('naics');
  const state = sp.get('state') || undefined;
  const setAside = sp.get('setAside') || undefined;
  const includeEmerging = sp.get('includeEmerging') !== 'false';

  const auth = await requireGovBuyer(request, email);
  if (!auth.ok) return auth.response;
  if (!naics) {
    return NextResponse.json({ success: false, error: 'naics is required' }, { status: 400 });
  }

  const r = await runMarketResearch({ naics, state, setAside, includeEmerging, limit: 500 });

  const today = new Date(r.dataAsOf);
  const scope = [
    `NAICS ${naics}`,
    state ? `place of performance: ${state}` : 'nationwide',
    setAside ? `set-aside: ${setAside}` : 'all small businesses',
  ].join(' · ');

  // Top firms table (cap at 50 for a filable memo).
  const listed = r.businesses.slice(0, 50);
  const tableRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('Business', { bold: true, width: 34 }),
        cell('State', { bold: true, width: 8 }),
        cell('Tier', { bold: true, width: 16 }),
        cell('5yr Federal $', { bold: true, width: 16 }),
        cell('Awards', { bold: true, width: 8 }),
        cell('Certifications', { bold: true, width: 18 }),
      ],
    }),
    ...listed.map((b: ScoredEntity) => new TableRow({
      children: [
        cell(b.legalBusinessName),
        cell(b.state || '—'),
        cell(TIER_LABEL[b.tier] || b.tier),
        cell(usd(b.totalObligated)),
        cell(String(b.awardCount)),
        cell(b.certifications.join(', ') || '—'),
      ],
    })),
  ];

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: 'MARKET RESEARCH DETERMINATION', bold: true, size: 30 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: 'Small Business Market Depth — Set-Aside Analysis', size: 22, italics: true })],
        }),

        p(`Date prepared: ${today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`),
        p(`Prepared by: ${auth.email}`),
        p(`Scope of research: ${scope}`),
        p(`Data sources: SAM.gov entity registrations + USASpending.gov award history. Data as of ${today.toLocaleDateString()}.`, { spacingAfter: 240 }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { after: 120 }, children: [new TextRun({ text: '1. Finding', bold: true, size: 26 })] }),
        p(
          `Market research identified ${r.marketDepth} qualified small business${r.marketDepth === 1 ? '' : 'es'} ` +
          `with demonstrated capability for this requirement. Based on this analysis, the Rule of Two is ` +
          `${r.ruleOfTwoMet ? 'MET' : 'NOT MET'} — there ${r.ruleOfTwoMet ? 'is a reasonable expectation' : 'is not a reasonable expectation'} ` +
          `of receiving offers from two or more responsible small business concerns at fair market prices.`,
          { bold: true, spacingAfter: 200 },
        ),

        new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { after: 120 }, children: [new TextRun({ text: '2. Market Depth by Capability Tier', bold: true, size: 26 })] }),
        p(`Active Performer (won relevant work recently): ${r.counts.active_performer}`),
        p(`Capable (registered, qualified, some history): ${r.counts.capable}`),
        p(`Emerging (qualified, registered, limited past performance): ${r.counts.emerging}`),
        p(`Registered Only (registered, no relevant award history — shown for completeness, excluded from the depth count): ${r.registeredOnlyCount}`, { spacingAfter: 120 }),
        p(
          `The market-depth count above ${includeEmerging ? 'includes' : 'excludes'} Emerging firms. ` +
          `Emerging firms are qualified, registered small businesses building past performance; they are ` +
          `surfaced deliberately so capable new entrants are not overlooked in capacity-building decisions.`,
          { spacingAfter: 240 },
        ),

        new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { after: 120 }, children: [new TextRun({ text: `3. Identified Businesses (top ${listed.length} by capability)`, bold: true, size: 26 })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' },
          },
          rows: tableRows,
        }),
        new Paragraph({ spacing: { before: 80, after: 240 }, children: [new TextRun({ text: r.businesses.length > 50 ? `(${r.businesses.length} total qualified firms identified; top 50 listed.)` : '', size: 16, italics: true })] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { after: 120 }, children: [new TextRun({ text: '4. Methodology & Caveats', bold: true, size: 26 })] }),
        ...r.caveats.map((c: string) => p(`• ${c}`, { size: 18 })),
        p(
          '• Capability tiers are derived from federal award history (USASpending): recency, volume, ' +
          'frequency, agency breadth, and relevance to the target NAICS. "Active Performer" indicates ' +
          'recent relevant awards; "Registered Only" indicates a current SAM registration with no ' +
          'relevant award history.',
          { size: 18, spacingAfter: 240 },
        ),

        new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'This determination was generated to support acquisition planning. The contracting officer remains responsible for the final set-aside decision and any required verification of socioeconomic status.', size: 16, italics: true })] }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const fileName = `Market_Research_${naics}${state ? '_' + state : ''}${setAside ? '_' + setAside.replace(/[^a-z0-9]/gi, '') : ''}.docx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}
