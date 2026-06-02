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
import { ensureWorkspaceMember } from '@/lib/app/workspace';
import { lookupSamOpportunityForPipeline } from '@/lib/pipeline/sam-opportunity-lookup';
import { isSamDescriptionUrl, resolveSamDescriptionUrl } from '@/lib/sam/description-text';
import { getRotatedSAMKey } from '@/lib/sam/utils';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';
import { generateAllSections } from '@/lib/proposal/draft-all';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;  // the draft stage runs the full parallel section pipeline (~30-60s)

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

// RFP text we feed the model. Brief generation needs less context than
// full drafting — 30K chars is roughly 5-8 pages and plenty for the
// model to identify scope + show-stoppers.
const MAX_INPUT_CHARS = 30_000;

// Shipped flow: brief → compliance → draft. (themes/outline were
// placeholder stages, never built — dropped in favor of going straight
// to a full drafted proposal.)
type WizardStage = 'brief' | 'compliance' | 'draft';
const VALID_STAGES: WizardStage[] = ['brief', 'compliance', 'draft'];

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

// Compliance Matrix item — one row per "shall/must/will" requirement
// pulled from the RFP. The UI renders these as a checklist the user
// can hand to a writer or sub.
//
// Field choices match how DoD/civilian proposal shops actually structure
// a compliance matrix:
//   source        — where in the RFP this came from ("Section L.3.2", "PWS para 4.1")
//   requirement   — the verbatim or near-verbatim shall/must clause
//   category      — for grouping in the UI (technical / management /
//                   past_performance / pricing / admin / other)
//   priority      — critical (no-bid if you can't meet) | important | minor
//   notes         — any 1-line guidance Mindy wants to add (e.g. "tie to
//                   Section M evaluation factor 2")
interface ComplianceItem {
  source: string;
  requirement: string;
  category: 'technical' | 'management' | 'past_performance' | 'pricing' | 'admin' | 'other';
  priority: 'critical' | 'important' | 'minor';
  notes: string;
}

interface ComplianceArtifact {
  stage: 'compliance';
  generated_at: string;
  ai_model: string;
  pursuit_id: string;
  items: ComplianceItem[];
  // Quick summary header for the UI
  total_count: number;
  critical_count: number;
  // Honest disclosure when no RFP text was available
  generated_from_metadata_only: boolean;
}

// Stage 3 — full drafted proposal. Reuses the draft-all engine
// (generateAllSections) so the wizard and the standalone "Draft Entire
// Proposal" button share one drafting pipeline. One DraftSection per
// RFP section; the panel renders these into its existing draft UI.
interface DraftSection {
  section: string;        // SectionType ('exec_summary' | 'technical' | ...)
  label: string;
  draft: string;
  wordCount: number;
  targetWords: number;
  profileGrounded: boolean;
}

interface DraftArtifact {
  stage: 'draft';
  generated_at: string;
  ai_model: string;
  pursuit_id: string;
  sections: DraftSection[];
  section_count: number;
  errors: Array<{ sectionType: string; error: string }>;
  // Honest disclosure when no RFP text was available to draft from.
  generated_from_metadata_only: boolean;
}

async function loadPipeline(pipelineId: string, email: string): Promise<PipelineRow | null> {
  const { data } = await getSupabase()
    .from('user_pipeline')
    .select('id, user_email, workspace_id, title, agency, notice_id, naics_code, set_aside, response_deadline, docs_status, docs_count')
    .eq('id', pipelineId)
    .single();
  if (!data) return null;

  // Ownership check (service-role RLS equivalent). A pursuit belongs to the
  // caller if their email matches OR it lives in their workspace. The pipeline
  // LIST endpoint (/api/pipeline) scopes the same way —
  // .or(workspace_id.eq.<ws>, user_email.eq.<email>) — so a workspace-owned
  // pursuit shows up in the picker. Matching only on user_email here meant the
  // wizard couldn't find those rows: the panel listed the pursuit but the brief
  // / docs calls 404'd with "pursuit not found".
  const normalizedEmail = email.toLowerCase();
  if (data.user_email?.toLowerCase() === normalizedEmail) {
    return data as PipelineRow;
  }
  if (data.workspace_id) {
    try {
      const { workspaceId } = await ensureWorkspaceMember(normalizedEmail);
      if (workspaceId && data.workspace_id === workspaceId) {
        return data as PipelineRow;
      }
    } catch {
      // Workspace lookup unavailable — fall through to deny.
    }
  }
  return null;
}

async function loadPursuitDocs(pipelineId: string): Promise<PursuitDocRow[]> {
  const { data } = await getSupabase()
    .from('pursuit_documents')
    .select('id, filename, extracted_text, notice_type')
    .eq('pipeline_id', pipelineId);
  return (data || []) as PursuitDocRow[];
}

