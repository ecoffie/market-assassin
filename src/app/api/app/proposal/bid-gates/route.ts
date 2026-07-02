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

const DERIVE_PROMPT = `You are reading a federal solicitation to find the GO/NO-GO eliminators that would actually DISQUALIFY a typical small-business bidder — the things where a "No" is both LIKELY and FATAL. Extract ONLY concrete, opportunity-specific eliminators that genuinely separate qualified from unqualified bidders:
- Required SPECIALTY licenses / certifications a bidder might NOT have (e.g. specific state electrical license, security clearance, ISO cert) — NOT generic ones.
- Minimum past-performance with real thresholds (e.g. "3 similar projects over $1M in the last 5 years" — quote the real numbers).
- BONDING that requires real capacity (bid bond %, payment/performance bonds on large-dollar work) — bonding capacity genuinely eliminates undercapitalized bidders.
- Mandatory site visit a bidder must attend to be eligible.
- Key personnel minimums (e.g. "PM with 10 years + PE license").

ALSO flag these high-stakes PREREQUISITES — you must ALREADY HOLD them to bid, and many don't:
- CMMC certification (Cybersecurity Maturity Model Certification) at the required level — a hard gate for DoD work touching CUI.
- Contract VEHICLE requirements: must you already hold a GSA Schedule / MAS, a specific IDIQ, GWAC, MAC, BPA, SEWP, OASIS, 8(a) STARS, etc.? If the work is a task order OFF an existing vehicle, only current holders can bid.
- Active facility/personnel SECURITY CLEARANCE at a required level.
- A specific SIN (Special Item Number) under a Schedule.

DO NOT include near-universal requirements that almost everyone already satisfies — these are NOT eliminators, skip them entirely:
- SAM.gov / SAM registration (everyone bidding is registered)
- Being a small business / meeting the size standard (already handled separately)
- Generic "submit a complete proposal" / "acknowledge amendments" / standard FAR reps & certs
- General/commercial liability insurance at ORDINARY amounts (e.g. $100K–$2M per occurrence) — Eric's rule: "you won't be bidding if you didn't already have it." It is NOT a differentiator. ONLY surface insurance if it is a SPECIALTY type many lack (pollution/environmental, professional/E&O for A-E, marine, aviation) OR an unusually high amount (>$5M) that signals real risk capacity.
- Standard wage determinations / SCA / Davis-Bacon compliance (applies to everyone on that work)

Return ONLY JSON: {"gates":[{"question":"a yes/no question phrased for the bidder","detail":"the specific requirement, with real numbers/names from the text","source":"the clause or section if visible"}]}
If nothing rises to a real eliminator, return {"gates":[]}. Quote REAL specifics — never generic placeholders. Aim for 2-4 high-signal gates, not a long checklist.`;

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

  // 1. Set-aside gate — ONLY for SPECIALIZED set-asides many don't qualify for
  // (SDVOSB/8(a)/WOSB/HUBZone/etc). A plain "Total Small Business" set-aside is
  // NOT a real eliminator (Eric: most are small businesses) — skip it.
  const sa = pursuit?.set_aside || '';
  const specialized = /sdvosb|service[ -]?disabled|8\(a\)|\bwosb\b|women[ -]?owned|hubzone|edwosb|veteran[ -]?owned|\bvosb\b|tribal|native|disadvantaged/i.test(sa);
  if (specialized) {
    gates.push({
      id: 'set_aside',
      question: `This is a ${sa} set-aside — are you certified for it?`,
      detail: 'You must hold the active certification to win. If you’re not certified, you can only bid as a subcontractor.',
      source: sa.match(/FAR\s*[\d.]+/)?.[0],
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
        // reasoning chain (Eric: Groq let "liability insurance" noise through,
        // Claude isn't scalable at $149). Low volume (per proposal) + high stakes
        // (gates whether the user responds at all) → opt up to gpt-4o; Groq stays
        // the cheap fallback.
        job: 'reasoning',
        openaiModel: 'gpt-4o',
      });
      const parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, '').trim());
      // Drop near-universal items that slip through — they're not eliminators
      // (Eric: most are SAM-registered + small businesses).
      const UNIVERSAL = /\bsam\b|sam\.gov|registration|registered|system for award|small[ -]?business[ -]?(size|status|concern)|size[ -]?standard|acknowledge[ -]?(all[ -]?)?amendments|complete[ -]?proposal|reps?[ -]?(and|&)[ -]?certs?/i;
      // Ordinary liability insurance is noise (Eric: "you won't be bidding if you
      // didn't have it"). Drop generic insurance gates UNLESS they name a
      // specialty type or a >$5M amount.
      const isOrdinaryInsurance = (g: { question?: string; detail?: string }) => {
        const hay = `${g.question || ''} ${g.detail || ''}`.toLowerCase();
        if (!/insurance|liability/.test(hay)) return false;
        const specialty = /pollution|environmental|professional|e&o|errors? and omissions|marine|aviation|cyber/.test(hay);
        const bigAmount = /\$\s?([5-9]|[1-9]\d)[\d,]*\s?(million|m\b)|\$\s?[5-9][,\d]{6,}/.test(hay);
        return !specialty && !bigAmount;
      };
      const derived = (parsed.gates || [])
        .filter((g: { question?: string; detail?: string }) => g.question && !UNIVERSAL.test(`${g.question} ${g.detail || ''}`) && !isOrdinaryInsurance(g));
      // Order by what's most DISTINCT + eliminating (Eric). Vehicle/CMMC/clearance
      // prerequisites FIRST — if you don't hold the vehicle, nothing else matters
      // — then past performance, then bonding/financial, then licenses/personnel.
      const rank = (q: string) =>
        /cmmc|gsa[ -]?schedule|\bmas\b|\bidiq\b|\bgwac\b|\bmacc?\b|\bbpa\b|\bsewp\b|oasis|stars|schedule[ -]?holder|vehicle|\bsin\b|clearance|cleared/i.test(q) ? 0
        : /past perform|experience|similar|project|reference/i.test(q) ? 1
        : /bond|surety|financial|insurance/i.test(q) ? 2
        : /licens|certif|key personnel|project manager|years? of/i.test(q) ? 3
        : 4;
      derived.sort((a: { question: string }, b: { question: string }) => rank(a.question) - rank(b.question));
      for (const g of derived.slice(0, 5)) {
        gates.push({ id: `derived_${gates.length}`, question: g.question, detail: g.detail || '', source: g.source });
      }
    } catch { /* fall through with the structural gates */ }
  }

  // Always-applicable fallback if we derived nothing useful.
  if (gates.length < 2) {
    gates.push({ id: 'capability', question: 'Can you (or your team) actually perform this scope of work?', detail: 'If this is outside your core capability and you have no teaming partner, reconsider.' });
  }

  return NextResponse.json({ success: true, gates, pursuit: { title: pursuit?.title, set_aside: pursuit?.set_aside } });
}

