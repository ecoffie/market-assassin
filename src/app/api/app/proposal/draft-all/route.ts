/**
 * Draft Entire Proposal endpoint — Content Reaper pattern #2 applied.
 *
 * POST /api/app/proposal/draft-all?email=...
 *   Body: { text, fileName?, rfpAgency?, sectionTypes? }
 *
 * Auth-gated like /api/app/proposal/draft. Returns the same DraftResult
 * shape per section, plus the outline meta + any per-section errors.
 *
 * Each successful section is also archived via the auto-library
 * pattern (#4) — silent persistence so the user can recall the full
 * draft later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { generateAllSections } from '@/lib/proposal/draft-all';
import { archiveContent } from '@/lib/archive/persist';
import type { SectionType } from '@/lib/proposal/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;  // up to 2 min for the full pipeline

const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

interface RequestBody {
  text?: string;
  fileName?: string;
  rfpAgency?: string | null;
  sectionTypes?: SectionType[];
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }
  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const sourceText = (body.text || '').trim();
  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: 'No source text provided. Upload an RFP first.' },
      { status: 400 }
    );
  }

  try {
    const result = await generateAllSections({
      email,
      sourceText,
      fileName: body.fileName,
      rfpAgency: body.rfpAgency,
      sectionTypes: body.sectionTypes,
    });

    // Auto-library archive of each section (fire-and-forget batch)
    for (const section of result.sections) {
      const isCapStmt = ['company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc'].includes(section.section);
      archiveContent({
        userEmail: email,
        contentType: isCapStmt ? 'cap_statement' : 'proposal_section',
        contentSubtype: section.section,
        title: `${section.label} — ${body.fileName || 'untitled RFP'}`,
        content: { draft: section.draft, meta: section.meta, sectionType: section.section, label: section.label, wordCount: section.wordCount, batchOrigin: 'draft-all' },
        contentText: section.draft,
        agency: section.meta.agencyDetected || undefined,
        aiProvider: 'groq',
        aiModel: section.meta.model,
        tags: ['draft-all'],
      }).catch(() => { /* non-fatal */ });
    }

    return NextResponse.json({
      success: true,
      sectionCount: result.sections.length,
      totalProcessingMs: result.totalProcessingMs,
      outline: result.outline,
      sections: result.sections,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[proposal/draft-all] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/draft-all',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });
    return NextResponse.json({ success: false, error: 'Draft generation failed. Try again.' }, { status: 500 });
  }
}