type StageArtifact = BriefArtifact | ComplianceArtifact | DraftArtifact;

async function loadCached(email: string, pipelineId: string, stage: WizardStage): Promise<StageArtifact | null> {
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
  return data.content as StageArtifact;
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

// Minimum extracted-text length to consider the attachments "real
// source" rather than empty/garbage. Below this we reach for the
// cached SAM description fallback.
const MIN_SOURCE_CHARS = 200;

// Build the best-available source text for a pursuit, layered:
//   1. Attached docs (pursuit_documents extracted_text) — ALWAYS used
//      when present. This is the full RFP/SOW the user could see before.
//   2. Cached SAM description (sam_opportunities.description) — a
//      fetch-free fallback already in our 24K+ cache. Used when there
//      are no usable attachments, so a pursuit can still brief/draft
//      without anyone having run the (fragile, rate-limited) attachment
//      fetch. Many notices — especially Sources Sought / simpler RFPs —
//      carry full scope in the description.
//
// Attachments NEVER get replaced by the description; the description is
// purely additive backup for the empty case.
async function buildSourceText(
  pipeline: PipelineRow,
  docs: PursuitDocRow[],
): Promise<{ text: string; hasDocs: boolean; source: 'attachments' | 'sam_description' | 'none' }> {
  const docText = joinPursuitText(docs);
  if (docText.length >= MIN_SOURCE_CHARS) {
    return { text: docText, hasDocs: true, source: 'attachments' };
  }

  // No usable attachments — try the cached SAM description. Use the robust
  // pipeline lookup (notice_id -> solicitation_number -> exact title+agency)
  // instead of a bare notice_id match: many pursuits have a null or
  // solicitation-number-shaped notice_id, so the old `eq('notice_id', …)`
  // lookup was skipped entirely and the brief wrongly said "no details
  // available" even though SAM had a full description in our cache.
  try {
    // Cast: the helper accepts a narrow SupabaseLike shape; the wizard's
    // getSupabase() is the fully-typed client which TS can't structurally
    // match without an excessively-deep instantiation.
    const match = await lookupSamOpportunityForPipeline(
      getSupabase() as unknown as Parameters<typeof lookupSamOpportunityForPipeline>[0],
      {
        noticeId: pipeline.notice_id,
        title: pipeline.title,
        agency: pipeline.agency,
      },
    );
    let desc = (match?.description || '').trim();

    // The cached description is often a SAM noticedesc URL pointer, not the
    // actual text (the real scope lives behind that endpoint). Resolve it
    // on-demand so a pursuit with no attachments still briefs from the full
    // SAM description instead of wrongly reporting "no details available".
    if (isSamDescriptionUrl(desc)) {
      const apiKey = getRotatedSAMKey();
      const resolved = apiKey ? await resolveSamDescriptionUrl(desc, apiKey, MAX_INPUT_CHARS) : null;
      if (resolved && resolved.trim().length >= MIN_SOURCE_CHARS) {
        desc = resolved.trim();
      }
    }

    if (desc.length >= MIN_SOURCE_CHARS && !isSamDescriptionUrl(desc)) {
      const block = `=== SAM.gov solicitation description ===\n${desc.slice(0, MAX_INPUT_CHARS)}`;
      return { text: block, hasDocs: true, source: 'sam_description' };
    }
  } catch (err) {
    console.warn('[wizard] SAM description fallback lookup failed:', err);
  }

  return { text: docText, hasDocs: false, source: 'none' };
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

const VALID_CATEGORIES: ComplianceItem['category'][] = [
  'technical', 'management', 'past_performance', 'pricing', 'admin', 'other',
];
const VALID_PRIORITIES: ComplianceItem['priority'][] = ['critical', 'important', 'minor'];

function normalizeComplianceItems(raw: unknown): ComplianceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ComplianceItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const requirement = typeof e.requirement === 'string' ? e.requirement.trim() : '';
    if (!requirement) continue;
    const categoryRaw = typeof e.category === 'string' ? e.category.toLowerCase().trim() : 'other';
    const priorityRaw = typeof e.priority === 'string' ? e.priority.toLowerCase().trim() : 'important';
    items.push({
      source: typeof e.source === 'string' ? e.source.slice(0, 200) : '',
      requirement: requirement.slice(0, 1000),
      category: (VALID_CATEGORIES as string[]).includes(categoryRaw)
        ? (categoryRaw as ComplianceItem['category'])
        : 'other',
      priority: (VALID_PRIORITIES as string[]).includes(priorityRaw)
        ? (priorityRaw as ComplianceItem['priority'])
        : 'important',
      notes: typeof e.notes === 'string' ? e.notes.slice(0, 400) : '',
    });
    if (items.length >= 80) break;  // hard cap so a runaway LLM doesn't blow up the UI
  }
  return items;
}

