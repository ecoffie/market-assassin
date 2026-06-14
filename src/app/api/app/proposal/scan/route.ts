/**
 * Pre-submission compliance SCAN — "will this proposal get thrown out?"
 *
 * POST /api/app/proposal/scan?email=...
 * body: {
 *   requirements: [{ requirement, category, section }],   // the RFP's compliance matrix
 *   draftText: string,                                     // the full response text
 *   sections?: [{ label, text }],                          // optional per-section
 *   bidderSetAsides?: string[]                             // certs the bidder holds
 * }
 *
 * Returns the ranked findings (DQ first). Deterministic — no LLM — so it's fast
 * and free to run on every save. Reuses the same compliance requirements the
 * matrix already extracts. (Task #11; grounded in docs/RFP-FORMAT-ANALYSIS.md.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { scanCompliance, type ScanInput } from '@/lib/proposal/compliance-scanner';
import type { ComplianceReq } from '@/lib/proposal/section-alignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScanRequestBody {
  requirements?: Array<{ id?: string; requirement?: string; category?: string; section?: string }>;
  draftText?: string;
  sections?: Array<{ label?: string; text?: string }>;
  bidderSetAsides?: string[];
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let body: ScanRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const requirements: ComplianceReq[] = (body.requirements || [])
    .filter((r) => r && typeof r.requirement === 'string' && r.requirement.trim())
    .map((r) => ({ id: r.id, requirement: r.requirement!, category: (r.category as ComplianceReq['category']) || 'other', section: r.section }));

  const draftText = (body.draftText || '').trim()
    || (body.sections || []).map((s) => s?.text || '').join('\n\n').trim();

  if (requirements.length === 0) {
    return NextResponse.json({ success: false, error: 'No requirements to scan against — generate the compliance matrix first.' }, { status: 400 });
  }
  if (!draftText) {
    return NextResponse.json({ success: false, error: 'No proposal text to scan.' }, { status: 400 });
  }

  const input: ScanInput = {
    requirements,
    draftText,
    sections: (body.sections || []).filter((s) => s?.text).map((s) => ({ label: s.label || '', text: s.text! })),
    bidderSetAsides: Array.isArray(body.bidderSetAsides) ? body.bidderSetAsides : [],
  };

  const result = scanCompliance(input);
  return NextResponse.json({ success: true, ...result });
}
