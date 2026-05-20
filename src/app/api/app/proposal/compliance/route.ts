import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

// Cap source text we send to the model. 50K chars ~ 12K tokens, well under llama 3.3's window
// and lets us return useful coverage even on long RFPs without rate-limit pain.
const MAX_INPUT_CHARS = 50000;

interface ComplianceRequirement {
  id: string;
  requirement: string;
  category: 'submission' | 'evaluation' | 'technical' | 'past_performance' | 'pricing' | 'admin' | 'other';
  section?: string;
  source_quote?: string;
}

interface RequestBody {
  text?: string;
  fileName?: string;
}

const SYSTEM_PROMPT = `You are a federal proposal compliance analyst. Read the solicitation excerpt and extract EVERY explicit requirement, instruction, or evaluation factor a bidder must address.

Look for:
- "shall", "must", "will", "required", "is required to" obligations
- Section L (Instructions to Offerors), Section M (Evaluation Factors), Section C (SOW/PWS)
- Submission deadlines, page limits, formatting rules, copies required, portal/method
- Required certifications, representations, reps & certs
- Past performance volume, technical volume, price volume requirements
- Evaluation factors and their relative weights

Return ONLY valid JSON in this exact shape, no prose, no markdown fences:
{
  "requirements": [
    {
      "id": "REQ-001",
      "requirement": "Short one-line statement of what bidder must do",
      "category": "submission" | "evaluation" | "technical" | "past_performance" | "pricing" | "admin" | "other",
      "section": "L.3.2",        // optional, omit if unknown
      "source_quote": "..."       // optional, ~12-25 words verbatim from the doc
    }
  ]
}

Rules:
- Aim for 15-50 requirements. Skip vague or aspirational language.
- One requirement per row. Split compound "shall" sentences into separate rows.
- Use stable ids REQ-001, REQ-002, ... in document order.
- Prefer crisp imperatives in "requirement" ("Submit Past Performance volume in PDF, max 25 pages").
- If a section/clause label is visible nearby (L.3, M-2, 52.212-1), put it in "section".`;

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
  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: 'No source text provided. Upload an RFP first.' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'AI service not configured' },
      { status: 500 }
    );
  }

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

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
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Solicitation: ${body.fileName || 'untitled'}\n\n--- SOURCE TEXT (${inputText.length.toLocaleString()} chars${wasTruncated ? ', truncated' : ''}) ---\n${inputText}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[proposal/compliance] Groq error:', response.status, errText);
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: response.status === 429 ? 'ai_rate_limit' : 'api_error',
        errorMessage: `Groq ${response.status}: ${errText.slice(0, 500)}`,
        requestPath: '/api/app/proposal/compliance',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json(
        { success: false, error: 'AI service error. Try again.' },
        { status: 500 }
      );
    }

    const completion = await response.json();
    const raw = completion.choices?.[0]?.message?.content || '';

    let parsed: { requirements?: ComplianceRequirement[] };
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('[proposal/compliance] parse failed:', err, 'raw:', raw.slice(0, 500));
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: 'internal',
        errorMessage: 'LLM returned non-JSON response',
        requestPath: '/api/app/proposal/compliance',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json(
        { success: false, error: 'AI returned an unexpected response. Try again.' },
        { status: 500 }
      );
    }

    const requirements = Array.isArray(parsed.requirements) ? parsed.requirements : [];

    return NextResponse.json({
      success: true,
      requirements,
      meta: {
        model: GROQ_MODEL,
        inputChars: inputText.length,
        truncated: wasTruncated,
        originalChars: sourceText.length,
        count: requirements.length,
      },
    });
  } catch (err) {
    console.error('[proposal/compliance] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/compliance',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });
    return NextResponse.json(
      { success: false, error: 'Compliance extraction failed. Try again.' },
      { status: 500 }
    );
  }
}
