/**
 * Day 0 Vault Pre-Fill
 *
 * Given a UEI, fetch:
 *   1. SAM.gov Entity → Identity fields (legal name, CAGE, NAICS,
 *      certifications, HQ address, vehicles)
 *   2. USASpending past awards → 20 most recent contracts as
 *      past_performance entries
 *
 * Returns a preview the user reviews + accepts before we write to vault.
 * That review step is intentional — auto-importing without confirmation
 * means we'd dump questionable mid-confidence data into the user's
 * private vault, eroding trust. Always show + confirm.
 *
 * Two modes:
 *   GET  ?uei=XXX&email=YYY        — Preview (no writes)
 *   POST { uei, email, accept: { identity, past_performance } } — Write
 *
 * Built 2026-05-26 to kill the "empty vault on Day 0" friction.
 * Marketing positioning: "From signup to first AI-grounded draft in
 * 60 seconds — no setup."
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { getEntityByUEI } from '@/lib/sam/entity-api';
import { retrieveRagContext, formatChunksForPrompt } from '@/lib/rag/retrieve';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

// ---- USASpending awards-by-UEI ------------------------------------
// Live REST call (not the cached usaspending_awards table) because we
// want immediate results on signup, not waiting for our nightly sync.
// Live API is unrate-limited per their docs.

interface AwardRow {
  award_id: string;
  contract_title: string;
  agency: string | null;
  sub_agency: string | null;
  contract_number: string | null;
  period_start: string | null;
  period_end: string | null;
  contract_value: number | null;
  scope_description: string | null;
  naics: string | null;
  naics_description: string | null;
  psc: string | null;
}

async function fetchUSASpendingAwardsByUei(uei: string, limit = 25): Promise<AwardRow[]> {
  // POST to spending_by_award with recipient_uei filter
  try {
    const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          recipient_search_text: [uei],
          // Contract awards only (no IDVs at this stage — they're
          // umbrellas, not individual past perf citations)
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: '2018-10-01', end_date: '2026-09-30' }],
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Recipient UEI',
          'Award Amount',
          'Description',
          'Start Date',
          'End Date',
          'Awarding Agency',
          'Awarding Sub Agency',
          'NAICS Code',
          'NAICS',
          'PSC Code',
          'Last Modified Date',
        ],
        page: 1,
        limit,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });

    if (!res.ok) {
      console.warn(`[vault/prefill] USASpending ${res.status}`);
      return [];
    }
    const data = await res.json();
    const results = (data?.results || []) as Record<string, unknown>[];

    // Filter to ONLY rows where the recipient UEI matches exactly.
    // recipient_search_text is a fuzzy search — different recipients
    // can share name fragments, so we hard-filter post-fetch.
    return results
      .filter((r) => String(r['Recipient UEI'] || '').toUpperCase() === uei.toUpperCase())
      .map((r) => ({
        award_id: String(r['Award ID'] || ''),
        contract_title: String(r['Description'] || r['Award ID'] || '').slice(0, 200),
        agency: (r['Awarding Agency'] as string) || null,
        sub_agency: (r['Awarding Sub Agency'] as string) || null,
        contract_number: (r['Award ID'] as string) || null,
        period_start: (r['Start Date'] as string) || null,
        period_end: (r['End Date'] as string) || null,
        contract_value: Number(r['Award Amount']) || null,
        scope_description: r['Description'] ? String(r['Description']).slice(0, 1000) : null,
        naics: (r['NAICS Code'] as string) || (r['NAICS'] as string) || null,
        naics_description: null,
        psc: (r['PSC Code'] as string) || null,
      }));
  } catch (err) {
    console.error('[vault/prefill] USASpending fetch failed:', err);
    return [];
  }
}

// ---- AI capability draft (RAG-grounded) ----------------------------
//
// For SAM-registered users with NO USASpending past performance (the
// 50% segment that's most underserved), draft a one-liner + elevator
// pitch + 3-5 capabilities + 3 sample PP entries with [placeholders]
// using the GovCon corpus + user's NAICS for grounding.
//
// Why: most users see an empty vault and bounce. Showing them a
// coached SHAPE of what a strong profile looks like, with their real
// company data already in it, is the difference between activation
// and abandonment.

interface AICoachOutput {
  one_liner: string;
  elevator_pitch: string;
  capabilities: { capability_name: string; description: string; evidence?: string }[];
  sample_past_performance: {
    contract_title: string;
    agency: string;
    contract_value: string;  // string because contains [placeholders]
    scope_description: string;
    coaching_note: string;  // "Fill in with a real Navy IT contract you've delivered"
  }[];
}

async function draftAICoachContent(
  legal_name: string,
  primary_naics: string[],
  certifications: string[],
): Promise<AICoachOutput | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[vault/prefill] GROQ_API_KEY missing; skipping AI coaching');
    return null;
  }
  if (primary_naics.length === 0) return null;

  // Pull RAG context grounded in the user's NAICS + 'capability statement'
  const ragQuery = `capability statement company overview past performance ${primary_naics.slice(0, 3).join(' ')} ${certifications.join(' ')}`;
  const chunks = await retrieveRagContext({
    query: ragQuery,
    docTypes: ['cap_statement', 'proposal_template', 'course_material', 'teaching_handout'],
    limit: 3,
    maxChars: 2500,
    maxPerDoc: 1,
  }).catch(() => []);

  const ragBlock = chunks.length > 0
    ? `### GovCon Giants curriculum — STYLE references (do NOT copy verbatim):\n${formatChunksForPrompt(chunks)}\n`
    : '';

  const systemPrompt = `You are a senior federal capture writer drafting an INITIAL capability profile for a small business contractor who just registered with the platform. They have a SAM registration but may not have prior prime federal contracts. Your job is to give them a SHAPE — a starting draft they can edit — that reflects best practices for their NAICS.

Output rules:
- Respond with a JSON object only, no commentary.
- Fields: one_liner, elevator_pitch, capabilities (array of {capability_name, description, evidence}), sample_past_performance (array of {contract_title, agency, contract_value, scope_description, coaching_note}).
- one_liner: ≤12 words, plain English, no fluff ("AI-powered cybersecurity for federal" not "world-class cybersecurity solutions").
- elevator_pitch: 2-3 sentences, captures what the firm does + why an agency would pick them.
- capabilities: 4-5 entries, each a SPECIFIC capability tied to their NAICS, in their voice, NOT marketing speak.
- sample_past_performance: 3 entries. Each is a STARTING TEMPLATE with [bracketed placeholders] showing the user what good past perf looks like — coaching_note explains what they should fill in. DO NOT invent specific contracts. Use [placeholders] for everything specific.
- NO marketing fluff: no "world-class", "best-in-class", "cutting-edge", "synergistic", "innovative solutions".`;

  const userPrompt = `Bidder context:
- Legal name: ${legal_name}
- Primary NAICS: ${primary_naics.slice(0, 5).join(', ')}
- Certifications: ${certifications.join(', ') || 'none on file'}

${ragBlock}

Draft an initial capability profile. JSON only.`;

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      console.warn(`[vault/prefill] Groq AI coach ${res.status}`);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return {
      one_liner: parsed.one_liner || '',
      elevator_pitch: parsed.elevator_pitch || '',
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.slice(0, 5) : [],
      sample_past_performance: Array.isArray(parsed.sample_past_performance) ? parsed.sample_past_performance.slice(0, 3) : [],
    };
  } catch (err) {
    console.error('[vault/prefill] AI coach failed:', err);
    return null;
  }
}

// ---- Map SAM Entity → vault Identity shape ------------------------
function mapEntityToIdentity(entity: Awaited<ReturnType<typeof getEntityByUEI>>) {
  if (!entity) return null;

  const certs: string[] = [];
  if (entity.has8a) certs.push('8(a)');
  if (entity.hasSDVOSB) certs.push('SDVOSB');
  if (entity.hasWOSB) certs.push('WOSB');
  if (entity.hasHUBZone) certs.push('HUBZone');
  // Pull anything else surfaced under sbaBusinessTypes that we didn't catch above
  for (const t of entity.certifications?.sbaBusinessTypes || []) {
    if (t && !certs.includes(t)) certs.push(t);
  }

  const naicsAll = (entity.naicsList || []).map((n) => n.naicsCode).filter(Boolean);
  const primary = (entity.naicsList || []).find((n) => n.isPrimary)?.naicsCode;
  const primaryNaics = primary
    ? [primary, ...naicsAll.filter((n) => n !== primary)]
    : naicsAll;

  return {
    uei: entity.ueiSAM,
    cage_code: entity.cageCode || null,
    legal_name: entity.legalBusinessName,
    dba: entity.dbaName || null,
    certifications: certs,
    primary_naics: primaryNaics.slice(0, 10),
    hq_city: entity.physicalAddress?.city || null,
    hq_state: entity.physicalAddress?.stateOrProvince || null,
    // Service states defaults to HQ state — user can expand later
    service_states: entity.physicalAddress?.stateOrProvince
      ? [entity.physicalAddress.stateOrProvince]
      : [],
    contract_vehicles: [],  // Not exposed in entity API
  };
}

// ---- GET — preview --------------------------------------------------
export async function GET(request: NextRequest) {
  const uei = (request.nextUrl.searchParams.get('uei') || '').trim().toUpperCase();
  const email = (request.nextUrl.searchParams.get('email') || '').trim();

  if (!uei || uei.length !== 12) {
    return NextResponse.json({ success: false, error: 'Valid 12-character UEI required' }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // Run SAM + USASpending in parallel
  const [entity, awards] = await Promise.all([
    getEntityByUEI(uei).catch((err) => {
      console.error('[vault/prefill] SAM lookup failed:', err);
      return null;
    }),
    fetchUSASpendingAwardsByUei(uei, 25),
  ]);

  if (!entity) {
    return NextResponse.json({
      success: false,
      error: `No SAM.gov registration found for UEI ${uei}. Check the UEI or register at sam.gov first.`,
    }, { status: 404 });
  }

  const identity = mapEntityToIdentity(entity);
  const past_performance = awards.slice(0, 20);

  // Now run the AI coaching pass — RAG-grounded capability draft.
  // We run this AFTER SAM so we can feed real NAICS + certifications
  // into the prompt. Failure is non-blocking; user still gets identity
  // + USASpending past perf if AI is down.
  const ai_coach = identity
    ? await draftAICoachContent(
        identity.legal_name,
        identity.primary_naics,
        identity.certifications,
      )
    : null;

  return NextResponse.json({
    success: true,
    source: {
      sam_entity: true,
      usaspending: awards.length > 0,
      ai_coach: ai_coach !== null,
    },
    identity: identity ? {
      ...identity,
      // Layer the AI one-liner + pitch onto identity so users see
      // a populated profile, not just blank text fields.
      one_liner: ai_coach?.one_liner || null,
      elevator_pitch: ai_coach?.elevator_pitch || null,
    } : null,
    past_performance,
    capabilities: ai_coach?.capabilities || [],
    sample_past_performance: ai_coach?.sample_past_performance || [],
    summary: {
      sam_registration_status: entity.registrationStatus,
      sam_active: entity.isActive,
      contracts_found: awards.length,
      total_value: awards.reduce((acc, a) => acc + (a.contract_value || 0), 0),
      capabilities_drafted: ai_coach?.capabilities.length || 0,
      sample_pp_drafted: ai_coach?.sample_past_performance.length || 0,
    },
  });
}

// ---- POST — write to vault ------------------------------------------
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const uei = String(body.uei || '').trim().toUpperCase();
  const identity = body.identity as Record<string, unknown> | undefined;
  const pastPerformance = (body.past_performance as Array<Record<string, unknown>>) || [];
  const capabilities = (body.capabilities as Array<Record<string, unknown>>) || [];
  const samplePastPerformance = (body.sample_past_performance as Array<Record<string, unknown>>) || [];

  if (!email || !uei) {
    return NextResponse.json({ success: false, error: 'email and uei required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userEmail = auth.email!;
  const supabase = getSupabase();

  let identityWritten = false;
  let pastPerfWritten = 0;
  let capabilitiesWritten = 0;
  let samplePpWritten = 0;
  const errors: string[] = [];

  // ---- Identity (upsert by user_email primary key) ----
  if (identity) {
    const cleanIdentity: Record<string, unknown> = { user_email: userEmail, updated_at: new Date().toISOString() };
    const WRITABLE_IDENTITY = [
      'uei', 'cage_code', 'legal_name', 'dba',
      'certifications', 'primary_naics',
      'hq_city', 'hq_state', 'service_states',
      'contract_vehicles',
      'one_liner', 'elevator_pitch',  // From AI coach
    ];
    for (const k of WRITABLE_IDENTITY) {
      if (k in identity) cleanIdentity[k] = identity[k];
    }
    const { error: idErr } = await supabase
      .from('user_identity_profile')
      .upsert(cleanIdentity, { onConflict: 'user_email' });
    if (idErr) {
      errors.push(`identity: ${idErr.message}`);
    } else {
      identityWritten = true;
    }
  }

  // ---- Real past performance from USASpending ----
  if (pastPerformance.length > 0) {
    const numbers = pastPerformance
      .map((p) => (p.contract_number as string) || (p.award_id as string))
      .filter(Boolean);
    let existingNumbers = new Set<string>();
    if (numbers.length > 0) {
      const { data: existing } = await supabase
        .from('user_past_performance')
        .select('contract_number')
        .eq('user_email', userEmail)
        .in('contract_number', numbers);
      existingNumbers = new Set((existing || []).map((r: { contract_number: string }) => r.contract_number));
    }
    const rows = pastPerformance
      .filter((p) => {
        const num = (p.contract_number as string) || (p.award_id as string);
        return !num || !existingNumbers.has(num);
      })
      .map((p) => ({
        user_email: userEmail,
        contract_title: (p.contract_title as string) || 'Imported contract',
        contract_number: (p.contract_number as string) || null,
        agency: (p.agency as string) || 'Unknown',
        sub_agency: (p.sub_agency as string) || null,
        period_start: (p.period_start as string) || null,
        period_end: (p.period_end as string) || null,
        contract_value: (p.contract_value as number) || null,
        role: 'prime',
        scope_description: (p.scope_description as string) || null,
        naics_codes: p.naics ? [p.naics as string] : [],
        relevance_keywords: [],
        source: 'usaspending_import',
      }));
    if (rows.length > 0) {
      const { error: ppErr } = await supabase
        .from('user_past_performance')
        .insert(rows);
      if (ppErr) errors.push(`past_performance: ${ppErr.message}`);
      else pastPerfWritten = rows.length;
    }
  }

  // ---- AI-drafted capabilities (with marker so user knows they're starters) ----
  if (capabilities.length > 0) {
    const rows = capabilities.map((c) => ({
      user_email: userEmail,
      capability_name: (c.capability_name as string)?.slice(0, 200) || 'Untitled capability',
      description: (c.description as string)?.slice(0, 2000) || '',
      evidence: (c.evidence as string)?.slice(0, 1000) || null,
      related_naics: [],
      keywords: [],
      tools_methods: [],
    }));
    const { error: capErr } = await supabase
      .from('user_capabilities_library')
      .insert(rows);
    if (capErr) errors.push(`capabilities: ${capErr.message}`);
    else capabilitiesWritten = rows.length;
  }

  // ---- AI-drafted sample past performance (with [placeholders]) ----
  // These are TEMPLATES the user edits in — different from imported
  // USASpending rows. We tag source='ai_coach_sample' so the UI can
  // surface a "this is a starter — edit in your real details" hint.
  if (samplePastPerformance.length > 0) {
    const rows = samplePastPerformance.map((p) => ({
      user_email: userEmail,
      contract_title: (p.contract_title as string)?.slice(0, 200) || '[Contract Title]',
      contract_number: null,
      agency: (p.agency as string)?.slice(0, 100) || '[Agency]',
      sub_agency: null,
      period_start: null,
      period_end: null,
      contract_value: null,  // String placeholder values can't go in numeric column
      role: 'prime',
      scope_description: ((p.scope_description as string) + (p.coaching_note ? `\n\n📝 ${p.coaching_note}` : '')).slice(0, 2000),
      naics_codes: [],
      relevance_keywords: [],
      source: 'ai_coach_sample',
    }));
    const { error: spErr } = await supabase
      .from('user_past_performance')
      .insert(rows);
    if (spErr) errors.push(`sample_past_performance: ${spErr.message}`);
    else samplePpWritten = rows.length;
  }

  return NextResponse.json({
    success: errors.length === 0,
    identity_written: identityWritten,
    past_performance_written: pastPerfWritten,
    capabilities_written: capabilitiesWritten,
    sample_pp_written: samplePpWritten,
    errors,
  });
}
