/**
 * /api/app/proposal/referee — INDEPENDENT compliance referee (Eric's original
 * vision: "extract requirements → create draft → final gets run against an
 * independent evaluator so at minimum it's compliant").
 *
 * A SEPARATE model (Claude, via job:'referee') reads the extracted requirements
 * + the assembled draft and judges, per requirement: met / partial / missing.
 * Independence matters — the model that WROTE the draft thinks it's done; a
 * fresh model with only (requirements + draft) is an honest referee. Flags every
 * unmet "shall" so the user ships something at-minimum compliant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { callLLM } from '@/lib/llm/call-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface RefReq { id?: string; requirement: string; category?: string; section?: string }
interface RefVerdict {
  id: string;
  requirement: string;
  status: 'met' | 'partial' | 'missing';
  evidence?: string;   // where in the draft it's addressed (or why it's not)
}

const REFEREE_PROMPT = `You are an INDEPENDENT federal proposal compliance reviewer. You did NOT write this draft — your only job is to verify, requirement by requirement, whether the draft actually satisfies it. Be strict: a real Contracting Officer would.

For EACH requirement, judge:
- "met": the draft clearly and specifically addresses it.
- "partial": the draft touches it but is vague, generic, or incomplete.
- "missing": the draft does not address it at all.

Give one short evidence note: quote/paraphrase where the draft addresses it, OR say what's absent.

Return ONLY JSON:
{"verdicts":[{"id":"REQ-001","status":"met|partial|missing","evidence":"..."}]}

Be honest. Defaulting everything to "met" is useless — the value is catching what's NOT covered before submission.`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { requirements?: RefReq[]; draft?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }

  const requirements = (body.requirements || []).filter(r => r.requirement);
  const draft = (body.draft || '').trim();
  if (requirements.length === 0) return NextResponse.json({ success: false, error: 'No requirements to check' }, { status: 400 });
  if (!draft) return NextResponse.json({ success: false, error: 'No draft to evaluate' }, { status: 400 });

  // Number the requirements stably, then check in batches of 15 so each referee
  // call has enough room to reason about every requirement against the draft.
  const numbered = requirements.map((r, i) => ({ ...r, id: r.id || `REQ-${String(i + 1).padStart(3, '0')}` }));
  const draftForPrompt = draft.slice(0, 24000); // referee reads the assembled draft
  const verdicts: RefVerdict[] = [];

  for (const batch of chunk(numbered, 15)) {
    const reqList = batch.map(r => `${r.id} [${r.category || 'other'}${r.section ? ` · ${r.section}` : ''}]: ${r.requirement}`).join('\n');
    try {
      const { text } = await callLLM({
        system: REFEREE_PROMPT,
        user: `REQUIREMENTS TO CHECK:\n${reqList}\n\n=== THE DRAFT ===\n${draftForPrompt}`,
        json: true,
        maxTokens: 2500,
        temperature: 0.1,
        // The draft under review contains the bidder's vault facts (real
        // contracts, team) → no-training providers only (Data Trust 3.1).
        dataClass: 'sensitive',
        job: 'referee', // independent model (Claude) — different from the drafter
      });
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      for (const v of (parsed.verdicts || [])) {
        const req = batch.find(b => b.id === v.id);
        verdicts.push({
          id: v.id,
          requirement: req?.requirement || '',
          status: ['met', 'partial', 'missing'].includes(v.status) ? v.status : 'missing',
          evidence: v.evidence,
        });
      }
    } catch (err) {
      console.warn('[proposal/referee] batch failed:', err instanceof Error ? err.message : err);
      // On failure, mark the batch unknown→missing so it's surfaced, not hidden.
      for (const r of batch) verdicts.push({ id: r.id, requirement: r.requirement, status: 'missing', evidence: 'Referee could not evaluate — review manually.' });
    }
  }

  const met = verdicts.filter(v => v.status === 'met').length;
  const partial = verdicts.filter(v => v.status === 'partial').length;
  const missing = verdicts.filter(v => v.status === 'missing').length;
  const score = verdicts.length ? Math.round((met + partial * 0.5) / verdicts.length * 100) : 0;

  return NextResponse.json({
    success: true,
    verdicts,
    summary: { total: verdicts.length, met, partial, missing, score },
  });
}
