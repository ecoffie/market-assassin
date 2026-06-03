import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { logToolError, ToolNames, AIProviders, classifyError } from '@/lib/tool-errors';
import type { LoiFields } from '@/lib/proposal/loi-fields';
import { LOI_FIELDS_KEYS } from '@/lib/proposal/loi-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

// Same cap as the compliance route — 50K chars (~12K tokens) is plenty for a
// Sources Sought / RFI notice, which is short relative to a full RFP.
const MAX_INPUT_CHARS = 50000;

interface RequestBody {
  text?: string;
  fileName?: string;
  // Optional hints we already know from sam_opportunities so the model can
  // anchor on them instead of re-deriving from prose.
  agency?: string;
  title?: string;
  solicitationNumber?: string;
}

const SYSTEM_PROMPT = `You read a federal Sources Sought / RFI / solicitation notice (copied from SAM.gov) and extract the structured fields a small business needs to write a Letter of Intent / Statement of Capability response.

Extract ONLY what the notice actually states. If a field is not present, OMIT it (do not guess, do not invent emails or dates).

Return ONLY valid JSON in this exact shape, no prose, no markdown fences:
{
  "solicitationNumber": "string — notice/solicitation number, e.g. PANNGB-26-P-0000033323 or B1502",
  "projectTitle": "string — the requirement/project title",
  "agencyName": "string — buying agency, include sub-agency if shown (e.g. 'Department of Defense — Department of the Army')",
  "agencyAttention": "string — person to address the letter to, if named",
  "agencyAddress": { "street": "", "city": "", "state": "", "zip": "" },
  "submissionDeadline": "string — response due date/time exactly as written (e.g. 'June 5, 2026 2:00 PM CDT')",
  "submissionMethod": "string — how/where to submit, e.g. 'Email: jeremy.hendrick@us.af.mil & stephen.shanks.1@us.af.mil'",
  "pageLimit": "string — e.g. '5-page limit' if stated",
  "requestedContent": ["bullet list of WHAT the response must contain — relevant experience, business size status, bonding, security, etc."],
  "requiredAttachments": ["e.g. 'Capability statement', 'References'"],
  "capabilityStatementRequested": "yes" | "no" | "not_stated",
  "contactName": "string — primary point of contact name",
  "contactEmail": "string — primary contact email",
  "contactPhone": "string — primary contact phone",
  "naicsCode": "string — NAICS code cited in the notice (e.g. 236220)",
  "requiredCertifications": ["set-asides / certs the notice asks about, e.g. '8(a)', 'SDVOSB', 'HUBZone', 'WOSB'"]
}

Rules:
- Omit any field you cannot find in the text. Omit empty objects/arrays.
- Quote dates, emails, and the solicitation number verbatim from the notice.
- For requestedContent, capture the actual response requirements (e.g. "2-4 examples of similar projects from last 5 years", "company business size status under the NAICS", "bonding capacity", "security/badging compliance").
- capabilityStatementRequested: "yes" if the notice asks for a capability statement, "no" if it explicitly says none, else "not_stated".`;

function pick<T>(obj: Record<string, unknown>, key: string): T | undefined {
  const v = obj[key];
  return (v === null || v === undefined || v === '') ? undefined : (v as T);
}

// Defensively coerce the model output to our LoiFields shape. Never trust the
// LLM to return exactly the schema — keep only known keys, drop empties.
function sanitizeFields(raw: unknown): LoiFields {
  const out: LoiFields = {};
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;

  const strKeys = [
    'solicitationNumber', 'projectTitle', 'agencyName', 'agencyAttention',
    'submissionDeadline', 'submissionMethod', 'pageLimit',
    'contactName', 'contactEmail', 'contactPhone', 'naicsCode',
  ] as const;
  for (const k of strKeys) {
    const v = pick<string>(o, k);
    if (typeof v === 'string' && v.trim()) (out as Record<string, unknown>)[k] = v.trim();
  }

  const arrKeys = ['requestedContent', 'requiredAttachments', 'requiredCertifications'] as const;
  for (const k of arrKeys) {
    const v = o[k];
    if (Array.isArray(v)) {
      const cleaned = v.map(String).map((s) => s.trim()).filter(Boolean);
      if (cleaned.length) (out as Record<string, unknown>)[k] = cleaned;
    }
  }

  const addr = o.agencyAddress;
  if (addr && typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    const cleaned: Record<string, string> = {};
    for (const k of ['street', 'city', 'state', 'zip']) {
      const v = a[k];
      if (typeof v === 'string' && v.trim()) cleaned[k] = v.trim();
    }
    if (Object.keys(cleaned).length) out.agencyAddress = cleaned;
  }

  const cap = pick<string>(o, 'capabilityStatementRequested');
  if (cap === 'yes' || cap === 'no' || cap === 'not_stated') out.capabilityStatementRequested = cap;

  // Strip any stray keys the model invented.
  for (const k of Object.keys(out) as (keyof LoiFields)[]) {
    if (!LOI_FIELDS_KEYS.includes(k)) delete (out as Record<string, unknown>)[k as string];
  }
  return out;
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
  if (!sourceText) {
    return NextResponse.json(
      { success: false, error: 'No notice text provided. Paste the SAM.gov notice text first.' },
      { status: 400 }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'AI service not configured' }, { status: 500 });
  }

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

  const hints = [
    body.agency ? `Known agency: ${body.agency}` : '',
    body.title ? `Known title: ${body.title}` : '',
    body.solicitationNumber ? `Known solicitation number: ${body.solicitationNumber}` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${hints ? hints + '\n\n' : ''}Notice: ${body.fileName || 'SAM.gov Sources Sought notice'}\n\n--- NOTICE TEXT (${inputText.length.toLocaleString()} chars${wasTruncated ? ', truncated' : ''}) ---\n${inputText}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[proposal/extract-loi-fields] Groq error:', response.status, errText);
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: response.status === 429 ? 'ai_rate_limit' : 'api_error',
        errorMessage: `Groq ${response.status}: ${errText.slice(0, 500)}`,
        requestPath: '/api/app/proposal/extract-loi-fields',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json({ success: false, error: 'AI service error. Try again.' }, { status: 500 });
    }

    const completion = await response.json();
    const raw = completion.choices?.[0]?.message?.content || '';

    let parsed: unknown;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('[proposal/extract-loi-fields] parse failed:', err, 'raw:', raw.slice(0, 500));
      await logToolError({
        tool: ToolNames.PROPOSAL_ASSIST,
        errorType: 'internal',
        errorMessage: 'LLM returned non-JSON response',
        requestPath: '/api/app/proposal/extract-loi-fields',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json({ success: false, error: 'AI returned an unexpected response. Try again.' }, { status: 500 });
    }

    const fields = sanitizeFields(parsed);

    return NextResponse.json({
      success: true,
      fields,
      meta: {
        model: GROQ_MODEL,
        inputChars: inputText.length,
        truncated: wasTruncated,
        originalChars: sourceText.length,
        fieldsFound: Object.keys(fields).length,
      },
    });
  } catch (err) {
    console.error('[proposal/extract-loi-fields] exception:', err);
    const errAsError = err instanceof Error ? err : new Error(String(err));
    await logToolError({
      tool: ToolNames.PROPOSAL_ASSIST,
      errorType: classifyError(errAsError),
      errorMessage: errAsError.message,
      requestPath: '/api/app/proposal/extract-loi-fields',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
    });
    return NextResponse.json({ success: false, error: 'Field extraction failed. Try again.' }, { status: 500 });
  }
}
