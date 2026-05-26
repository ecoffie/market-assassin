import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import { retrieveRagContext, formatChunksForPrompt } from '@/lib/rag/retrieve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

const MAX_INPUT_CHARS = 40000; // a bit lower than compliance to leave room for output

// RFP section types — for traditional proposal responses
type RfpSectionType = 'exec_summary' | 'technical' | 'management' | 'past_performance' | 'pricing';
// Capability-statement section types — for Sources Sought / RFI responses
type CapStatementSectionType = 'company_overview' | 'cap_past_performance' | 'capabilities' | 'differentiators' | 'poc';
type SectionType = RfpSectionType | CapStatementSectionType;

const SECTION_PROMPTS: Record<SectionType, { label: string; prompt: string; targetWords: number }> = {
  // ---- RFP sections (existing) ----
  exec_summary: {
    label: 'Executive Summary',
    targetWords: 350,
    prompt: `Draft an Executive Summary section. Lead with the bidder's understanding of the agency mission and the specific problem this solicitation addresses. State the core value proposition in plain language, name the team and key differentiators, and close with a one-sentence commitment to the customer's outcome. No marketing fluff. Target ~350 words.`,
  },
  technical: {
    label: 'Technical Approach',
    targetWords: 600,
    prompt: `Draft a Technical Approach outline. Map your method to each technical requirement in the solicitation. Lead with the work breakdown, then approach by major task area, then risk reduction, then schedule. Where the RFP names a method or standard (Agile, Earned Value, ISO, NIST, FedRAMP, etc.) reference it explicitly. Mark anything that requires customer clarification with [CONFIRM]. Target ~600 words, use clear section headings.`,
  },
  management: {
    label: 'Management Plan',
    targetWords: 450,
    prompt: `Draft a Management Plan section. Cover: program management structure, key personnel and roles, transition / startup approach, quality control, communication cadence with the customer, and risk / issue management. Highlight any required staffing certifications or clearances. Target ~450 words.`,
  },
  past_performance: {
    label: 'Past Performance',
    targetWords: 400,
    prompt: `Draft a Past Performance narrative framework. Open with how the bidder's past work is relevant to this scope, then list 3 representative contract examples as placeholders with bracketed fields ([Contract title], [Agency], [Period], [Value], [Role: prime/sub], [Relevance]). End with a "Why this past performance matters" paragraph tying themes to the evaluation factors. Target ~400 words. Use bracketed placeholders the bidder will fill in — do not invent specific past contracts.`,
  },
  pricing: {
    label: 'Pricing Narrative',
    targetWords: 300,
    prompt: `Draft a Pricing Narrative (the cover-letter style story, not a cost table). Cover: pricing approach (FFP, T&M, hybrid), basis of estimate, how labor categories were chosen, assumptions and exclusions, and value tradeoff vs. risk. Do not invent dollar figures — use [TBD] or [INSERT RATE] placeholders. Target ~300 words.`,
  },
  // ---- Capability Statement sections (Sources Sought / RFI responses) ----
  // Added 2026-05-26 after Eric flagged 'proposal assist is working but it
  // is still saying RFP things'. SS/RFI responses are 2-3 page capability
  // statements, not multi-volume proposals. Different prompt structure,
  // tighter word counts.
  company_overview: {
    label: 'Company Overview',
    targetWords: 150,
    prompt: `Draft a Company Overview block for a Capability Statement (Sources Sought / RFI response). Two paragraphs max. Lead with what the company does + business type / certifications (SDVOSB, 8(a), WOSB, HUBZone, Small Business). Include UEI, CAGE, NAICS codes worked, primary geographic capability. End with 1 sentence on why this agency's mission aligns with the company's specialty. Be concise — capability statements are scanned in 30 seconds. Target ~150 words. Use bracketed [placeholders] for facts not in the profile (UEI, CAGE, founding year).`,
  },
  cap_past_performance: {
    label: 'Relevant Past Performance',
    targetWords: 300,
    prompt: `Draft a Relevant Past Performance section for a Capability Statement (Sources Sought / RFI response). NOT the full past-performance narrative of an RFP — this is a scannable table-style list of 3-5 directly relevant contracts. Format each as: '**[Contract Title]** — [Agency], [Period], [Value], [Prime/Sub]. [One-line scope description tying to this Sources Sought scope].' Pick contracts that match the work described in the source document. Use bracketed placeholders for specifics — do not invent. End with one sentence summarizing the pattern of relevance. Target ~300 words.`,
  },
  capabilities: {
    label: 'Capabilities',
    targetWords: 250,
    prompt: `Draft a Capabilities section for a Capability Statement (Sources Sought / RFI response). Bullet list of 6-10 core capabilities the company offers, scoped to what the source document is asking about. Each bullet: 1-2 lines max, capability + brief evidence (e.g. tools used, methodologies, certifications). Mirror language from the source document where possible so the keyword scan picks up matches. Avoid generic words like 'world-class' or 'best-in-class'. Target ~250 words.`,
  },
  differentiators: {
    label: 'Differentiators',
    targetWords: 200,
    prompt: `Draft a Differentiators section for a Capability Statement (Sources Sought / RFI response). 3-5 short bullets explaining what makes this company a better fit than typical competitors for the agency's described need. Anchor each in concrete evidence: years of experience in this specific scope, agency-specific past performance, proprietary methods, certifications competitors lack, geographic advantage, etc. No marketing fluff. Target ~200 words.`,
  },
  poc: {
    label: 'Point of Contact',
    targetWords: 80,
    prompt: `Draft a Point of Contact block for a Capability Statement. Single block at the bottom. Format:\n\n[Full Name], [Title]\n[Company Name]\n[Phone] · [Email]\n[Website]\n\nUEI: [UEI]\nCAGE: [CAGE]\nNAICS: [primary NAICS codes from profile]\n\nUse bracketed placeholders for fields not in the saved profile. No prose — this is a contact card, not a paragraph. Target ~80 words.`,
  },
};

