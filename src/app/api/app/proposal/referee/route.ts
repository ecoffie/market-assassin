/**
 * /api/app/proposal/referee — INDEPENDENT compliance referee (Eric's original
 * vision: "extract requirements → create draft → final gets run against an
 * independent evaluator so at minimum it's compliant").
 *
 * A SEPARATE model (Claude, via job:'referee') reads the extracted requirements
 * + the assembled draft and judges, per requirement: met / partial / missing.
 * The eval engine lives in `src/lib/proposal/referee.ts` (shared with the MCP
 * tool `referee_proposal_compliance`); this route is the auth + HTTP shell.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { refereeProposal, type RefereeRequirement } from '@/lib/proposal/referee';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { requirements?: RefereeRequirement[]; draft?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }

  const requirements = (body.requirements || []).filter((r) => r.requirement);
  const draft = (body.draft || '').trim();
  if (requirements.length === 0) return NextResponse.json({ success: false, error: 'No requirements to check' }, { status: 400 });
  if (!draft) return NextResponse.json({ success: false, error: 'No draft to evaluate' }, { status: 400 });

  const { verdicts, summary } = await refereeProposal(requirements, draft, { userEmail: email });

  return NextResponse.json({ success: true, verdicts, summary });
}
