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
import { extractSow, buildClinScope } from '@/lib/proposal/sow-extraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  let clinScope: { title: string; body: string; name: string } | null = null;
  if (pipelineId) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: docs, error: docsErr } = await sb.from('pursuit_documents')
      .select('filename, doc_kind, extracted_text, char_count')
      .eq('pipeline_id', pipelineId)
      .in('doc_kind', ['sow_pws', 'attachment_other', 'solicitation', 'pricing'])
      .not('extracted_text', 'is', null)
      .order('char_count', { ascending: false });
    if (docsErr) console.error('[extract-sow] docs query error:', docsErr.message);

    // CLIN scope (Eric: "the CLINs give you an idea of the SOW — you just have to
    // find the full scope"). Build a clean scope-at-a-glance from the pricing
    // schedule's CLIN lines as a fallback when there's no standalone SOW.
    const pricingDoc = docs?.find(d => d.doc_kind === 'pricing' && /clin/i.test(d.extracted_text || ''));
    if (pricingDoc?.extracted_text) {
      const clinScope_ = buildClinScope(pricingDoc.extracted_text);
      if (clinScope_) clinScope = { title: 'Scope at a Glance (from the CLINs)', body: clinScope_, name: pricingDoc.filename || 'pricing' };
    }
    // Prefer a REAL standalone SOW/PWS doc (Eric: design specs are reference
    // material for the design, NOT the scope of work — don't substitute them).
    // Only an actual sow_pws or a filename that clearly says SOW/PWS/Statement
    // of Work counts. Otherwise fall back to regex over the solicitation.
    const sowDoc = docs?.find(d => d.doc_kind === 'sow_pws')
      || docs?.find(d => /\b(sow|pws)\b|statement of work|performance work statement/i.test(d.filename || '') && d.doc_kind !== 'solicitation' && !/design|spec/i.test(d.filename || ''));
    if (sowDoc?.extracted_text && sowDoc.extracted_text.length > 600) {
      standaloneSow = {
        title: 'Statement of Work',
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

  // Priority: a real standalone SOW → the SOW section regex'd from the
  // solicitation → the CLIN scope summary (Eric). Honest error only if none.
  const regexSow = standaloneSow ? null : extractSow(text);
  const sow = standaloneSow
    || (regexSow && regexSow.found ? regexSow : null)
    || clinScope;
  if (!sow || !('body' in sow) || !sow.body) {
    return NextResponse.json({
      success: false,
      error: 'No standalone Statement of Work in this notice — the scope is spread across the solicitation + attachments. Use the document manifest above to send subs the right files.',
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
