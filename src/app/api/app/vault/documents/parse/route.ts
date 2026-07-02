/**
 * POST /api/app/vault/documents/parse   { email, document_id }
 *
 * Takes an ALREADY-UPLOADED boilerplate doc (a capability statement) whose text
 * was extracted at upload time, and asks the LLM to split it into the Vault's
 * structured sections:
 *   - overview        → identity one-liner / elevator pitch
 *   - past_performance[] → contract rows (title, agency, scope, ...)
 *   - capabilities[]  → capability rows (name, description, keywords, ...)
 *
 * It DOES NOT write anything. It returns the parsed suggestions so the client can
 * PRE-FILL a review screen; the user confirms each section and the existing
 * structured routes (identity / past-performance / capabilities) do the actual
 * saves. Same "parse → review → save, never auto-commit" contract as the resume
 * upload — cap-statement parsing is good-not-perfect and the human confirms.
 *
 * Grounding rule (Eric #1): the LLM ONLY labels/structures text that is present
 * in the document. It must NEVER invent a contract, agency, dollar value, or
 * capability that isn't in the source. Empty is a valid answer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { callLLM } from '@/lib/llm/call-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

const PARSE_PROMPT = `You structure a US federal contractor's CAPABILITY STATEMENT
into the sections of a proposal Vault. You are given the raw text of the document.
Return ONLY a JSON object with EXACTLY these keys:

{
  "overview": {"one_liner": "", "elevator_pitch": ""},
  "past_performance": [
    {"contract_title": "", "agency": "", "contract_number": "", "role": "", "scope_description": "", "period": "", "contract_value": ""}
  ],
  "capabilities": [
    {"capability_name": "", "description": "", "keywords": []}
  ]
}

Rules:
- Use ONLY information that is explicitly present in the document text. NEVER invent
  a contract, agency, dollar amount, date, or capability that is not written there.
- BE EXHAUSTIVE. Capability statements pack many projects and competencies into dense
  tables and bullet lists. Extract EVERY distinct one you can find — do NOT stop after
  the first few, do NOT summarize, do NOT return a representative sample. If the
  document details 14 projects, return 14 past_performance objects. Missing entries is
  the #1 failure — scan the WHOLE document to the end before you answer.

- overview.one_liner: a single crisp sentence describing what the company does (from
  the "Company Profile"/"About"/"Overview" area). "" if not present.
- overview.elevator_pitch: a 2-4 sentence company summary in third person, drawn from
  the document. "" if not present.

- past_performance: one object per CONTRACT/PROJECT the document details. These usually
  appear as a table or repeated blocks, each with a project name, a "Prime Contract" or
  "Subcontract" label, an agency/customer or a "Prime Contractor: X", a "Total Value:"
  amount, and a scope paragraph. Create one object for EACH such block.
    - contract_title = the project name (e.g. "Boott Cotton Mills, Lowell, MA - Historic Windows").
    - agency = the buying agency/customer if named (e.g. "Department of Interior, National
      Parks Service"); if the block instead names a "Prime Contractor:", use that as the
      agency (they subcontracted to this company).
    - role = "Prime Contract" or "Subcontract" if the block says so, else "".
    - scope_description = the scope paragraph, verbatim or lightly trimmed.
    - contract_value = the "Total Value" amount if stated (e.g. "$2,942,548"), else "".
    - contract_number, period only if explicitly stated, else "".
  A short bare bullet list of project NAMES with no detail (e.g. a "Past Performance"
  summary column) can be skipped IF those same projects appear in detail elsewhere;
  prefer the detailed blocks. Empty array [] only if the doc truly lists no past work.

- capabilities: one object per distinct SERVICE / CORE COMPETENCY. Look especially at a
  "Core Competencies", "Capabilities", "Services", or "Self-Perform" section — these are
  usually bullet lists, and EACH bullet is one capability. Extract every bullet.
    - capability_name = the bullet/label (e.g. "Historical Renovations", "Lead Paint Removal").
    - description = supporting sentence(s) from the doc, or "" if the bullet stands alone.
    - keywords = 2-6 relevant terms.
  Empty array [] only if no competencies/services are listed.

- Deduplicate exact repeats. Reply with ONLY the JSON object, no prose, no markdown fences.`;

interface ParsedCap { capability_name: string; description: string; keywords: string[] }
interface ParsedPP {
  contract_title: string; agency: string; contract_number: string;
  role: string; scope_description: string; period: string; contract_value: string;
}
interface Parsed {
  overview: { one_liner: string; elevator_pitch: string };
  past_performance: ParsedPP[];
  capabilities: ParsedCap[];
}

const str = (v: unknown) => String(v ?? '').trim();
const strArr = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = str(body.email);
  const documentId = str(body.document_id);
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  if (!documentId) return NextResponse.json({ success: false, error: 'document_id is required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;

  // Load the extracted text (owner-scoped).
  const { data: doc, error: docErr } = await getSupabase()
    .from('user_boilerplate_docs')
    .select('id, extracted_text, parse_status, original_filename')
    .eq('id', documentId)
    .eq('user_email', userEmail)
    .maybeSingle();
  if (docErr) return NextResponse.json({ success: false, error: docErr.message }, { status: 500 });
  if (!doc) return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });

  const text = str(doc.extracted_text);
  if (!text || text.length < 60) {
    return NextResponse.json(
      { success: false, error: 'This document has no readable text to parse (is it a scanned image?).' },
      { status: 422 },
    );
  }

  // LLM → structured sections (cost-disciplined reasoning chain: gpt-4o-mini first).
  let parsed: Parsed;
  try {
    const { text: out } = await callLLM({
      system: PARSE_PROMPT,
      user: text.slice(0, 40000),
      json: true,
      temperature: 0.1,
      // Cap statements can hold 10-20 detailed projects + a dozen competencies; a
      // small cap truncates the JSON (and drops entries). Give room to be exhaustive.
      maxTokens: 8000,
      job: 'reasoning',
    });
    const raw = JSON.parse(out.replace(/```json\n?|```\n?/g, '').trim());
    parsed = {
      overview: {
        one_liner: str(raw?.overview?.one_liner),
        elevator_pitch: str(raw?.overview?.elevator_pitch),
      },
      past_performance: Array.isArray(raw?.past_performance)
        ? raw.past_performance
            .map((p: Record<string, unknown>) => ({
              contract_title: str(p.contract_title),
              agency: str(p.agency),
              contract_number: str(p.contract_number),
              role: str(p.role),
              scope_description: str(p.scope_description),
              period: str(p.period),
              contract_value: str(p.contract_value),
            }))
            // A past-perf row is only useful if it at least names the work + who bought it.
            .filter((p: ParsedPP) => p.contract_title && p.agency)
            .slice(0, 25)
        : [],
      capabilities: Array.isArray(raw?.capabilities)
        ? raw.capabilities
            .map((c: Record<string, unknown>) => ({
              capability_name: str(c.capability_name),
              description: str(c.description),
              keywords: strArr(c.keywords),
            }))
            .filter((c: ParsedCap) => c.capability_name && c.description)
            .slice(0, 25)
        : [],
    };
  } catch {
    return NextResponse.json(
      { success: false, error: "Couldn't read structured sections from this document — try adding them manually." },
      { status: 422 },
    );
  }

  const total =
    parsed.past_performance.length +
    parsed.capabilities.length +
    (parsed.overview.one_liner || parsed.overview.elevator_pitch ? 1 : 0);

  return NextResponse.json({
    success: true,
    document_id: documentId,
    filename: doc.original_filename,
    parsed,
    counts: {
      overview: parsed.overview.one_liner || parsed.overview.elevator_pitch ? 1 : 0,
      past_performance: parsed.past_performance.length,
      capabilities: parsed.capabilities.length,
      total,
    },
  });
}
