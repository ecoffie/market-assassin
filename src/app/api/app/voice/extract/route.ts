/**
 * POST /api/app/voice/extract — voice capture step 2 (#119)
 *
 * Takes a transcript string (from /api/app/voice/transcribe) and
 * returns a structured pursuit row the UI can pre-fill its
 * confirmation card with. Groq Llama 3.3 70B with a strict JSON
 * response_format, temperature 0.2 (low — this is factual extraction
 * not creative writing).
 *
 * The extraction shape mirrors the user_pipeline columns the
 * Pipeline POST endpoint accepts, so the UI can pass it through with
 * minimal transformation. Fields the LLM doesn't find are returned
 * null; the UI surfaces them as empty for the user to fill in.
 *
 * v1 is single-pursuit extraction. Multi-pursuit ("Maria mentioned
 * three RFPs in that call") is deferred — most field captures are
 * about one opportunity at a time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const TEMPERATURE = 0.2;

interface ExtractRequest {
  email: string;
  transcript: string;
}

interface ExtractedPursuit {
  title: string | null;
  agency: string | null;
  sub_agency: string | null;
  notice_type: string | null;
  set_aside: string | null;
  naics_code: string | null;
  psc_code: string | null;
  value_estimate: string | null;
  stage: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | null;
  priority: 'low' | 'medium' | 'high' | null;
  notes: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  due_date: string | null;     // ISO yyyy-mm-dd
  is_prime: boolean | null;
}

const SYSTEM_PROMPT = `You extract structured federal-contracting pursuit data from spoken-word transcripts. The user just talked into their phone about an opportunity they want to track. You return ONLY a JSON object — no preamble, no explanation, no markdown fences.

Schema (use null for anything not clearly stated):
{
  "title": string | null,             // Concise opportunity title. E.g. "Facility maintenance — GSA Region 5". Not the full transcript.
  "agency": string | null,            // Top-level agency (GSA, VA, DOD, DHS, etc.)
  "sub_agency": string | null,        // Specific component (Region 5, NAVFAC Atlantic, Army Corps Mobile District)
  "notice_type": string | null,       // "Sources Sought" | "RFP" | "RFQ" | "Presolicitation" | "Combined Synopsis/Solicitation" | "Special Notice"
  "set_aside": string | null,         // "8(a)" | "WOSB" | "HUBZone" | "SDVOSB" | "Small Business" | etc.
  "naics_code": string | null,        // 6-digit code if explicitly named; otherwise null
  "psc_code": string | null,          // 4-char code if explicitly named; otherwise null
  "value_estimate": string | null,    // Dollar amount with currency symbol. "$2,000,000" or "$2M" — match the speaker's specificity
  "stage": "tracking" | "pursuing" | "bidding" | "submitted" | null,  // Default null → UI shows 'tracking'
  "priority": "low" | "medium" | "high" | null,
  "notes": string | null,             // Free-form context the speaker mentioned that doesn't fit other fields. Keep tight.
  "contact_name": string | null,      // "Maria Lopez" — first + last if heard
  "contact_phone": string | null,     // Formatted as-spoken: "312-555-0123"
  "contact_email": string | null,
  "due_date": string | null,          // ISO yyyy-mm-dd. Resolve relative dates ("next Friday", "end of Q3") to absolute dates using TODAY as reference.
  "is_prime": boolean | null          // true if speaker is going after as prime, false if as a sub. null if unstated.
}

Rules:
- title: extract the OPPORTUNITY, not the speaker's situation. "Facility maintenance for GSA Region 5" not "I just talked to Maria".
- value_estimate: ONLY include if a dollar figure was spoken. NEVER infer or estimate. If they said "small contract" with no number → null.
- Federal acronyms: GSA, VA, DOD/DoD, DHS, NIH, SOUTHCOM, NAVFAC, USACE, USAF, etc. Normalize "Department of Defense" → "DOD".
- If the speaker is clearly venting / off-topic / not describing an opportunity, return all fields null and put a short note in "notes" explaining what was said.
- Do NOT invent contact info, NAICS, or contract values that weren't in the transcript.`;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  let body: ExtractRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body?.email || '').toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  const transcript = String(body?.transcript || '').trim();
  if (!transcript) {
    return NextResponse.json({ error: 'transcript required' }, { status: 400 });
  }
  if (transcript.length > 8000) {
    return NextResponse.json({ error: 'transcript too long (8000 char max)' }, { status: 400 });
  }

  // requireUserAuth's body-reader can't re-parse our already-consumed
  // JSON body. Call verifyUserOwnsEmail directly with the email we
  // pulled out, same as the transcribe route.
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ error: 'Server misconfigured: GROQ_API_KEY missing' }, { status: 500 });
  }

  const startedAt = Date.now();
  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `TODAY = ${todayIso()}\n\nTRANSCRIPT (spoken by the user):\n"${transcript}"\n\nReturn the JSON object.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: TEMPERATURE,
      max_tokens: 800,
    }),
  });

  const latencyMs = Date.now() - startedAt;

  if (!groqRes.ok) {
    const errText = await groqRes.text().catch(() => '(no body)');
    console.error('[voice/extract] Groq', groqRes.status, errText.slice(0, 200));
    return NextResponse.json(
      { error: `Extraction failed (${groqRes.status})`, detail: errText.slice(0, 200) },
      { status: 502 },
    );
  }

  const responseBody = await groqRes.json();
  const content = responseBody?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    return NextResponse.json({ error: 'Empty extraction from model' }, { status: 502 });
  }

  let extracted: ExtractedPursuit;
  try {
    extracted = JSON.parse(content);
  } catch {
    return NextResponse.json({ error: 'Model returned malformed JSON' }, { status: 502 });
  }

  // Minor cleanup: trim strings, drop empty-string values to null so
  // the client can rely on `field == null` consistently.
  const normalized: ExtractedPursuit = {
    title: trimOrNull(extracted.title),
    agency: trimOrNull(extracted.agency),
    sub_agency: trimOrNull(extracted.sub_agency),
    notice_type: trimOrNull(extracted.notice_type),
    set_aside: trimOrNull(extracted.set_aside),
    naics_code: trimOrNull(extracted.naics_code),
    psc_code: trimOrNull(extracted.psc_code),
    value_estimate: trimOrNull(extracted.value_estimate),
    stage: (['tracking', 'pursuing', 'bidding', 'submitted'].includes(extracted.stage as string) ? extracted.stage : null) as ExtractedPursuit['stage'],
    priority: (['low', 'medium', 'high'].includes(extracted.priority as string) ? extracted.priority : null) as ExtractedPursuit['priority'],
    notes: trimOrNull(extracted.notes),
    contact_name: trimOrNull(extracted.contact_name),
    contact_phone: trimOrNull(extracted.contact_phone),
    contact_email: trimOrNull(extracted.contact_email),
    due_date: trimOrNull(extracted.due_date),
    is_prime: typeof extracted.is_prime === 'boolean' ? extracted.is_prime : null,
  };

  return NextResponse.json({
    success: true,
    extracted: normalized,
    latencyMs,
  });
}

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}
