/**
 * Proposal Assist draft route.
 *
 * Auth + validation handled here. Generation delegated to
 * @/lib/proposal/v2 — the layered architecture that mirrors what made
 * Content Reaper's LinkedIn posts feel "this applies to my business":
 *
 *   1. Bidder profile + vault           (FACTUAL)
 *   2. Agency pain points + priorities  (TARGET context)
 *   3. RAG style references             (from GovCon Giants corpus)
 *   4. Section-specific lens            (variety across runs)
 *   5. Section-specific writer voice    (exec summary writer ≠ pricing writer)
 *   6. Humanization pass                (strips LLM tells)
 *
 * Flipped from v1 to v2 on 2026-05-27 after A/B harness verification
 * on a real Army Marketing Sources Sought showed v2 leading with the
 * agency mission, picking up RFP language verbatim, and pulling 6 Army
 * pain points into the prompt. v1 logic is preserved in
 * src/lib/proposal/v1.ts and remains callable via the A/B harness
 * at /admin/proposal-ab for ongoing regression checking.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { generateV2Draft } from '@/lib/proposal/v2';
import { SECTION_META } from '@/lib/proposal/sections';
import type { SectionType } from '@/lib/proposal/types';
import { archiveContent } from '@/lib/archive/persist';
import type { ComplianceReq } from '@/lib/proposal/section-alignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

interface RequestBody {
  text?: string;
  fileName?: string;
  sectionType?: SectionType;
  /** Optional: client may know the RFP agency already (e.g. came from
   *  a pursuit row with a saved agency field). v2 will still try to
   *  detect from text if not provided. */
  rfpAgency?: string | null;
  requirements?: Array<{ id?: string; requirement?: string; category?: string; section?: string }>;
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
  const sectionType = body.sectionType;

  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: 'No source text provided. Upload an RFP first.' },
      { status: 400 }
    );
  }
  if (!sectionType || !SECTION_META[sectionType]) {
    return NextResponse.json(
      { success: false, error: 'sectionType must be one of: exec_summary, technical, management, past_performance, pricing, company_overview, cap_past_performance, capabilities, differentiators, poc' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'AI service not configured' }, { status: 500 });
  }

  try {
    const result = await generateV2Draft({
      email,
      sectionType,
      sourceText,
      fileName: body.fileName,
      rfpAgency: body.rfpAgency,
      // #5: compliance matrix → this section drafts to its own requirements.
      requirements: Array.isArray(body.requirements)
        ? body.requirements.filter(r => r?.requirement).map(r => ({ id: r.id, requirement: r.requirement!, category: (r.category as ComplianceReq['category']) || 'other', section: r.section }))
        : undefined,
    });

    // Auto-library: fire-and-forget archive of this draft so the user
    // can recall it later via /app/library. Failure is non-blocking.
    const isCapStmt = ['company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc'].includes(sectionType);
    archiveContent({
      userEmail: email,
      contentType: isCapStmt ? 'cap_statement' : 'proposal_section',
      contentSubtype: sectionType,
      title: `${result.label} — ${body.fileName || 'untitled RFP'}`,
      content: { draft: result.draft, meta: result.meta, sectionType, label: result.label, wordCount: result.wordCount },
      contentText: result.draft,
      agency: result.meta.agencyDetected || undefined,
      aiProvider: 'groq',
      aiModel: result.meta.model,
    }).catch(() => { /* non-fatal — logged inside */ });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[proposal/draft v2] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/draft',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });

    // Friendly error message for client; full details in logs
    const message = errAsError.message.includes('GROQ')
      ? 'AI service error. Try again.'
      : 'Draft generation failed. Try again.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
