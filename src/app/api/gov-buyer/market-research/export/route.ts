/**
 * GET /api/gov-buyer/market-research/export
 *
 * The Market Research Determination a contracting officer files to support a
 * set-aside decision — the finding, the capability tiers, the identified
 * firms, the procurement history, the market signals, and the methodology.
 *
 * `format=docx` (default) | `pdf` | `html`
 *
 * BOTH formats render the SAME model (`buildMemoModel`). The document's facts
 * are written once in `memo-model.ts`; this route only renders. Two
 * independently-authored copies of a compliance document drift, and a
 * determination that says one thing in Word and another in PDF is worse than
 * having only one format.
 *
 * Gated to gov_buyer (requireGovBuyer). PRD: tasks/PRD-market-research-workspace.md §6 Step 6.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import { requireGovBuyer } from '@/lib/gov-buyer/auth';
import { runMarketResearch } from '@/lib/gov-buyer/market-research';
import { getAcquisitionContext, type AcquisitionContext } from '@/lib/gov-buyer/acquisition-context';
import { computeCompetitionDepth, type CompetitionDepth } from '@/lib/analytics/competition-depth';
import { buildMemoModel, type MemoModel, type MemoSection } from '@/lib/gov-buyer/memo-model';
import { memoToHtml } from '@/lib/gov-buyer/memo-html';
import { htmlToPdf } from '@/lib/pdf/launch-browser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'EEEEEE' },
};

/** One model section → its Word paragraphs/table. */
function sectionToDocx(s: MemoSection): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 120 },
      children: [new TextRun({ text: s.heading, bold: true, size: 26 })],
    }),
  ];
  if (s.lead) out.push(p(s.lead, { bold: true, spacingAfter: 200 }));
  for (const para of s.paragraphs) out.push(p(para));

  if (s.table) {
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [
        new TableRow({
          tableHeader: true,
          children: s.table.headers.map((h) => cell(h, { bold: true })),
        }),
        ...s.table.rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
      ],
    }));
    if (s.table.caption) {
      out.push(new Paragraph({
        spacing: { before: 80, after: 160 },
        children: [new TextRun({ text: s.table.caption, size: 16, italics: true })],
      }));
    }
  }

  if (s.footnotes?.length) {
    for (const f of s.footnotes) out.push(p(`• ${f}`, { size: 18 }));
  }
  out.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
  return out;
}

function modelToDocx(m: MemoModel): Document {
  return new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: m.title, bold: true, size: 30 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: m.subtitle, size: 22, italics: true })],
        }),
        p(`Date prepared: ${m.datePrepared}`),
        p(`Prepared by: ${m.preparedBy}`),
        p(`Scope of research: ${m.scope}`),
        p(`Data sources: ${m.dataSources}`, { spacingAfter: 240 }),
        ...m.sections.flatMap(sectionToDocx),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: m.closing, size: 16, italics: true })],
        }),
      ],
    }],
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email');
  const naics = sp.get('naics');
  const state = sp.get('state') || undefined;
  const setAside = sp.get('setAside') || undefined;
  const includeEmerging = sp.get('includeEmerging') !== 'false';
  const format = (sp.get('format') || 'docx').toLowerCase();

  const auth = await requireGovBuyer(request, email);
  if (!auth.ok) return auth.response;
  if (!naics) {
    return NextResponse.json({ success: false, error: 'naics is required' }, { status: 400 });
  }

  const agency = sp.get('agency') || undefined;
  const keyword = sp.get('keyword') || undefined;

  // The determination and the acquisition context are independent reads; a
  // context failure must not cost the CO the determination, so it degrades to
  // null and the memo says which sections were not measured.
  const [research, ctx, competition] = await Promise.all([
    runMarketResearch({ naics, state, setAside, includeEmerging, limit: 500 }),
    getAcquisitionContext({ naics, agency, state, keyword })
      .catch((): AcquisitionContext | null => null),
    // Competition needs a buyer to sample. No agency → no section, rather than
    // a nationwide figure masquerading as this requirement's competition.
    agency
      ? computeCompetitionDepth(agency, 100, { naics, state })
          .catch((): CompetitionDepth | null => null)
      : Promise.resolve(null),
  ]);

  const model = buildMemoModel({
    research,
    ctx,
    req: {
      naics, state, setAside, agency, keyword,
      title: sp.get('title') || undefined,
      office: sp.get('office') || undefined,
      psc: sp.get('psc') || undefined,
      estimatedValue: sp.get('estValue') || undefined,
      pop: sp.get('pop') || undefined,
      description: sp.get('description') || undefined,
    },
    preparedBy: auth.email,
    includeEmerging,
    competition,
  });

  if (format === 'pdf' || format === 'html') {
    const html = memoToHtml(model);
    if (format === 'html') {
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    // HTML → Chromium → PDF via the shared launcher, which picks
    // @sparticuz/chromium on Vercel and bundled puppeteer locally. Plain
    // `puppeteer` has no binary in the lambda — that is exactly why this
    // button returned HTML on prod before the launcher existed.
    //
    // If a browser still cannot start, degrade to the printable HTML rather
    // than 500: a CO can Print → Save as PDF and still file the memo.
    const { pdf, error: pdfError } = await htmlToPdf(html, { format: 'Letter', printBackground: true });
    if (pdf) {
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${model.fileBase}.pdf"`,
        },
      });
    }
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Tell the caller the format changed, so the UI can say so honestly
        // instead of silently handing back the wrong file type.
        'X-Export-Degraded': 'pdf-unavailable',
        // Surface WHY, so a prod failure is diagnosable from a curl.
        'X-Export-Degraded-Reason': (pdfError || 'unknown').replace(/[^\x20-\x7E]/g, ' ').slice(0, 200),
      },
    });
  }

  const buffer = await Packer.toBuffer(modelToDocx(model));
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${model.fileBase}.docx"`,
    },
  });
}
