/**
 * AI-Powered Code Suggestion API
 *
 * POST /api/suggest-codes
 *
 * Takes a natural language description of what the user/company does
 * and suggests appropriate NAICS and PSC codes.
 *
 * Request body:
 * - description: string (what the user does, e.g., "I provide IT security consulting")
 * - maxResults: number (default: 5)
 *
 * Response:
 * - naicsSuggestions: Array of { code, name, confidence, reason }
 * - pscSuggestions: Array of { code, name, confidence, reason }
 */

import { NextRequest, NextResponse } from 'next/server';
import { logToolError, recordToolSuccess, ToolNames, classifyError, AIProviders } from '@/lib/tool-errors';
import { fiscalYearTimePeriod, fiscalYearLabel } from '@/lib/utils/fiscal-year';
import { sectorSubTradeKeywords } from '@/lib/market/sector-expansions';

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Common NAICS codes with descriptions for the AI to reference
const NAICS_REFERENCE = `
CONSTRUCTION:
236115 - New Single-Family Housing Construction
236116 - New Multifamily Housing Construction
236210 - Industrial Building Construction
236220 - Commercial and Institutional Building Construction
237110 - Water and Sewer Line Construction
237130 - Power and Communication Line Construction
237310 - Highway, Street, and Bridge Construction
238210 - Electrical Contractors
238220 - Plumbing, Heating, and AC Contractors
238910 - Site Preparation Contractors

IT & TECHNOLOGY:
541511 - Custom Computer Programming Services
541512 - Computer Systems Design Services
541513 - Computer Facilities Management Services
541519 - Other Computer Related Services
518210 - Data Processing, Hosting, and Related Services
517110 - Wired Telecommunications Carriers
517210 - Wireless Telecommunications Carriers

PROFESSIONAL SERVICES:
541611 - Administrative Management Consulting
541612 - Human Resources Consulting
541613 - Marketing Consulting
541614 - Process and Logistics Consulting
541618 - Other Management Consulting
541620 - Environmental Consulting
541690 - Other Scientific and Technical Consulting
541990 - All Other Professional, Scientific, and Technical Services

ENGINEERING & R&D:
541310 - Architectural Services
541320 - Landscape Architectural Services
541330 - Engineering Services
541340 - Drafting Services
541350 - Building Inspection Services
541380 - Testing Laboratories
541711 - Biotechnology R&D
541712 - Physical, Engineering, and Life Sciences R&D
541715 - Social Sciences and Humanities R&D

ADMINISTRATIVE & SUPPORT:
561110 - Office Administrative Services
561210 - Facilities Support Services
561320 - Temporary Help Services
561330 - Professional Employer Organizations
561410 - Document Preparation Services
561499 - All Other Business Support Services
561710 - Exterminating and Pest Control Services
561720 - Janitorial Services
561730 - Landscaping Services
561790 - Other Services to Buildings and Dwellings

HEALTHCARE:
621111 - Offices of Physicians
621210 - Offices of Dentists
621310 - Offices of Chiropractors
621399 - Offices of All Other Miscellaneous Health Practitioners
621410 - Family Planning Centers
621420 - Outpatient Mental Health Centers
621491 - HMO Medical Centers
621511 - Medical Laboratories
621512 - Diagnostic Imaging Centers

LOGISTICS & TRANSPORTATION:
484110 - General Freight Trucking, Local
484121 - General Freight Trucking, Long-Distance
484122 - General Freight Trucking, Long-Distance, LTL
493110 - General Warehousing and Storage
493120 - Refrigerated Warehousing and Storage
488510 - Freight Transportation Arrangement

EDUCATION & TRAINING:
611310 - Colleges, Universities, and Professional Schools
611420 - Computer Training
611430 - Professional and Management Development Training
611519 - Other Technical and Trade Schools
611710 - Educational Support Services

MANUFACTURING:
332710 - Machine Shops
332994 - Small Arms, Ordnance, and Ordnance Accessories Manufacturing
334111 - Electronic Computer Manufacturing
334118 - Computer Terminal and Other Computer Peripheral Equipment Manufacturing
334511 - Search, Detection, Navigation, Guidance, Aeronautical, and Nautical Systems
334516 - Analytical Laboratory Instrument Manufacturing
336411 - Aircraft Manufacturing
336412 - Aircraft Engine and Engine Parts Manufacturing
336414 - Guided Missile and Space Vehicle Manufacturing
`;

