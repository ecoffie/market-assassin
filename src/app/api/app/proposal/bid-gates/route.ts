/**
 * /api/app/proposal/bid-gates?email=&pipeline_id= — derive OPPORTUNITY-SPECIFIC
 * go/no-go gates from THIS solicitation (Eric QC: the generic gate checklist felt
 * like generic data, not from the real docs). Uses pursuit fields (set-aside,
 * NAICS, deadline) + the cached requirements + the solicitation text to make each
 * gate concrete: "This is a Total Small Business Set-Aside under NAICS 236220
 * ($45M size standard) — are you a small business?" not "Are you eligible?".
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { createClient } from '@supabase/supabase-js';
import { callLLM } from '@/lib/llm/call-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DerivedGate { id: string; question: string; detail: string; source?: string }

// NAICS size standards (the common construction/services ones; fallback note
// otherwise). Receipts in $M, employees where applicable.
const SIZE_STANDARDS: Record<string, string> = {
  '236220': '$45M average annual receipts', '236210': '$45M', '237310': '$45M',
  '238': '$19M (most specialty trades)', '541512': '$34M', '541330': '$25.5M',
  '561210': '$47M', '561720': '$22M',
};
function sizeStandardFor(naics: string): string {
  if (SIZE_STANDARDS[naics]) return SIZE_STANDARDS[naics];
  const prefix = Object.keys(SIZE_STANDARDS).find(k => naics.startsWith(k));
  return prefix ? SIZE_STANDARDS[prefix] : 'the SBA size standard for this NAICS';
}

const DERIVE_PROMPT = `You are reading a federal solicitation to find the GO/NO-GO eliminators a bidder must satisfy to be eligible — the things that DISQUALIFY them if unmet. Extract ONLY concrete, opportunity-specific eliminators actually stated in the text:
- Required licenses / certifications (name the specific one)
- Minimum past-performance (e.g. "3 similar projects over $1M in the last 5 years" — quote the real numbers)
- Bonding / insurance requirements (bid bond %, payment/performance bond)
- Mandatory site visit / registration
- Key personnel minimums (e.g. "PM with 10 years")
Return ONLY JSON: {"gates":[{"question":"a yes/no question phrased for the bidder","detail":"the specific requirement, with real numbers/names from the text","source":"the clause or section if visible"}]}
If a category isn't specified in the text, omit it. Quote REAL specifics — never generic placeholders.`;

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  if (!pipelineId) return NextResponse.json({ success: false, error: 'pipeline_id required' }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: pursuit } = await sb.from('user_pipeline')
    .select('title, set_aside, naics_code, response_deadline, notice_id')
    .eq('id', pipelineId).maybeSingle();

  const gates: DerivedGate[] = [];

  // 1. Set-aside gate — concrete from the pursuit field.
  if (pursuit?.set_aside && !/^none$/i.test(pursuit.set_aside)) {
    const naics = pursuit.naics_code || '';
    gates.push({
      id: 'set_aside',
      question: `This is a ${pursuit.set_aside}${naics ? ` under NAICS ${naics}` : ''} — do you qualify?`,
      detail: naics ? `Size standard: ${sizeStandardFor(naics)}. You must meet the set-aside AND be under this size to win.` : 'You must meet this set-aside designation to be eligible.',
      source: pursuit.set_aside.match(/FAR\s*[\d.]+/)?.[0],
    });
  }

  // 2. Deadline gate — concrete date.
  if (pursuit?.response_deadline) {
    const due = new Date(pursuit.response_deadline);
    const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
    gates.push({
      id: 'deadline',
      question: `Offers are due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${days >= 0 ? ` (${days} days out)` : ' (PASSED)'} — can you submit a quality response in time?`,
      detail: days < 0 ? 'This deadline has passed — verify on SAM.gov before investing effort.' : days <= 7 ? 'Tight turnaround — be realistic about a quality submission.' : 'Confirm your team has capacity for this window.',
    });
  }

  // 3-N. Derive the rest from the solicitation text (licenses, past-perf, bonding).
  const { data: doc } = await sb.from('pursuit_documents')
    .select('extracted_text').eq('pipeline_id', pipelineId).eq('doc_kind', 'solicitation')
    .not('extracted_text', 'is', null).maybeSingle();
  if (doc?.extracted_text) {
    try {
      const { text } = await callLLM({
        system: DERIVE_PROMPT,
        user: doc.extracted_text.slice(0, 40000),
        json: true, maxTokens: 1200, temperature: 0.1,
        job: 'extraction',
      });
      const parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, '').trim());
      for (const g of (parsed.gates || []).slice(0, 6)) {
        if (g.question) gates.push({ id: `derived_${gates.length}`, question: g.question, detail: g.detail || '', source: g.source });
      }
    } catch { /* fall through with the structural gates */ }
  }

  // Always-applicable fallback if we derived nothing useful.
  if (gates.length < 2) {
    gates.push({ id: 'capability', question: 'Can you (or your team) actually perform this scope of work?', detail: 'If this is outside your core capability and you have no teaming partner, reconsider.' });
  }

  return NextResponse.json({ success: true, gates, pursuit: { title: pursuit?.title, set_aside: pursuit?.set_aside } });
}