function normalizeCompliance(
  raw: unknown,
  pursuitId: string,
  metadataOnly: boolean,
): ComplianceArtifact {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = normalizeComplianceItems(r.items);
  return {
    stage: 'compliance',
    generated_at: new Date().toISOString(),
    ai_model: GROQ_MODEL,
    pursuit_id: pursuitId,
    items,
    total_count: items.length,
    critical_count: items.filter(i => i.priority === 'critical').length,
    generated_from_metadata_only: metadataOnly,
  };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function generateBrief(email: string, pipeline: PipelineRow, docs: PursuitDocRow[]): Promise<BriefArtifact> {
  const { text: docText, hasDocs } = await buildSourceText(pipeline, docs);
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

const COMPLIANCE_SYSTEM_PROMPT = `You are a senior federal proposal compliance specialist. Your job is to read an RFP and extract EVERY "shall / must / will / required / is required to" clause into a structured compliance matrix the proposal team can use as a checklist.

Rules:
- Respond with a JSON object ONLY. No prose, no markdown, no commentary.
- Shape: { "items": Array<{ "source": string, "requirement": string, "category": string, "priority": string, "notes": string }> }
- Extract every distinct requirement. Aim for 15-40 items on a typical RFP. Do NOT cap yourself if the RFP genuinely has more.
- source: Where in the RFP this came from. Use the section reference verbatim ("Section L.3.2", "PWS para 4.1.2", "Section M, factor 2", "FAR 52.204-24"). If the source is unclear, write "Unspecified".
- requirement: The actual shall/must/will/required clause, paraphrased to 1-2 short sentences. Preserve the binding verb ("shall provide", "must hold").
- category: one of "technical" | "management" | "past_performance" | "pricing" | "admin" | "other". Use:
  - technical = scope, performance specs, deliverables, technical approach requirements
  - management = staffing, org chart, key personnel, transition plans, schedule
  - past_performance = past perf citations, references, CPARS, similar contracts
  - pricing = cost volume, CLIN structure, ceiling, fixed-fee, labor categories
  - admin = page limits, font, file format, submission method, registration (SAM/UEI), section L mechanics
  - other = anything that doesn't fit above
- priority: one of "critical" | "important" | "minor". Use:
  - critical = miss this and the proposal is non-responsive / rejected (e.g. wrong file format, missing required section, no required cert)
  - important = significant scoring impact or evaluation factor
  - minor = cosmetic / nice-to-have / formatting nit
- notes: ONE optional line tying the requirement to its evaluation context (e.g. "scored under Factor 2 — Technical Approach", "submit via PIEE only — no email"). Empty string if no useful note.
- Reference actual text. Do NOT invent FAR clauses, section numbers, or page limits that aren't in the source.
- If the document is a Sources Sought / RFI rather than a full RFP, the matrix will be short. Capture what's there (response format, submission method, page limits, capability statement requirements) and don't pad.
- If there is NO source text and only metadata, return { "items": [] } and let the UI tell the user to upload the RFP.`;

function buildComplianceUserPrompt(pipeline: PipelineRow, docText: string, hasDocs: boolean): string {
  const metaLines: string[] = [];
  if (pipeline.title) metaLines.push(`Pursuit title: ${pipeline.title}`);
  if (pipeline.agency) metaLines.push(`Agency: ${pipeline.agency}`);
  if (pipeline.naics_code) metaLines.push(`NAICS: ${pipeline.naics_code}`);
  if (pipeline.set_aside) metaLines.push(`Set-aside: ${pipeline.set_aside}`);
  if (pipeline.notice_id) metaLines.push(`Notice ID: ${pipeline.notice_id}`);
  const meta = metaLines.length ? `Pursuit metadata:\n${metaLines.join('\n')}\n\n` : '';

  if (!hasDocs) {
    return `${meta}This pursuit has NO RFP document attached. Return { "items": [] }. JSON only.`;
  }
  return `${meta}RFP source text (truncated to first ${docText.length} chars):
${docText}

Extract every shall/must/will/required clause into the compliance matrix. JSON only.`;
}

async function generateCompliance(
  email: string,
  pipeline: PipelineRow,
  docs: PursuitDocRow[],
): Promise<ComplianceArtifact> {
  const { text: docText, hasDocs } = await buildSourceText(pipeline, docs);
  const userPrompt = buildComplianceUserPrompt(pipeline, docText, hasDocs);

  const { content, tokens } = await callGroq(COMPLIANCE_SYSTEM_PROMPT, userPrompt);
  const parsed = safeParseJSON<Record<string, unknown>>(content, {
    fallback: { items: [] },
    source: 'proposal.wizard.compliance',
  });
  const artifact = normalizeCompliance(parsed, pipeline.id, !hasDocs);

  await archiveContent({
    userEmail: email,
    contentType: archiveType('compliance'),
    contentSubtype: 'compliance_matrix',
    title: `Compliance Matrix — ${pipeline.title?.slice(0, 80) || 'Untitled'}`,
    content: artifact as unknown as Record<string, unknown>,
    contentText: artifact.items.map(i => `[${i.priority}] ${i.source}: ${i.requirement}`).join('\n'),
    pursuitId: pipeline.id,
    sourceNoticeId: pipeline.notice_id || undefined,
    agency: pipeline.agency || undefined,
    naicsCode: pipeline.naics_code || undefined,
    aiProvider: 'groq',
    aiModel: GROQ_MODEL,
    tags: ['proposal-wizard', 'compliance', `tokens-${tokens ?? 'unknown'}`, `items-${artifact.total_count}`],
  });

  return artifact;
}

// Stage 3 — draft the full proposal. Reuses the draft-all engine
// (generateAllSections) so the wizard shares the exact drafting pipeline
// as the standalone "Draft Entire Proposal" button — one engine, two
// entry points. Source text comes from the pursuit's attached docs.
async function generateDraft(
  email: string,
  pipeline: PipelineRow,
  docs: PursuitDocRow[],
): Promise<DraftArtifact> {
  const { text: sourceText, hasDocs, source } = await buildSourceText(pipeline, docs);
  const fileName = docs.find(d => d.filename)?.filename
    || (source === 'sam_description' ? `${pipeline.title || 'pursuit'} (SAM description)` : pipeline.title || 'pursuit RFP');

  // No RFP text → return an honest empty artifact instead of letting the
  // model invent a whole proposal from a one-line title. The panel shows
  // an "upload the RFP to draft" nudge in this case.
  if (!hasDocs) {
    const empty: DraftArtifact = {
      stage: 'draft',
      generated_at: new Date().toISOString(),
      ai_model: GROQ_MODEL,
      pursuit_id: pipeline.id,
      sections: [],
      section_count: 0,
      errors: [],
      generated_from_metadata_only: true,
    };
    return empty;
  }

  const result = await generateAllSections({
    email,
    sourceText,
    fileName,
    rfpAgency: pipeline.agency,
    // sectionTypes omitted → draft-all defaults to the 5 RFP sections.
  });

  const sections: DraftSection[] = result.sections.map(s => ({
    section: s.section,
    label: s.label,
    draft: s.draft,
    wordCount: s.wordCount,
    targetWords: s.targetWords,
    profileGrounded: s.meta.profileGrounded,
  }));

  const artifact: DraftArtifact = {
    stage: 'draft',
    generated_at: new Date().toISOString(),
    ai_model: GROQ_MODEL,
    pursuit_id: pipeline.id,
    sections,
    section_count: sections.length,
    errors: result.errors.map(e => ({ sectionType: e.sectionType, error: e.error })),
    generated_from_metadata_only: false,
  };

  // generateAllSections already auto-archives each section individually
  // (proposal_section / cap_statement). We ALSO archive the wizard-draft
  // bundle so loadCached('draft') can hydrate the whole set on revisit.
  await archiveContent({
    userEmail: email,
    contentType: archiveType('draft'),
    contentSubtype: 'proposal_draft',
    title: `Proposal Draft — ${pipeline.title?.slice(0, 80) || 'Untitled'}`,
    content: artifact as unknown as Record<string, unknown>,
    contentText: sections.map(s => `## ${s.label}\n${s.draft}`).join('\n\n'),
    pursuitId: pipeline.id,
    sourceNoticeId: pipeline.notice_id || undefined,
    agency: pipeline.agency || undefined,
    naicsCode: pipeline.naics_code || undefined,
    aiProvider: 'groq',
    aiModel: GROQ_MODEL,
    tags: ['proposal-wizard', 'draft', `sections-${sections.length}`],
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
    let artifact: StageArtifact;
    if (stage === 'brief') {
      artifact = await generateBrief(email, pipeline, docs);
    } else if (stage === 'compliance') {
      artifact = await generateCompliance(email, pipeline, docs);
    } else {
      artifact = await generateDraft(email, pipeline, docs);
    }
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
      requestPath: `/api/app/proposal/wizard?stage=${stage}`,
    }).catch(() => {});
    return jsonError(`${stage} generation failed: ${message}`, 500);
  }
}