// Common PSC codes for the AI to reference
const PSC_REFERENCE = `
IT SERVICES:
D301 - IT and Telecom - Data Entry
D302 - IT and Telecom - Word Processing
D303 - IT and Telecom - General ADP Services
D304 - IT and Telecom - Help Desk
D306 - IT and Telecom - Systems Analysis
D307 - IT and Telecom - Systems Engineering
D308 - IT and Telecom - Programming
D310 - IT and Telecom - Cyber Security
D311 - IT and Telecom - IT Strategy/Architecture
D313 - IT and Telecom - Integration Services
D314 - IT and Telecom - System Acquisition Support
D316 - IT and Telecom - SDLC Development
D317 - IT and Telecom - Web-based Subscription
D318 - IT and Telecom - Hosting Service
D319 - IT and Telecom - Other IT Services
D399 - IT and Telecom - Other

PROFESSIONAL SERVICES:
R408 - Support - Professional: Program Management
R410 - Support - Professional: Program Evaluation
R421 - Support - Professional: Technical Assistance
R425 - Support - Professional: Engineering
R497 - Support - Professional: Personal Services
R499 - Support - Professional: Other
B504 - Special Studies and Analysis
B505 - Study/Environmental Assessment
B506 - Study/Planning and Marketing
B507 - Study/Feasibility (Non-Construction)

CONSULTING:
R706 - Support - Management: Logistics Support
R707 - Support - Management: Contract Support
R708 - Support - Management: Financial Management
R799 - Support - Management: Other

CONSTRUCTION:
Y1AA - Construction of Office Buildings
Y1AZ - Construction of Other Buildings
Y1DA - Construction of Hospitals/Infirmaries
Y1JZ - Construction of Miscellaneous Buildings
Z1AA - Maintenance of Office Buildings
Z1AZ - Maintenance of Other Buildings
Z1DA - Maintenance of Hospitals/Infirmaries
Z2AA - Repair of Office Buildings

FACILITIES & MAINTENANCE:
S201 - Housekeeping - Custodial Janitorial
S202 - Housekeeping - Fire Prevention
S203 - Housekeeping - Food
S206 - Housekeeping - Guard
S207 - Housekeeping - Insect/Rodent Control
S208 - Housekeeping - Landscaping/Groundskeeping
S216 - Housekeeping - Facilities Operations Support

TRAINING:
U001 - Education/Training - Lectures
U002 - Education/Training - Courseware Development
U003 - Education/Training - Media Development
U006 - Education/Training - Training/Curriculum Development
U007 - Education/Training - Training Services
U009 - Education/Training - General Education/Training
U099 - Education/Training - Other

MEDICAL/HEALTHCARE:
Q101 - Medical - General Healthcare
Q201 - Medical - Community Mental Health
Q301 - Medical - Laboratory Testing
Q401 - Medical - Nursing Services
Q501 - Medical - Med Admin and Record
Q523 - Medical - Medical Equipment Maintenance
Q999 - Medical - Other

EQUIPMENT & PRODUCTS:
7010 - ADP Equipment - Computer Configuration
7020 - ADP Equipment - Central Processing Unit
7025 - ADP Equipment - Input/Output Devices
7030 - ADP Equipment - Software
7035 - ADP Equipment - Support Equipment
7045 - ADP Equipment - Components
7050 - ADP Equipment - Supplies
`;

