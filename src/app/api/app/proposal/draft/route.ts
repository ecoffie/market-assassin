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
import { logEngagement, EventTypes } from '@/lib/engagement';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { generateV2Draft } from '@/lib/proposal/v2';
import { generateMultiPassSection, MULTIPASS_ENABLED } from '@/lib/proposal/multi-pass';
import { SECTION_META } from '@/lib/proposal/sections';
import type { SectionType } from '@/lib/proposal/types';
import { archiveContent } from '@/lib/archive/persist';
import type { ComplianceReq } from '@/lib/proposal/section-alignment';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Situation-aware sections can now run to ~5,000 words (Tier 1) — give a single
// section room to finish even when a provider falls back.
export const maxDuration = 180;

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

/**
 * Emit ONE proposal-funnel event and SURFACE a failed write.
 *
 * ⚠️ Why this wrapper exists: `logEngagement` NEVER REJECTS — it catches its own errors and
 * returns `{ success:false, error }`. So the `.catch(() => {})` this code originally carried
 * was dead code that caught nothing, and a failed insert would have passed silently while
 * LOOKING handled. That is exactly the silent-failure shape this whole audit exists to kill:
 * the funnel would read "nobody uses Proposal" when the truth is "the emitter never wrote."
 * A dropped event must be visible in logs, because a MISSING event and a REAL zero are
 * indistinguishable downstream — and this funnel is about to inform an entitlement decision.
 *
 * Awaited by the caller, never fire-and-forget: a floating promise races serverless teardown
 * and loses writes (measured 1-of-2 on federal-market-assassin).
 */
/**
 * The SAME journey key the map's proposal surface emits (`journeyId()` in
 * src/app/opportunity-map/proposal/route.ts): `journey:<notice_id>` whenever a notice id
 * exists. Reusing the existing identifier — rather than minting a second one — is what lets a
 * single pursuit be followed ACROSS surfaces (map card → /app workspace) instead of appearing
 * as two unrelated sessions. When there is no notice id the map falls back to a localStorage
 * id we cannot reproduce server-side, so we emit null rather than invent a key that would
 * silently fail to join.
 */
function journeyKey(noticeId: string | null | undefined): string | null {
  const nid = (noticeId || '').trim();
  return nid ? `journey:${nid}` : null;
}

async function emitProposalEvent(
  userEmail: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const res = await logEngagement({
    userEmail,
    eventType: EventTypes.TOOL_USE,
    eventSource: 'proposal',
    metadata: { surface: 'proposal', action, ...metadata },
  });
  if (!res.success) {
    console.error(`[proposal-telemetry] DROPPED ${action}:`, res.error);
  }
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  // Coach Mode: when drafting as a client, the vault weave (RAG retrieval) and the
  // archived output must both belong to the CLIENT — otherwise the draft is grounded
  // in the coach's past performance and the output lands in the coach's library
  // (leaking into every client's Generated tab).
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : email;

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
    const draftArgs = {
      email: scopedEmail,
      sectionType,
      sourceText,
      fileName: body.fileName,
      rfpAgency: body.rfpAgency,
      // #5: compliance matrix → this section drafts to its own requirements.
      requirements: Array.isArray(body.requirements)
        ? body.requirements.filter(r => r?.requirement).map(r => ({ id: r.id, requirement: r.requirement!, category: (r.category as ComplianceReq['category']) || 'other', section: r.section }))
        : undefined,
    };
    // TIER 2 (gated off): when PROPOSAL_MULTIPASS=1, a requirement-heavy section is
    // drafted as a multi-pass volume; otherwise this is the normal single-pass draft.
    const result = MULTIPASS_ENABLED
      ? await generateMultiPassSection(draftArgs)
      : await generateV2Draft(draftArgs);

    // Auto-library: fire-and-forget archive of this draft so the user
    // can recall it later via /app/library. Failure is non-blocking.
    const isCapStmt = ['company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc'].includes(sectionType);
    archiveContent({
      userEmail: scopedEmail,
      contentType: isCapStmt ? 'cap_statement' : 'proposal_section',
      contentSubtype: sectionType,
      title: `${result.label} — ${body.fileName || 'untitled RFP'}`,
      content: { draft: result.draft, meta: result.meta, sectionType, label: result.label, wordCount: result.wordCount },
      contentText: result.draft,
      agency: result.meta.agencyDetected || undefined,
      aiProvider: 'groq',
      aiModel: result.meta.model,
    }).catch(() => { /* non-fatal — logged inside */ });

    // PROPOSAL FUNNEL TELEMETRY (2026-08-23). Audit finding: proposal drafting persists NO
    // owned artifact (proposal_drafts / proposal_sections do not exist — INT-003 null, not
    // zero) and emitted ZERO engagement events, so "is this a paid-tier behaviour?" was
    // unanswerable: the evidence range was 19–356 free users. These events make the funnel
    // Workspace → Draft → Compliance → Export measurable BY ENTITLEMENT.
    // ⚠️ NO PROPOSAL TEXT in telemetry — identifiers and section type only.
    // AWAITED, not fire-and-forget: a floating promise races the serverless teardown and
    // silently loses events (measured 1-of-2 on federal-market-assassin).
    await emitProposalEvent(email, 'proposal_section_drafted', {
      section_type: body.sectionType || null,
      // ⚠️ This route's RequestBody carries NO pursuit identifiers (no pipelineId /
      // noticeId / regenerate) — the type checker caught me inventing them. Recording only
      // what genuinely exists; per-pursuit attribution for drafting needs the client to
      // send pipeline_id, which is a follow-up, not something to fabricate here.
      rfp_agency: body.rfpAgency || null,
      has_requirements: Array.isArray(body.requirements) && body.requirements.length > 0,
    });

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
