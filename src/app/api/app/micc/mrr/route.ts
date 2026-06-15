/**
 * /api/app/micc/mrr?email=&psc=&naics=&title=&keyword=[&format=docx]
 *
 * Army Market Research Report generator. Default → structured JSON (on-screen
 * preview). format=docx → the official Army MAY-2026 MRR template as .docx with
 * the data sections (§5/§9/§11/§12/§15) auto-filled and the CO's judgment
 * sections bracketed. (ACC-ORLANDO-MRR-SPEC.md)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { buildMrr, type MrrResult } from '@/lib/micc/mrr';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel } from 'docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const psc = (sp.get('psc') || '').trim() || undefined;
  const naics = (sp.get('naics') || '').trim() || undefined;
  const title = (sp.get('title') || '').trim() || undefined;
  const keyword = (sp.get('keyword') || '').trim() || undefined;
  if (!psc && !naics) {
    return NextResponse.json({ success: false, error: 'Provide a PSC and/or NAICS code.' }, { status: 400 });
  }

  try {
    const mrr = await buildMrr({ psc, naics, title, keyword });
    if (sp.get('format') === 'docx') {
      const buffer = await renderDocx(mrr);
      const fn = `MRR-${(title || psc || naics || 'draft').replace(/[^a-z0-9-_.]/gi, '_').slice(0, 50)}.docx`;
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${fn}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ success: true, mrr });
  } catch (err) {
    console.error('[micc/mrr]', err);
    return NextResponse.json({ success: false, error: 'MRR generation failed' }, { status: 500 });
  }
}

// ── .docx rendering — the official Army MAY-2026 MRR layout ─────────────
function $(v: number): string { return `$${Math.round(v).toLocaleString()}`; }
function d(s?: string): string { return (s || '').slice(0, 10) || '—'; }

function cell(text: string, bold = false): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
}
function headerRow(labels: string[]): TableRow {
  return new TableRow({ tableHeader: true, children: labels.map(l => cell(l, true)) });
}

async function renderDocx(m: MrrResult): Promise<Buffer> {
  const today = new Date(m.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const c: (Paragraph | Table)[] = [];
  const H = (t: string) => c.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 80 }, children: [new TextRun({ text: t, bold: true })] }));
  const P = (t: string, opts: { italic?: boolean; color?: string } = {}) => c.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: t, italics: opts.italic, color: opts.color, size: 20 })] }));
  const BRACKET = (t: string) => c.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, italics: true, color: '999999', size: 20 })] }));

  // Title
  c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'MARKET RESEARCH REPORT', bold: true, size: 28 })] }));
  c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: m.input.title || '[Requirement Title]', size: 22 })] }));
  c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `Auto-drafted ${today} · data sections from USASpending award data · CO to complete bracketed sections`, italics: true, size: 16, color: '888888' })] }));

  // Part 1 bracketed
  c.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Part 1 — General Information', bold: true, size: 22 })] }));
  BRACKET('§1 Product/Equipment/Service/Program: [CO to complete]');
  BRACKET('§2 Points of Contact (Prepared by / Technical / Requirements): [CO to complete]');
  BRACKET('§3 Contracting Activity, Contract Specialist, Contracting Officer: [CO to complete]');
  BRACKET('§4 Independent Government Estimate (IGE): [CO to insert the Government cost estimate + table]');

  // §5 Taxonomy — auto
  H('§5 Taxonomy (auto-filled)');
  P(`Product Service Code (PSC): ${m.taxonomy.psc || '[CO to add]'}`);
  P(`NAICS Code: ${m.taxonomy.naics || '[CO to add]'}`);
  if (m.taxonomy.marketTotal != null) P(`Federal market size (this space): ${$(m.taxonomy.marketTotal)} across ${m.taxonomy.naicsCount ?? '?'} NAICS codes (source: USASpending).`);
  if (m.taxonomy.topPsc) P(`Most-purchased product/service (PSC): ${m.taxonomy.topPsc}.`);
  BRACKET('Small Business Size Standard: [CO to confirm from SBA size-standards table for the selected NAICS]');

  BRACKET('§6 Description of Supplies/Services · §7 Performance Requirements · §8 Background: [CO to complete]');

  // §9 Procurement History — auto table
  H('§9 Procurement History (auto-filled from USASpending)');
  if (m.procurementHistory.length === 0) P('No prior award history found for this code. [CO to verify / add internal contract files.]', { italic: true });
  else {
    c.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(['Contractor', 'Contract Type', 'Set-Aside / Method', 'Total Obligated', 'Awards', 'Period (first→last)']),
        ...m.procurementHistory.map(r => new TableRow({ children: [
          cell(r.recipient_name), cell(r.contract_type || '—'), cell(r.set_aside || '—'),
          cell($(r.total_obligated)), cell(String(r.award_count)), cell(`${d(r.first_action)} → ${d(r.last_action)}`),
        ] })),
      ],
    }));
    P(`Source: USASpending award data, as of ${today}.`, { italic: true, color: '888888' });
  }

  BRACKET('§10 Non-Commercial Rationale (if applicable) · §13 Mandatory Sources · §14 Market Research Techniques Used: [CO to complete]');

  // §11 Potential Suppliers — auto table
  H('§11 Potential Supplier Information (auto-filled — capable small businesses)');
  if (m.suppliers.length === 0) P('No capable suppliers found. [Broaden the PSC/NAICS, or CO to add known sources.]', { italic: true });
  else {
    c.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(['Vendor', 'UEI', 'Match', 'Total Federal $', 'Awards', 'Set-Aside Winner']),
        ...m.suppliers.slice(0, 30).map(r => new TableRow({ children: [
          cell(r.recipient_name), cell(r.recipient_uei), cell(r.match_reason),
          cell($(r.total_obligated)), cell(String(r.award_count)), cell(r.won_set_aside ? 'Yes' : 'No'),
        ] })),
      ],
    }));
    P(`Ranked by relevance (won the exact PSC > related > NAICS). Source: USASpending, as of ${today}.`, { italic: true, color: '888888' });
  }

  // §12 Small Business Opportunities — auto
  H('§12 Small Business Opportunities (auto-filled)');
  P(`Recommended approach: ${m.smallBizRecommendation.recommendedSetAside}.`);
  P(m.smallBizRecommendation.rationale);
  P(`Capable suppliers found: ${m.marketIntel.supplierCount} · small businesses (≤$25M): ${m.marketIntel.smallBusinessCount} · set-aside winners: ${m.marketIntel.setAsideWinners}.`);

  // §15 Market Intelligence — auto
  H('§15 Market Intelligence / Industry Analysis (auto-filled)');
  P(`Supplier pool: ${m.marketIntel.supplierCount} firms with relevant federal award history (competition: ${m.marketIntel.competition}).`);
  P(`Small-business footprint: ${m.marketIntel.smallBusinessCount} firms under the small-business ceiling; ${m.marketIntel.setAsideWinners} have won set-aside work — indicating active socioeconomic participation in this market.`);
  if (m.taxonomy.marketTotal != null) P(`Total federal demand in this space: ${$(m.taxonomy.marketTotal)}.`);
  BRACKET('Commerciality assessment, pricing analysis, and Government leverage: [CO to complete per FAR 2.101 / DFARS PGI 212.001-70].');

  // §16 + signatures
  H('§16 Conclusions and Recommendations (draft — CO to finalize)');
  P(`Based on the market research above, recommend: ${m.smallBizRecommendation.recommendedSetAside}. ${m.smallBizRecommendation.rationale}`, { italic: true });
  BRACKET('Part 4 Signature Pages: [Prepared by / Technical / Contract Specialist / Contracting Officer — digital signatures per AR 25-50]');

  const doc = new Document({ creator: 'Mindy', title: `MRR — ${m.input.title || ''}`, sections: [{ children: c }] });
  return Packer.toBuffer(doc);
}