// Persist the bid / no-bid decision on the pursuit so it survives + is
// workspace-visible (the decision used to vanish — the gate just opened the next
// step). A 'skip' also flips the pursuit to the no_bid stage.
export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { pipeline_id?: string; decision?: string; score?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const pipelineId = body.pipeline_id;
  const decision = body.decision;
  if (!pipelineId) return NextResponse.json({ success: false, error: 'pipeline_id required' }, { status: 400 });
  if (!decision || !['pursue', 'watch', 'skip'].includes(decision)) {
    return NextResponse.json({ success: false, error: "decision must be pursue | watch | skip" }, { status: 400 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // Authorize: the pursuit must belong to the caller or their workspace.
  const { data: pursuit } = await sb.from('user_pipeline').select('id, user_email, workspace_id').eq('id', pipelineId).maybeSingle();
  if (!pursuit) return NextResponse.json({ success: false, error: 'Pursuit not found' }, { status: 404 });
  const owns = pursuit.user_email?.toLowerCase() === email!.toLowerCase();
  if (!owns) {
    // workspace fallback
    try {
      const { resolveActiveWorkspace } = await import('@/lib/app/workspace');
      const { workspaceId } = await resolveActiveWorkspace(email!.toLowerCase(), request);
      if (!workspaceId || pursuit.workspace_id !== workspaceId) return NextResponse.json({ success: false, error: 'Not your pursuit' }, { status: 403 });
    } catch {
      return NextResponse.json({ success: false, error: 'Not your pursuit' }, { status: 403 });
    }
  }

  const update: Record<string, unknown> = {
    bid_decision: decision,
    bid_score: typeof body.score === 'number' ? Math.round(body.score) : null,
    bid_decided_at: new Date().toISOString(),
    bid_decided_by: email,
    updated_at: new Date().toISOString(),
  };
  // A 'skip' = no-bid → reflect it in the pipeline stage too.
  if (decision === 'skip') update.stage = 'no_bid';

  const { error } = await sb.from('user_pipeline').update(update).eq('id', pipelineId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
