/**
 * /api/app/proposal/extract-sow
 *
 * Extract the SOW / PWS / SOO from an uploaded solicitation and return it as a
 * clean .docx the user can hand to subcontractors for pricing/bids (Eric: pair
 * it with the compliance matrix as a "sub package"). POST { text, fileName? }.
 *
 * Detection: heading patterns for STATEMENT OF WORK / PERFORMANCE WORK
 * STATEMENT / STATEMENT OF OBJECTIVES / SECTION C, captured until the next
 * top-level section heading. Falls back to returning a clear message if no SOW
 * heading is found (the user can paste/upload the SOW directly).
 *
 * GET ?probe=1&text=... returns just the detected range as JSON (for preview).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Headings that START a SOW/PWS/SOO block.
const START_RE = /(STATEMENT\s+OF\s+WORK|PERFORMANCE\s+WORK\s+STATEMENT|STATEMENT\s+OF\s+OBJECTIVES|\bP\.?W\.?S\.?\b|\bS\.?O\.?W\.?\b|SECTION\s+C\b|^C\.\s)/im;
// Headings that END it (the next major section).
const END_RE = /(SECTION\s+[D-M]\b|^[D-M]\.\s|INSTRUCTIONS\s+TO\s+OFFERORS|EVALUATION\s+FACTORS|CONTRACT\s+CLAUSES|LIST\s+OF\s+ATTACHMENTS)/im;

function extractSow(text: string): { found: boolean; title: string; body: string } {
  const startM = START_RE.exec(text);
  if (!startM) return { found: false, title: 'Statement of Work', body: '' };
  const startIdx = startM.index;
  // Look for the end heading AFTER the start.
  const after = text.slice(startIdx + startM[0].length);
  const endM = END_RE.exec(after);
  const endIdx = endM ? startIdx + startM[0].length + endM.index : text.length;
  const body = text.slice(startIdx, endIdx).trim();
  const title = /performance\s+work/i.test(startM[0]) ? 'Performance Work Statement'
    : /objectives/i.test(startM[0]) ? 'Statement of Objectives'
    : 'Statement of Work';
  // Guard: if the captured block is tiny, treat as not-found (likely a TOC ref).
  if (body.length < 400) return { found: false, title, body: '' };
  return { found: true, title, body };
}

function buildDocx(title: string, body: string, sourceName: string): Promise<Buffer> {
  const lines = body.split('\n');
  const paras: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Extracted from ${sourceName || 'the solicitation'} via Mindy — for subcontractor pricing.`, italics: true, color: '666666' })] }),
    new Paragraph({ children: [] }),
  ];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { paras.push(new Paragraph({ children: [] })); continue; }
    // Treat short ALL-CAPS / numbered lines as sub-headings.
    const isHeading = /^([A-Z][A-Z0-9 .\-]{3,60}|C\.\d|[0-9]+\.[0-9]?\s+[A-Z])/.test(line) && line.length < 80;
    paras.push(new Paragraph(isHeading
      ? { heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: line, bold: true })] }
      : { children: [new TextRun({ text: line })] }));
  }
  const doc = new Document({ sections: [{ children: paras }] });
  return Packer.toBuffer(doc);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let text = String(body.text || '');
  let fileName = String(body.fileName || 'solicitation');

  // Prefer the CLASSIFIED SOW document (Eric QC: the export was scanning the
  // entire combined 11-doc blob → grabbed a 507-page mashup with the wrong
  // boundaries, often the wrong section). Pull the CLASSIFIED scope doc for THIS
  // pursuit and export the whole thing — a standalone SOW/design-spec IS the
  // scope, no regex hunt needed.
  const pipelineId = String(body.pipeline_id || '').trim();
  let standaloneSow: { title: string; body: string; name: string } | null = null;
  if (pipelineId) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: docs } = await sb.from('pursuit_documents')
      .select('filename, doc_kind, extracted_text, char_count')
      .eq('pipeline_id', pipelineId)
      .in('doc_kind', ['sow_pws', 'attachment_other', 'solicitation'])
      .not('extracted_text', 'is', null)
      .order('char_count', { ascending: false });
    // Prefer a doc classified as the scope: a real sow_pws, else a design-spec/
    // scope attachment (filename hints), else fall back to regex over the
    // solicitation below.
    const sowDoc = docs?.find(d => d.doc_kind === 'sow_pws')
      || docs?.find(d => /sow|statement of work|pws|scope|spec|design/i.test(d.filename || '') && d.doc_kind !== 'solicitation');
    if (sowDoc?.extracted_text && sowDoc.extracted_text.length > 600) {
      // Export the standalone scope doc whole (cap to a sane size).
      standaloneSow = {
        title: /design|spec/i.test(sowDoc.filename || '') ? 'Scope / Design Specifications' : 'Statement of Work',
        body: sowDoc.extracted_text.slice(0, 120000),
        name: sowDoc.filename || fileName,
      };
    } else {
      const sol = docs?.find(d => d.doc_kind === 'solicitation');
      if (sol?.extracted_text) { text = sol.extracted_text; fileName = sol.filename || fileName; }
    }
  }

  if (!standaloneSow && text.trim().length < 200) {
    return NextResponse.json({ success: false, error: 'No solicitation text provided.' }, { status: 400 });
  }

  // Use the standalone scope doc if we found one; else regex-extract the SOW
  // section from the solicitation.
  const sow = standaloneSow || extractSow(text);
  if (!('body' in sow) || !sow.body || (('found' in sow) && !sow.found)) {
    return NextResponse.json({
      success: false,
      error: 'Could not find a Statement of Work / scope document for this pursuit. It may be in an attachment we couldn’t read — check the document manifest, or paste the SOW text.',
    }, { status: 422 });
  }
  const outName = 'name' in sow ? sow.name : fileName;
  const buffer = await buildDocx(sow.title, sow.body, outName);
  const safe = `${sow.title.replace(/\s+/g, '-')}-${outName.replace(/\.[^.]+$/, '').slice(0, 40)}.docx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safe}"`,
    },
  });
}

// Lightweight probe (no auth needed for preview of detected range length).
export async function GET(request: NextRequest) {
  const text = request.nextUrl.searchParams.get('text') || '';
  const sow = extractSow(text);
  return NextResponse.json({ success: sow.found, title: sow.title, length: sow.body.length, preview: sow.body.slice(0, 300) });
}