interface CodeSuggestion {
  code: string;
  name: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface SuggestCodesResponse {
  success: boolean;
  naicsSuggestions: CodeSuggestion[];
  pscSuggestions: CodeSuggestion[];
  source?: 'usaspending' | 'llm';
  error?: string;
}

/**
 * Ground NAICS + PSC suggestions in REAL USASpending award data for a keyword
 * (Eric's principle: suggest the codes that ACTUALLY have spending under the
 * term, not an LLM guess). Queries spending_by_category for the last FY.
 */
// USASpending keyword search is EXACT-PHRASE (QA: onboarding sentences like
// "cybersecurity consulting" returned nothing → silently fell to the LLM). Reduce
// a phrase/sentence to candidates most→least specific so we stay grounded.
const SUGGEST_STOP = new Set(['we', 'provide', 'offer', 'and', 'or', 'the', 'a', 'an', 'for', 'of', 'to', 'in', 'our', 'with', 'services', 'service', 'support', 'solutions', 'consulting', 'company', 'federal', 'government', 'agencies']);
function suggestKeywordCandidates(input: string): string[] {
  const kw = input.trim();
  const out = [kw];
  const words = kw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !SUGGEST_STOP.has(w));
  for (const w of [...new Set(words)].sort((a, b) => b.length - a.length)) if (!out.includes(w)) out.push(w);
  return out.slice(0, 4);
}