interface RequestBody {
  text?: string;
  fileName?: string;
  sectionType?: SectionType;
}

interface UserProfile {
  companyName?: string;
  businessType?: string;
  naicsCodes?: string[];
  agencies?: string[];
  setAsides?: string[];
  certifications?: string[];
  locationStates?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

async function loadUserProfile(email: string): Promise<UserProfile> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, business_type, company_name, agencies, set_aside_preferences, location_states')
      .eq('user_email', email)
      .maybeSingle();

    if (!data) return {};
    return {
      companyName: data.company_name || undefined,
      businessType: data.business_type || undefined,
      naicsCodes: Array.isArray(data.naics_codes) ? data.naics_codes : [],
      agencies: Array.isArray(data.agencies) ? data.agencies : [],
      setAsides: Array.isArray(data.set_aside_preferences) ? data.set_aside_preferences : [],
      locationStates: Array.isArray(data.location_states) ? data.location_states : [],
    };
  } catch (err) {
    console.error('[proposal/draft] profile lookup failed:', err);
    return {};
  }
}

function buildProfileBlock(profile: UserProfile): string {
  const parts: string[] = [];
  if (profile.companyName) parts.push(`Company: ${profile.companyName}`);
  if (profile.businessType) parts.push(`Business type: ${profile.businessType}`);
  if (profile.naicsCodes?.length) parts.push(`NAICS: ${profile.naicsCodes.slice(0, 8).join(', ')}`);
  if (profile.setAsides?.length) parts.push(`Set-aside certs: ${profile.setAsides.join(', ')}`);
  if (profile.agencies?.length) parts.push(`Target agencies: ${profile.agencies.slice(0, 6).join(', ')}`);
  if (profile.locationStates?.length) parts.push(`Locations: ${profile.locationStates.join(', ')}`);
  return parts.length > 0 ? parts.join('\n') : 'No saved profile — write generically with [Company name] placeholders.';
}

