import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

const MAX_INPUT_CHARS = 40000; // a bit lower than compliance to leave room for output

type SectionType = 'exec_summary' | 'technical' | 'management' | 'past_performance' | 'pricing';

const SECTION_PROMPTS: Record<SectionType, { label: string; prompt: string; targetWords: number }> = {
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
      { success: false, error: 'sectionType must be one of: exec_summary, technical, management, past_performance, pricing' },
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

  const systemPrompt = `You are a senior federal proposal writer. Draft proposal section copy that is compliant, specific to the source solicitation, and grounded in the bidder's saved profile.

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