/** Merge two grounded lists, dedupe by code (primary wins ordering), cap at limit. */
function mergeDedupeCodes(primary: CodeSuggestion[], extra: CodeSuggestion[], limit: number): CodeSuggestion[] {
  const seen = new Set<string>();
  const out: CodeSuggestion[] = [];
  for (const s of [...primary, ...extra]) {
    if (!s.code || seen.has(s.code)) continue;
    seen.add(s.code);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

async function groundCodesFromUsaspending(keyword: string, maxResults: number): Promise<{ naicsSuggestions: CodeSuggestion[]; pscSuggestions: CodeSuggestion[] } | null> {
  const base = 'https://api.usaspending.gov/api/v2/search/spending_by_category';
  // kw can be a single phrase or an array (USASpending ORs the array) — the latter
  // is how a sector's sub-trades are grounded in one call.
  const fetchCat = async (kw: string | string[], cat: 'naics' | 'psc', limit: number): Promise<CodeSuggestion[]> => {
    const kws = Array.isArray(kw) ? kw : [kw];
    const label = Array.isArray(kw) ? 'related trades' : kw;
    try {
      const res = await fetch(`${base}/${cat}/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: { keywords: kws, time_period: [fiscalYearTimePeriod()], award_type_codes: ['A', 'B', 'C', 'D'] },
          limit,
        }),
      });
      if (!res.ok) return [];
      const j = await res.json();
      return (j.results || []).filter((r: { code?: string; amount?: number }) => r.code && (r.amount || 0) > 0)
        .map((r: { code: string; name?: string; amount: number }) => ({
          code: r.code,
          name: r.name || r.code,
          confidence: 'high' as const,
          reason: `$${(r.amount / 1e6).toFixed(1)}M in ${fiscalYearLabel()} federal awards under "${label}"`,
        }));
    } catch { return []; }
  };
  // Try candidates until one yields real award data (phrase resilience).
  let primary: { naicsSuggestions: CodeSuggestion[]; pscSuggestions: CodeSuggestion[] } | null = null;
  for (const cand of suggestKeywordCandidates(keyword)) {
    const [naicsSuggestions, pscSuggestions] = await Promise.all([fetchCat(cand, 'naics', maxResults), fetchCat(cand, 'psc', maxResults)]);
    if (naicsSuggestions.length > 0 || pscSuggestions.length > 0) {
      primary = { naicsSuggestions, pscSuggestions };
      break;
    }
  }
  if (!primary) return null;

  // Sector expansion: surface specialty sub-trades a literal keyword can't reach
  // (e.g. construction → the 238xxx family). Still award-grounded; merged in.
  const sectorKeywords = sectorSubTradeKeywords(keyword);
  if (sectorKeywords) {
    const [exN, exP] = await Promise.all([
      fetchCat(sectorKeywords, 'naics', 15),
      fetchCat(sectorKeywords, 'psc', 12),
    ]);
    return {
      naicsSuggestions: mergeDedupeCodes(primary.naicsSuggestions, exN, Math.max(maxResults, 10)),
      pscSuggestions: mergeDedupeCodes(primary.pscSuggestions, exP, Math.max(maxResults, 8)),
    };
  }
  return primary;
}

export async function POST(request: NextRequest): Promise<NextResponse<SuggestCodesResponse>> {
  try {
    const body = await request.json();
    const { description, maxResults = 5 } = body;

    // Allow short single-word industry queries ("drones", "HVAC", "janitorial")
    // — a 10-char minimum blocked legitimate keyword lookups (Eric: "drone does
    // nothing"). Just need 2+ chars of a real word.
    if (!description || typeof description !== 'string' || description.trim().length < 2) {
      return NextResponse.json({
        success: false,
        naicsSuggestions: [],
        pscSuggestions: [],
        error: 'Please enter what you want to research (e.g. "drones", "medical supplies").',
      }, { status: 400 });
    }

    // GROUND IN REAL DATA FIRST (Eric: "drone" → the LLM guessed Site Prep
    // Contractors; USASpending shows the REAL codes are 336411/334511/541715).
    // Query USASpending for the NAICS/PSC that ACTUALLY have spending under this
    // keyword, so suggestions are award-backed, not invented. LLM is the
    // fallback only when the keyword returns no awards.
    const grounded = await groundCodesFromUsaspending(description.trim(), maxResults);
    if (grounded && (grounded.naicsSuggestions.length > 0 || grounded.pscSuggestions.length > 0)) {
      return NextResponse.json({ success: true, source: 'usaspending', ...grounded });
    }

    const prompt = `You are a federal government contracting expert. A small business owner has described their services:

"${description.trim()}"

Based on this description, suggest the most appropriate NAICS codes and PSC (Product Service Codes) for federal contracting.

Use these reference codes:

NAICS CODES:
${NAICS_REFERENCE}

PSC CODES:
${PSC_REFERENCE}

Return a JSON object with:
1. naicsSuggestions: Array of ${maxResults} most relevant NAICS codes with:
   - code: The 6-digit NAICS code
   - name: The official NAICS name
   - confidence: "high", "medium", or "low" based on how well it matches
   - reason: Brief explanation (1 sentence) why this code fits

2. pscSuggestions: Array of ${maxResults} most relevant PSC codes with:
   - code: The 4-character PSC code
   - name: The official PSC name
   - confidence: "high", "medium", or "low" based on how well it matches
   - reason: Brief explanation (1 sentence) why this code fits

Important:
- Focus on the PRIMARY services described, not tangential ones
- Rank by relevance, with highest confidence codes first
- Only suggest codes that genuinely match the description
- If the description is too vague, explain in the reason field

Return ONLY valid JSON, no other text.`;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        naicsSuggestions: [],
        pscSuggestions: [],
        error: 'AI service not configured',
      }, { status: 500 });
    }

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a federal contracting classification expert. Return only valid JSON responses.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    });

    if (!response.ok) {
      console.error('[suggest-codes] Groq API error:', response.status, response.statusText);
      await logToolError({
        tool: ToolNames.CODE_SUGGESTIONS,
        errorType: response.status === 429 ? 'ai_rate_limit' : 'api_error',
        errorMessage: `Groq API error: ${response.status} ${response.statusText}`,
        requestPath: '/api/suggest-codes',
        aiProvider: AIProviders.GROQ,
        aiModel: GROQ_MODEL,
      });
      return NextResponse.json({
        success: false,
        naicsSuggestions: [],
        pscSuggestions: [],
        error: 'AI service error. Please try again.',
      }, { status: 500 });
    }

    const completion = await response.json();
    const responseText = completion.choices?.[0]?.message?.content || '';

    // Parse the JSON response
    let parsedResponse: { naicsSuggestions: CodeSuggestion[]; pscSuggestions: CodeSuggestion[] };

    try {
      // Clean up the response - remove markdown code blocks if present
      const cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      parsedResponse = JSON.parse(cleanedResponse);
    } catch {
      console.error('[suggest-codes] Failed to parse AI response:', responseText);
      return NextResponse.json({
        success: false,
        naicsSuggestions: [],
        pscSuggestions: [],
        error: 'Failed to parse AI response. Please try again.',
      }, { status: 500 });
    }

    // Validate the structure
    const naicsSuggestions = Array.isArray(parsedResponse.naicsSuggestions)
      ? parsedResponse.naicsSuggestions.slice(0, maxResults).map(s => ({
          code: String(s.code || ''),
          name: String(s.name || ''),
          confidence: ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium',
          reason: String(s.reason || ''),
        }))
      : [];

    const pscSuggestions = Array.isArray(parsedResponse.pscSuggestions)
      ? parsedResponse.pscSuggestions.slice(0, maxResults).map(s => ({
          code: String(s.code || ''),
          name: String(s.name || ''),
          confidence: ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium',
          reason: String(s.reason || ''),
        }))
      : [];

    // Record successful generation
    recordToolSuccess(ToolNames.CODE_SUGGESTIONS).catch(() => {});

    return NextResponse.json({
      success: true,
      naicsSuggestions,
      pscSuggestions,
    });

  } catch (error) {
    console.error('[suggest-codes] Error:', error);

    // Log error to monitoring dashboard
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate suggestions';
    await logToolError({
      tool: ToolNames.CODE_SUGGESTIONS,
      errorType: classifyError(errorMessage),
      errorMessage,
      requestPath: '/api/suggest-codes',
      aiProvider: AIProviders.GROQ,
      aiModel: GROQ_MODEL,
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json({
      success: false,
      naicsSuggestions: [],
      pscSuggestions: [],
      error: 'Failed to generate suggestions. Please try again.',
    }, { status: 500 });
  }
}

// GET endpoint to search PSC codes directly
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const type = searchParams.get('type') || 'both'; // 'naics', 'psc', or 'both'

  if (!query || query.trim().length < 2) {
    return NextResponse.json({
      success: false,
      error: 'Search query must be at least 2 characters',
      results: [],
    }, { status: 400 });
  }

  const searchTerm = query.toLowerCase().trim();
  const results: Array<{ type: 'naics' | 'psc'; code: string; name: string }> = [];

  // Search NAICS codes
  if (type === 'naics' || type === 'both') {
    const naicsLines = NAICS_REFERENCE.split('\n').filter(line => line.includes(' - '));
    for (const line of naicsLines) {
      const match = line.match(/^(\d{6})\s*-\s*(.+)$/);
      if (match) {
        const [, code, name] = match;
        if (code.includes(searchTerm) || name.toLowerCase().includes(searchTerm)) {
          results.push({ type: 'naics', code, name: name.trim() });
        }
      }
    }
  }

  // Search PSC codes
  if (type === 'psc' || type === 'both') {
    const pscLines = PSC_REFERENCE.split('\n').filter(line => line.includes(' - '));
    for (const line of pscLines) {
      const match = line.match(/^([A-Z0-9]{4})\s*-\s*(.+)$/);
      if (match) {
        const [, code, name] = match;
        if (code.toLowerCase().includes(searchTerm) || name.toLowerCase().includes(searchTerm)) {
          results.push({ type: 'psc', code, name: name.trim() });
        }
      }
    }
  }

  // Limit results
  const limitedResults = results.slice(0, 20);

  return NextResponse.json({
    success: true,
    query,
    count: limitedResults.length,
    results: limitedResults,
  });
}