// ---- Vault context loader -------------------------------------------
//
// Pulls the rows the AI needs to write THIS specific section. Loading
// only what's relevant keeps the prompt small + focused. E.g. drafting
// the Capabilities section pulls capabilities + identity but NOT past
// performance or team bios.
//
// All vault data is treated by the AI as FACTUAL — use verbatim if
// relevant, do not paraphrase. This is the "your real data, not
// placeholders" moment.

interface VaultContext {
  identity?: Record<string, unknown> | null;
  past_performance?: Array<Record<string, unknown>>;
  capabilities?: Array<Record<string, unknown>>;
  team?: Array<Record<string, unknown>>;
  has_any: boolean;
}

async function loadVaultContext(email: string, sectionType: SectionType): Promise<VaultContext> {
  const supabase = getSupabase();
  const ctx: VaultContext = { has_any: false };

  // Sections that need each table — keeps payload tight.
  const needsIdentity = true;  // every section uses identity
  const needsPastPerf = sectionType === 'past_performance' || sectionType === 'cap_past_performance' || sectionType === 'exec_summary';
  const needsCapabilities = sectionType === 'capabilities' || sectionType === 'technical' || sectionType === 'differentiators' || sectionType === 'company_overview';
  const needsTeam = sectionType === 'management' || sectionType === 'poc';

  const queries: Promise<unknown>[] = [];
  if (needsIdentity) {
    queries.push(supabase.from('user_identity_profile').select('*').eq('user_email', email).maybeSingle());
  }
  if (needsPastPerf) {
    queries.push(supabase.from('user_past_performance')
      .select('contract_title, agency, sub_agency, contract_number, period_start, period_end, contract_value, role, scope_description, outcomes, cpars_rating, relevance_keywords, naics_codes')
      .eq('user_email', email).is('archived_at', null).limit(10));
  }
  if (needsCapabilities) {
    queries.push(supabase.from('user_capabilities_library')
      .select('capability_name, description, related_naics, evidence, tools_methods')
      .eq('user_email', email).is('archived_at', null).limit(15));
  }
  if (needsTeam) {
    queries.push(supabase.from('user_team_members')
      .select('full_name, title, security_clearance, certifications, years_experience, bio_short, role_type, is_key_personnel')
      .eq('user_email', email).is('archived_at', null).order('is_key_personnel', { ascending: false }).limit(8));
  }

  const results = await Promise.all(queries);
  let idx = 0;
  if (needsIdentity)     { ctx.identity = (results[idx++] as { data: Record<string, unknown> | null }).data; }
  if (needsPastPerf)     { ctx.past_performance = (results[idx++] as { data: Array<Record<string, unknown>> | null }).data || []; }
  if (needsCapabilities) { ctx.capabilities = (results[idx++] as { data: Array<Record<string, unknown>> | null }).data || []; }
  if (needsTeam)         { ctx.team = (results[idx++] as { data: Array<Record<string, unknown>> | null }).data || []; }

  // Identity row exists with any non-null value, OR any list has rows
  const identityHas = ctx.identity && Object.entries(ctx.identity).some(([k, v]) => k !== 'user_email' && k !== 'created_at' && k !== 'updated_at' && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  ctx.has_any = Boolean(identityHas) || (ctx.past_performance?.length ?? 0) > 0 || (ctx.capabilities?.length ?? 0) > 0 || (ctx.team?.length ?? 0) > 0;

  return ctx;
}

function formatVaultForPrompt(ctx: VaultContext): string {
  if (!ctx.has_any) return '';
  const blocks: string[] = [];

  if (ctx.identity) {
    const id = ctx.identity;
    const lines: string[] = [];
    if (id.legal_name) lines.push(`Legal name: ${id.legal_name}`);
    if (id.dba) lines.push(`DBA: ${id.dba}`);
    if (id.uei) lines.push(`UEI: ${id.uei}`);
    if (id.cage_code) lines.push(`CAGE: ${id.cage_code}`);
    if (id.ein) lines.push(`EIN: ${id.ein}`);
    if (id.year_founded) lines.push(`Founded: ${id.year_founded}`);
    if (id.employee_count) lines.push(`Employees: ${id.employee_count}`);
    if (Array.isArray(id.certifications) && id.certifications.length) lines.push(`Certifications: ${(id.certifications as string[]).join(', ')}`);
    if (Array.isArray(id.primary_naics) && id.primary_naics.length) lines.push(`Primary NAICS: ${(id.primary_naics as string[]).join(', ')}`);
    if (id.one_liner) lines.push(`One-liner: ${id.one_liner}`);
    if (id.elevator_pitch) lines.push(`Elevator pitch: ${id.elevator_pitch}`);
    if (id.hq_state || id.hq_city) lines.push(`HQ: ${[id.hq_city, id.hq_state].filter(Boolean).join(', ')}`);
    if (Array.isArray(id.service_states) && id.service_states.length) lines.push(`Service states: ${(id.service_states as string[]).join(', ')}`);
    if (Array.isArray(id.contract_vehicles) && id.contract_vehicles.length) lines.push(`Contract vehicles: ${(id.contract_vehicles as string[]).join(', ')}`);
    if (lines.length) blocks.push(`### Bidder identity (FACTUAL — use these verbatim)\n${lines.join('\n')}`);
  }

  if (ctx.past_performance && ctx.past_performance.length) {
    const lines = ctx.past_performance.map((p, i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pp = p as any;
      const parts: string[] = [];
      parts.push(`${i + 1}. **${pp.contract_title}** — ${pp.agency}`);
      if (pp.sub_agency) parts[parts.length - 1] += ` / ${pp.sub_agency}`;
      const meta: string[] = [];
      if (pp.contract_number) meta.push(`#${pp.contract_number}`);
      if (pp.period_start || pp.period_end) meta.push(`${pp.period_start || '?'} → ${pp.period_end || 'ongoing'}`);
      if (pp.contract_value) meta.push(`$${Number(pp.contract_value).toLocaleString()}`);
      if (pp.role) meta.push(pp.role);
      if (meta.length) parts.push(`   ${meta.join(' · ')}`);
      if (pp.scope_description) parts.push(`   Scope: ${pp.scope_description}`);
      if (pp.outcomes) parts.push(`   Outcomes: ${pp.outcomes}`);
      if (pp.cpars_rating) parts.push(`   CPARS: ${pp.cpars_rating}`);
      return parts.join('\n');
    }).join('\n\n');
    blocks.push(`### Bidder past performance (FACTUAL — cite these instead of [placeholders])\n${lines}`);
  }

  if (ctx.capabilities && ctx.capabilities.length) {
    const lines = ctx.capabilities.map((c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cc = c as any;
      let line = `- **${cc.capability_name}**: ${cc.description}`;
      if (cc.evidence) line += ` (${cc.evidence})`;
      return line;
    }).join('\n');
    blocks.push(`### Bidder capabilities (FACTUAL — weave into Capabilities section)\n${lines}`);
  }

  if (ctx.team && ctx.team.length) {
    const lines = ctx.team.map((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mm = m as any;
      const tags: string[] = [];
      if (mm.is_key_personnel) tags.push('KEY PERSONNEL');
      if (mm.years_experience) tags.push(`${mm.years_experience} yrs`);
      if (mm.security_clearance) tags.push(`${mm.security_clearance} cleared`);
      if (Array.isArray(mm.certifications) && mm.certifications.length) tags.push((mm.certifications as string[]).join(', '));
      const tagStr = tags.length ? ` [${tags.join(' · ')}]` : '';
      let line = `- **${mm.full_name}**, ${mm.title}${tagStr}`;
      if (mm.bio_short) line += `\n  ${mm.bio_short}`;
      return line;
    }).join('\n');
    blocks.push(`### Bidder team (FACTUAL — name these specific people)\n${lines}`);
  }

  return blocks.join('\n\n');
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
  if (!sectionType || !SECTION_PROMPTS[sectionType]) {
    return NextResponse.json(
      { success: false, error: 'sectionType must be one of: exec_summary, technical, management, past_performance, pricing, company_overview, cap_past_performance, capabilities, differentiators, poc' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'AI service not configured' }, { status: 500 });
  }

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

  // Load all the context the AI will use to draft this section.
  // Three sources, in priority order:
  //   1. Profile (NAICS / agencies / set-asides — minimal sketch)
  //   2. Vault (FACTUAL — UEI / past perf / capabilities / team)
  //   3. RAG (STYLE — chunks from Eric's teaching corpus on this topic)
  // Run in parallel; even if vault/RAG return nothing, profile still
  // works as the fallback.
  const sectionMeta = SECTION_PROMPTS[sectionType];

  // Build a RAG query from section + RFP signal. We strip down to
  // the meaningful tokens so FTS doesn't drown in filler.
  // Cap RFP excerpt at 1k chars — enough to capture the topic, not
  // enough to dominate the token budget.
  const rfpSnippet = inputText.slice(0, 1000).replace(/\s+/g, ' ');
  const ragQuery = `${sectionMeta.label} ${rfpSnippet}`;

  const [profile, vault, ragChunks] = await Promise.all([
    loadUserProfile(email),
    loadVaultContext(email, sectionType).catch((err) => {
      console.error('[proposal/draft] vault load failed:', err);
      return { has_any: false } as VaultContext;
    }),
    retrieveRagContext({
      query: ragQuery,
      // Bias toward authored content for the matching mental model.
      // Past-perf-style sections look at past_performance + proposal_template;
      // capability sections look at cap_statement + proposal_template;
      // technical/management look at course_material + webinar_resource + proposal_template.
      docTypes: (() => {
        if (sectionType === 'past_performance' || sectionType === 'cap_past_performance') return ['proposal_template', 'past_performance', 'cap_statement', 'course_material'];
        if (sectionType === 'company_overview' || sectionType === 'capabilities' || sectionType === 'differentiators' || sectionType === 'poc') return ['cap_statement', 'proposal_template', 'course_material'];
        return ['proposal_template', 'course_material', 'webinar_resource', 'teaching_handout'];
      })(),
      limit: 4,
      maxChars: 3500,
      maxPerDoc: 1,
    }).catch((err) => {
      console.error('[proposal/draft] RAG retrieval failed:', err);
      return [];
    }),
  ]);

  const profileBlock = buildProfileBlock(profile);
  const vaultBlock = formatVaultForPrompt(vault);
  const ragBlock = formatChunksForPrompt(ragChunks);

  // Capability-statement sections get a different system prompt that
  // reframes the work as a Sources Sought / RFI response, not an RFP
  // proposal. Otherwise the AI defaults to proposal-speak even when
  // the section guidance asks for capability-statement format.
  const isCapStatementSection = ['company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc'].includes(sectionType);

  // Three context tiers the AI will see, distinguished in the prompt:
  //   - Bidder profile + Vault data: FACTUAL. Use as truth. Cite verbatim.
  //   - RAG chunks from Eric Coffie's teaching library: STYLE REFERENCES.
  //     Show the AI what good GovCon writing looks like in this section.
  //     Do NOT copy verbatim — adapt the framing/vocabulary.
  //
  // System prompt is updated to teach the AI the difference so it doesn't
  // (a) ignore vault data and use [placeholders] for facts it actually has,
  // or (b) plagiarize RAG chunks.

  const systemPrompt = isCapStatementSection
    ? `You are a senior federal capture writer. Draft a SHORT capability-statement section for a Sources Sought or RFI response — NOT a proposal. Capability statements are 2-3 pages total, scanned in 30 seconds by agency staff doing market research.

How to use the context you'll receive:
- Bidder profile + vault data = FACTS about this bidder. Use them verbatim (real UEI, real past performance, real capabilities, real team). Do NOT use [placeholders] for anything the vault provides.
- Teaching examples (if present) = STYLE references from Eric Coffie's teaching library. Learn the framing + vocabulary + structure. Do NOT copy phrasing verbatim; adapt to this specific bidder + solicitation.

Rules:
- Concise prose + scannable bullets. No marketing fluff.
- Mirror language from the source notice where it shows alignment with the scope.
- Use bracketed [placeholders] ONLY for facts not in the bidder profile or vault.
- Never invent facts about the bidder beyond what is provided.
- Never use 'world-class', 'best-in-class', 'cutting-edge'.
- Do NOT use proposal section labels like 'Executive Summary' — this is a capability statement section.
- Output plain markdown only. No JSON. No commentary about what you wrote.`
    : `You are a senior federal proposal writer. Draft proposal section copy that is compliant, specific to the source solicitation, and grounded in the bidder's saved profile + vault.

How to use the context you'll receive:
- Bidder profile + vault data = FACTS about this bidder. Use them verbatim (real UEI, real past performance, real capabilities, real team). Do NOT use [placeholders] for anything the vault provides.
- Teaching examples (if present) = STYLE references from Eric Coffie's teaching library. Learn the framing + vocabulary + structure. Do NOT copy phrasing verbatim; adapt to this specific bidder + solicitation.

Rules:
- Use clear headings and short paragraphs.
- Mirror language from the solicitation where it shows the bidder understands the scope.
- Use bracketed [placeholders] ONLY for facts not in the bidder profile or vault.
- Never invent facts about the bidder beyond what is provided.
- No marketing fluff, no superlatives like "world-class" or "best-in-class".
- Output plain markdown only. No JSON. No commentary about what you wrote.`;

  // Assemble user prompt with all available context. We list profile +
  // vault first so the AI sees facts before style examples.
  const promptParts: string[] = [];
  promptParts.push(`Bidder profile (NAICS / agencies / set-asides):\n${profileBlock}`);
  if (vaultBlock) promptParts.push(vaultBlock);
  if (ragBlock) {
    promptParts.push(`### Eric Coffie teaching library — STYLE references (do NOT copy verbatim)\n${ragBlock}`);
  }
  promptParts.push(`### Section to draft: ${sectionMeta.label}\n${sectionMeta.prompt}`);
  promptParts.push(`### Solicitation: ${body.fileName || 'untitled'}\n--- SOURCE TEXT (${inputText.length.toLocaleString()} chars${wasTruncated ? ', truncated' : ''}) ---\n${inputText}`);

  const userPrompt = promptParts.join('\n\n');

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 2200,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[proposal/draft] Groq error:', response.status, errText);
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: response.status === 429 ? 'ai_rate_limit' : 'api_error',
        errorMessage: `Groq ${response.status}: ${errText.slice(0, 500)}`,
        requestPath: '/api/app/proposal/draft',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json({ success: false, error: 'AI service error. Try again.' }, { status: 500 });
    }

    const completion = await response.json();
    const draft = (completion.choices?.[0]?.message?.content || '').trim();

    if (!draft) {
      return NextResponse.json({ success: false, error: 'AI returned an empty draft. Try again.' }, { status: 500 });
    }

    const wordCount = draft.split(/\s+/).filter(Boolean).length;

    return NextResponse.json({
      success: true,
      section: sectionType,
      label: sectionMeta.label,
      draft,
      wordCount,
      targetWords: sectionMeta.targetWords,
      meta: {
        model: GROQ_MODEL,
        inputChars: inputText.length,
        truncated: wasTruncated,
        originalChars: sourceText.length,
        profileGrounded: profileBlock !== 'No saved profile — write generically with [Company name] placeholders.',
        vaultGrounded: vault.has_any,
        vaultCounts: {
          past_performance: vault.past_performance?.length || 0,
          capabilities: vault.capabilities?.length || 0,
          team: vault.team?.length || 0,
        },
        ragChunksUsed: ragChunks.length,
        ragSources: ragChunks.map((c) => ({ title: c.doc_title, type: c.doc_type })),
      },
    });
  } catch (err) {
    console.error('[proposal/draft] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/draft',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });
    return NextResponse.json({ success: false, error: 'Draft generation failed. Try again.' }, { status: 500 });
  }
}
