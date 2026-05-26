import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';

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

  const profile = await loadUserProfile(email);
  const profileBlock = buildProfileBlock(profile);

  const sectionMeta = SECTION_PROMPTS[sectionType];

  // Capability-statement sections get a different system prompt that
  // reframes the work as a Sources Sought / RFI response, not an RFP
  // proposal. Otherwise the AI defaults to proposal-speak even when
  // the section guidance asks for capability-statement format.
  const isCapStatementSection = ['company_overview', 'cap_past_performance', 'capabilities', 'differentiators', 'poc'].includes(sectionType);

  const systemPrompt = isCapStatementSection
    ? `You are a senior federal capture writer. Draft a SHORT capability-statement section for a Sources Sought or RFI response — NOT a proposal. Capability statements are 2-3 pages total, scanned in 30 seconds by agency staff doing market research.

Rules:
- Concise prose + scannable bullets. No marketing fluff.
- Mirror language from the source notice where it shows alignment with the scope.
- Use bracketed [placeholders] for facts not in the bidder profile (UEI, CAGE, specific past contracts, named personnel).
- Never invent facts about the bidder beyond the profile block.
- Never use 'world-class', 'best-in-class', 'cutting-edge'.
- Do NOT use proposal section labels like 'Executive Summary' — this is a capability statement section.
- Output plain markdown only. No JSON. No commentary about what you wrote.`
    : `You are a senior federal proposal writer. Draft proposal section copy that is compliant, specific to the source solicitation, and grounded in the bidder's saved profile.

Rules:
- Use clear headings and short paragraphs.
- Mirror language from the solicitation where it shows the bidder understands the scope.
- Use bracketed [placeholders] for anything you do not know (specific past performance contracts, exact dollar amounts, named personnel).
- Never invent facts about the bidder beyond the profile block provided.
- No marketing fluff, no superlatives like "world-class" or "best-in-class".
- Output plain markdown only. No JSON. No commentary about what you wrote.`;

  const userPrompt = `Bidder profile:
${profileBlock}

Section to draft: ${sectionMeta.label}
Section guidance:
${sectionMeta.prompt}

Solicitation: ${body.fileName || 'untitled'}
--- SOURCE TEXT (${inputText.length.toLocaleString()} chars${wasTruncated ? ', truncated' : ''}) ---
${inputText}`;

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
