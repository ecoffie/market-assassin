/**
 * Proposal Wizard — staged proposal preparation.
 *
 * GET ?email=&pipeline_id=&stage=brief
 *   Returns the cached artifact for that stage if it exists, else null.
 *   Lets the UI hydrate without forcing a fresh LLM call on every mount.
 *
 * POST ?email=&pipeline_id=&stage=brief
 *   Generates the stage's artifact via the LLM, stores it in
 *   user_generated_archive, and returns it. Pass `force: true` in the
 *   body to regenerate even if a cached version exists.
 *
 * Stage 1 — brief
 *   Produces a structured RFP brief:
 *     summary       — 2-3 sentence plain-English description
 *     what_they_want — bullet list of the actual buy/scope
 *     hard_parts    — what makes this RFP risky or tricky to bid
 *     required      — show-stoppers (cert, NAICS, past perf, etc.)
 *     deadlines     — key dates extracted from the doc
 *     next_action   — 1 concrete next thing the user should do
 *
 * Future stages will land at ?stage=compliance | themes | outline
 * and follow the same pattern.
 *
 * Built 2026-05-31 to replace the static Risk/Win-Theme/Compliance
 * cards in Proposal Assist with pursuit-specific output.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { archiveContent, type ArchiveContentType } from '@/lib/archive/persist';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

// RFP text we feed the model. Brief generation needs less context than
// full drafting — 30K chars is roughly 5-8 pages and plenty for the
// model to identify scope + show-stoppers.
const MAX_INPUT_CHARS = 30_000;

type WizardStage = 'brief' | 'compliance' | 'themes' | 'outline';
const VALID_STAGES: WizardStage[] = ['brief', 'compliance', 'themes', 'outline'];

// Maps the wizard stage to a content_type stored in the archive so
// future fetches find the right row.
function archiveType(stage: WizardStage): ArchiveContentType {
  return `proposal_wizard_${stage}` as ArchiveContentType;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

interface PipelineRow {
  id: string;
  user_email: string;
  title: string;
  agency: string | null;
  notice_id: string | null;
  naics_code: string | null;
  set_aside: string | null;
  response_deadline: string | null;
  docs_status: string | null;
  docs_count: number | null;
}

interface PursuitDocRow {
  id: string;
  filename: string | null;
  extracted_text: string | null;
  notice_type: string | null;
}

interface BriefArtifact {
  stage: 'brief';
  generated_at: string;
  ai_model: string;
  pursuit_id: string;
  summary: string;
  what_they_want: string[];
  hard_parts: string[];
  required: string[];
  deadlines: string[];
  next_action: string;
}

async function loadPipeline(pipelineId: string, email: string): Promise<PipelineRow | null> {
  const { data } = await getSupabase()
    .from('user_pipeline')
    .select('id, user_email, title, agency, notice_id, naics_code, set_aside, response_deadline, docs_status, docs_count')
    .eq('id', pipelineId)
    .single();
  if (!data) return null;
  // Pipeline rows are user-scoped — block cross-user reads even with
  // service role (RLS equivalent).
  if (data.user_email?.toLowerCase() !== email.toLowerCase()) return null;
  return data as PipelineRow;
}

async function loadPursuitDocs(pipelineId: string): Promise<PursuitDocRow[]> {
  const { data } = await getSupabase()
    .from('pursuit_documents')
    .select('id, filename, extracted_text, notice_type')
    .eq('pipeline_id', pipelineId);
  return (data || []) as PursuitDocRow[];
}

async function loadCached(email: string, pipelineId: string, stage: WizardStage): Promise<BriefArtifact | null> {
  // Get the newest archived entry for this pursuit + stage. Older
  // versions stay in the archive (user history); we just return the
  // most recent so re-renders are deterministic.
  const { data } = await getSupabase()
    .from('user_generated_archive')
    .select('content, created_at')
    .eq('user_email', email.toLowerCase())
    .eq('pursuit_id', pipelineId)
    .eq('content_type', archiveType(stage))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.content) return null;
  return data.content as BriefArtifact;
}

function joinPursuitText(docs: PursuitDocRow[]): string {
  const chunks: string[] = [];
  let total = 0;
  for (const d of docs) {
    const t = (d.extracted_text || '').trim();
    if (!t) continue;
    const header = d.filename ? `=== ${d.filename} ===\n` : '';
    const block = header + t;
    if (total + block.length > MAX_INPUT_CHARS) {
      // Take what fits then stop — we'd rather have a clean cut than
      // a half-truncated trailing doc.
      chunks.push(block.slice(0, MAX_INPUT_CHARS - total));
      break;
    }
    chunks.push(block);
    total += block.length;
  }
  return chunks.join('\n\n');
}

const BRIEF_SYSTEM_PROMPT = `You are a senior federal capture analyst reading a brand new RFP for a small business contractor. Your job is to extract a structured, actionable brief in JSON — NOT to write proposal prose, NOT to summarize the whole document, NOT to invent details.

Rules:
- Respond with a JSON object ONLY. No prose, no markdown, no commentary.
- Shape: { "summary": string, "what_they_want": string[], "hard_parts": string[], "required": string[], "deadlines": string[], "next_action": string }
- summary: 2-3 sentences. Plain English. Tell the user what this acquisition IS in language a non-government person would understand.
- what_they_want: 3-6 short bullets describing the actual scope. Avoid government jargon ("the agency seeks"). Use plain verbs ("they want a contractor to install X").
- hard_parts: 2-5 things that make this RFP HARD or RISKY to bid. Specific to THIS RFP. Examples: short turnaround, unusual cert, single-award IDIQ, brand-name-or-equal, no past-performance threshold, etc.
- required: 2-6 disqualifying requirements (cert, set-aside, NAICS, FAR clauses, past performance volume). The "if you don't have X, don't bid" list.
- deadlines: every date that appears with its label, in the format "YYYY-MM-DD — what it is". 1-5 entries.
- next_action: ONE sentence telling the user the single most important next thing to do. Not "read the RFP carefully" — something concrete like "Submit questions before YYYY-MM-DD" or "Verify your DUNS/UEI is active in SAM" or "Schedule the site visit on YYYY-MM-DD".
- Reference real text from the RFP — agency name, scope keywords, dollar values, NAICS, specific FAR clauses. If a field genuinely has nothing to say, return an empty array.
- DO NOT invent values that aren't in the source text.
- DO NOT write proposal prose. This is a READING brief, not a writing draft.`;

function buildUserPrompt(pipeline: PipelineRow, docText: string, hasDocs: boolean): string {
  const metaLines: string[] = [];
  if (pipeline.title) metaLines.push(`Pursuit title: ${pipeline.title}`);
  if (pipeline.agency) metaLines.push(`Agency: ${pipeline.agency}`);
  if (pipeline.naics_code) metaLines.push(`NAICS: ${pipeline.naics_code}`);
  if (pipeline.set_aside) metaLines.push(`Set-aside: ${pipeline.set_aside}`);
  if (pipeline.response_deadline) metaLines.push(`Response deadline: ${pipeline.response_deadline}`);
  if (pipeline.notice_id) metaLines.push(`Notice ID: ${pipeline.notice_id}`);
  const meta = metaLines.length ? `Pursuit metadata:\n${metaLines.join('\n')}\n\n` : '';

  if (!hasDocs) {
    // Metadata-only path: tell the model honestly that no document
    // was attached and to brief on what little we have.
    return `${meta}This pursuit has NO RFP document attached. Brief the user on what little is known from the metadata above, and put a clear "next_action" telling them to upload the RFP for a better brief. Be honest about the absence — don't invent scope.

JSON only.`;
  }

  return `${meta}RFP source text (truncated to first ${docText.length} chars):
${docText}

JSON only.`;
}

async function callGroq(systemPrompt: string, userPrompt: string): Promise<{ content: string; tokens: number | null }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,  // factual extraction — keep variance low
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '(no body)');
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    tokens: data?.usage?.total_tokens ?? null,
  };
}

function coerceStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(x => typeof x === 'string')
    .map(x => (x as string).trim())
    .filter(x => x.length > 0)
    .slice(0, max);
}

function normalizeBrief(raw: unknown, pursuitId: string): BriefArtifact {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    stage: 'brief',
    generated_at: new Date().toISOString(),
    ai_model: GROQ_MODEL,
    pursuit_id: pursuitId,
    summary: typeof r.summary === 'string' ? r.summary.slice(0, 1000) : '',
    what_they_want: coerceStringArray(r.what_they_want, 8),
    hard_parts: coerceStringArray(r.hard_parts, 8),
    required: coerceStringArray(r.required, 8),
    deadlines: coerceStringArray(r.deadlines, 8),
    next_action: typeof r.next_action === 'string' ? r.next_action.slice(0, 500) : '',
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function generateBrief(email: string, pipeline: PipelineRow, docs: PursuitDocRow[]): Promise<BriefArtifact> {
  const docText = joinPursuitText(docs);
  const hasDocs = docText.length > 200;
  const userPrompt = buildUserPrompt(pipeline, docText, hasDocs);

  const { content, tokens } = await callGroq(BRIEF_SYSTEM_PROMPT, userPrompt);
  const parsed = safeParseJSON<Record<string, unknown>>(content, {
    fallback: {},
    source: 'proposal.wizard.brief',
  });
  const artifact = normalizeBrief(parsed, pipeline.id);

  // Archive so subsequent GETs return without re-running the LLM.
  // Non-blocking — if it fails we still return the artifact.
  await archiveContent({
    userEmail: email,
    contentType: archiveType('brief'),
    contentSubtype: 'rfp_brief',
    title: `RFP Brief — ${pipeline.title?.slice(0, 80) || 'Untitled'}`,
    content: artifact as unknown as Record<string, unknown>,
    contentText: [
      artifact.summary,
      ...artifact.what_they_want,
      ...artifact.hard_parts,
      artifact.next_action,
    ].join('\n'),
    pursuitId: pipeline.id,
    sourceNoticeId: pipeline.notice_id || undefined,
    agency: pipeline.agency || undefined,
    naicsCode: pipeline.naics_code || undefined,
    aiProvider: 'groq',
    aiModel: GROQ_MODEL,
    tags: ['proposal-wizard', 'brief', `tokens-${tokens ?? 'unknown'}`],
  });

  return artifact;
}

// ---- GET: hydrate ---------------------------------------------------

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');
  const stageRaw = request.nextUrl.searchParams.get('stage') || 'brief';
  const stage = VALID_STAGES.includes(stageRaw as WizardStage) ? (stageRaw as WizardStage) : null;
  if (!email || !pipelineId || !stage) {
    return jsonError('email, pipeline_id, and stage are required', 400);
  }
  // Only stage=brief is implemented in this version — Stage 2-4 land
  // in subsequent commits.
  if (stage !== 'brief') {
    return jsonError(`stage '${stage}' not implemented yet`, 501);
  }

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const pipeline = await loadPipeline(pipelineId, email);
  if (!pipeline) return jsonError('pursuit not found', 404);

  const cached = await loadCached(email, pipelineId, stage);
  return NextResponse.json({
    success: true,
    pursuit: {
      id: pipeline.id,
      title: pipeline.title,
      agency: pipeline.agency,
      notice_id: pipeline.notice_id,
      naics_code: pipeline.naics_code,
      set_aside: pipeline.set_aside,
      response_deadline: pipeline.response_deadline,
      docs_status: pipeline.docs_status,
      docs_count: pipeline.docs_count,
    },
    cached: cached !== null,
    artifact: cached,
  });
}

// ---- POST: generate ------------------------------------------------

interface GenerateBody {
  force?: boolean;
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');
  const stageRaw = request.nextUrl.searchParams.get('stage') || 'brief';
  const stage = VALID_STAGES.includes(stageRaw as WizardStage) ? (stageRaw as WizardStage) : null;
  if (!email || !pipelineId || !stage) {
    return jsonError('email, pipeline_id, and stage are required', 400);
  }
  if (stage !== 'brief') {
    return jsonError(`stage '${stage}' not implemented yet`, 501);
  }

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: GenerateBody = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — defaults below.
  }

  const pipeline = await loadPipeline(pipelineId, email);
  if (!pipeline) return jsonError('pursuit not found', 404);

  // Cache hit unless force regenerate
  if (!body.force) {
    const cached = await loadCached(email, pipelineId, stage);
    if (cached) {
      return NextResponse.json({ success: true, cached: true, artifact: cached });
    }
  }

  const docs = await loadPursuitDocs(pipelineId);
  try {
    const artifact = await generateBrief(email, pipeline, docs);
    return NextResponse.json({ success: true, cached: false, artifact });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(err instanceof Error ? err : message),
      errorMessage: message,
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
      userEmail: email,
      requestPath: '/api/app/proposal/wizard',
    }).catch(() => {});
    return jsonError(`Brief generation failed: ${message}`, 500);
  }
}
