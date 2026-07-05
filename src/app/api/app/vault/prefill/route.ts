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
import { getNaics } from '@/lib/codes/lookup';
import { deriveSemanticKeywords } from '@/lib/market/semantic-keywords';
import { humanize } from '@/lib/proposal/humanize';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';
import { fetchUSASpendingAwardsByUei } from '@/lib/usaspending/awards-by-uei';

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
// fetchUSASpendingAwardsByUei now lives in @/lib/usaspending/awards-by-uei
// (shared with the capability-vector builder — CLAUDE.md rule #7).

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

interface NaicsWithDescription {
  code: string;
  description: string;
  isPrimary?: boolean;
}

async function draftAICoachContent(
  legal_name: string,
  naics: NaicsWithDescription[],
  certifications: string[],
): Promise<AICoachOutput | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[vault/prefill] GROQ_API_KEY missing; skipping AI coaching');
    return null;
  }
  if (naics.length === 0) return null;

  // Format NAICS with descriptions so the model can SEE what the
  // codes mean, not just pattern-match on the digits. Without
  // descriptions the model defaults 541xxx → "IT consulting" which
  // is wrong for management consulting / training / association firms.
  const naicsLines = naics.slice(0, 8).map(n =>
    `  ${n.code}${n.isPrimary ? ' (PRIMARY)' : ''} — ${n.description || '(no description)'}`
  ).join('\n');

  // RAG query uses NAICS descriptions, not codes. Code-only queries
  // ('541611 541612') don't match teaching content; descriptive text
  // ('management consulting training') does.
  const ragQuery = `capability statement company overview ${naics.slice(0, 3).map(n => n.description).filter(Boolean).join(' ')} ${certifications.join(' ')}`;
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

  const systemPrompt = `You are a senior federal capture writer drafting an INITIAL capability profile for a small business contractor who just registered with the platform. They have a SAM registration but may not have prior prime federal contracts. Your job is to give them a SHAPE — a starting draft they can edit — that reflects best practices for their actual NAICS mix.

CRITICAL — read the NAICS list LITERALLY:
- Each NAICS comes with its official description. Use the descriptions to understand what the firm actually does. Do NOT pattern-match on the code numbers alone.
- A firm with 541611 (Management Consulting) + 611430 (Training) + 813410 (Civic Organizations) is a MANAGEMENT CONSULTING / TRAINING / ASSOCIATION firm — NOT an IT firm. NEVER assume "IT" unless an actual IT-coded NAICS (541511, 541512, 541513, 541519) appears in the list.
- A firm with 541330 (Engineering Services) is an ENGINEERING firm, not an "IT services" firm.
- A firm with 541611 + 541612 + 541613 (HR/Marketing/Management consulting) is a MANAGEMENT CONSULTING firm, not "consulting" generically.
- Anchor your one-liner on what the FULL MIX of NAICS describes — read all of them, not just the first one.
- The legal name is also a strong signal. "GOVCON GIANTS INC" + management consulting + training NAICS = federal contracting training firm. Read the name carefully.

Output rules:
- Respond with a JSON object only, no commentary.
- Fields: one_liner, elevator_pitch, capabilities (array of {capability_name, description, evidence}), sample_past_performance (array of {contract_title, agency, contract_value, scope_description, coaching_note}).
- one_liner: ≤12 words, plain English, no fluff, accurately reflects the NAICS mix.
- elevator_pitch: 2-3 sentences, captures what the firm does + why an agency would pick them. Grounded in the actual NAICS descriptions.
- capabilities: 4-5 entries, each a SPECIFIC capability tied to one of their NAICS descriptions, in their voice, NOT marketing speak.
- sample_past_performance: 3 entries. Each is a STARTING TEMPLATE with [bracketed placeholders] showing the user what good past perf looks like for THEIR NAICS mix — coaching_note explains what they should fill in. DO NOT invent specific contracts. Use [placeholders] for everything specific.
- NO marketing fluff: no "world-class", "best-in-class", "cutting-edge", "synergistic", "innovative solutions".
- NEVER add "IT" or "technology" framing unless an IT-coded NAICS is actually present.`;

  const userPrompt = `Bidder context:
- Legal name: ${legal_name}
- Certifications: ${certifications.join(', ') || 'none on file'}

NAICS registered with SAM (read each description carefully — do NOT pattern-match on code numbers alone):
${naicsLines}

${ragBlock}

Draft an initial capability profile that accurately reflects the NAICS MIX above. JSON only.`;

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
    // safeParseJSON tolerates the LLM wrapping JSON in code fences,
    // prepending prose ('Sure, here is...'), or emitting trailing
    // commas. Falls back to {} so the user still gets identity even
    // if the coach section fails.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = safeParseJSON<any>(content, {
      fallback: {},
      source: 'vault.prefill.aiCoach',
    });
    // Run humanization on each string field to strip LLM tells
    // ("world-class", em-dash overuse, generic intros). Same processor
    // used by Proposal Assist v2.
    return {
      one_liner: humanize(parsed.one_liner || ''),
      elevator_pitch: humanize(parsed.elevator_pitch || ''),
      capabilities: (Array.isArray(parsed.capabilities) ? parsed.capabilities.slice(0, 5) : []).map((c: { capability_name?: string; description?: string; evidence?: string }) => ({
        capability_name: humanize(c.capability_name || ''),
        description: humanize(c.description || ''),
        evidence: c.evidence ? humanize(c.evidence) : undefined,
      })),
      sample_past_performance: (Array.isArray(parsed.sample_past_performance) ? parsed.sample_past_performance.slice(0, 3) : []).map((p: { contract_title?: string; agency?: string; contract_value?: string; scope_description?: string; coaching_note?: string }) => ({
        contract_title: p.contract_title || '',
        agency: p.agency || '',
        contract_value: p.contract_value || '',
        scope_description: humanize(p.scope_description || ''),
        coaching_note: p.coaching_note || '',
      })),
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

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
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

  // Build NAICS-with-descriptions list for the AI coach. Prefer SAM's
  // returned description, fall back to our local NAICS cache for codes
  // where SAM didn't surface one (happens occasionally for older codes).
  const naicsWithDescriptions: NaicsWithDescription[] = (entity.naicsList || []).map(n => {
    const samDesc = (n.naicsDescription || '').trim();
    const cacheEntry = !samDesc ? getNaics(n.naicsCode) : null;
    return {
      code: n.naicsCode,
      description: samDesc || cacheEntry?.title || '',
      isPrimary: n.isPrimary,
    };
  });

  // Now run the AI coaching pass — RAG-grounded capability draft.
  // We run this AFTER SAM so we can feed real NAICS descriptions +
  // certifications into the prompt. Failure is non-blocking; user
  // still gets identity + USASpending past perf if AI is down.
  const ai_coach = identity
    ? await draftAICoachContent(
        identity.legal_name,
        naicsWithDescriptions,
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

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
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
    // DEDUP: don't re-add capabilities the user already has. Without this,
    // re-running prefill .insert()s another full batch — that's how a 5-cap
    // draft became 10 (one IT-themed run + one consulting-themed run stacked).
    // Match case-insensitively on capability_name.
    const { data: existingCaps } = await supabase
      .from('user_capabilities_library')
      .select('capability_name')
      .eq('user_email', userEmail)
      .is('archived_at', null);
    const haveCap = new Set(
      (existingCaps || []).map((r: { capability_name: string }) => (r.capability_name || '').trim().toLowerCase()),
    );
    const rows = capabilities
      .map((c) => ({
        user_email: userEmail,
        capability_name: (c.capability_name as string)?.slice(0, 200) || 'Untitled capability',
        description: (c.description as string)?.slice(0, 2000) || '',
        evidence: (c.evidence as string)?.slice(0, 1000) || null,
        related_naics: [],
        keywords: [],
        tools_methods: [],
      }))
      .filter((r) => !haveCap.has(r.capability_name.trim().toLowerCase()));
    if (rows.length > 0) {
      const { error: capErr } = await supabase
        .from('user_capabilities_library')
        .insert(rows);
      if (capErr) errors.push(`capabilities: ${capErr.message}`);
      else capabilitiesWritten = rows.length;
    }
  }

  // ---- AI-drafted sample past performance (with [placeholders]) ----
  // These are TEMPLATES the user edits in — different from imported
  // USASpending rows. We tag source='ai_coach_sample' so the UI can
  // surface a "this is a starter — edit in your real details" hint.
  if (samplePastPerformance.length > 0) {
    // DEDUP: skip if the user already has any ai_coach_sample rows — re-running
    // prefill should not stack another set of placeholder templates.
    const { count: existingSamples } = await supabase
      .from('user_past_performance')
      .select('*', { count: 'exact', head: true })
      .eq('user_email', userEmail)
      .eq('source', 'ai_coach_sample')
      .is('archived_at', null);
    if (!existingSamples || existingSamples === 0) {
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
  }

  // ---- Semantic keywords from the imported identity (the keyword-gap fix) ----
  // UEI autofill gives NAICS + PSC but ZERO keywords, so profiles match NAICS-only
  // and miss body-buried opps. Derive keywords BY MEANING from the company's own
  // words (past-perf scope + capabilities + NAICS titles + AI summary) and SEED
  // alerts — additively, never clobbering tuned keywords. Returned so the Vault can
  // show them + teach the gap. Non-fatal: a derivation failure never breaks prefill.
  let keywordsDerived: string[] = [];
  try {
    const naicsArr = Array.isArray(identity?.primary_naics) ? (identity!.primary_naics as string[]) : [];
    const derived = await deriveSemanticKeywords({
      oneLiner: (identity?.one_liner as string) || null,
      elevatorPitch: (identity?.elevator_pitch as string) || null,
      capabilities: capabilities.map((c) =>
        `${c.capability_name || ''} ${c.description || ''}`.trim(),
      ).filter(Boolean),
      naicsDescriptions: naicsArr.map((n) => getNaics(String(n))?.title || '').filter(Boolean),
      scopeDescriptions: pastPerformance
        .map((p) => (p.scope_description as string) || '')
        .filter(Boolean),
    }, 12);

    if (derived.length > 0) {
      keywordsDerived = derived;
      // Additive merge into user_notification_settings.keywords (never clobber).
      const { data: cur } = await supabase
        .from('user_notification_settings')
        .select('keywords')
        .eq('user_email', userEmail)
        .maybeSingle();
      const existing = Array.isArray(cur?.keywords)
        ? cur!.keywords.map((k: unknown) => String(k).toLowerCase().trim()).filter(Boolean)
        : [];
      const merged = Array.from(new Set([...existing, ...derived])).slice(0, 40);
      if (merged.length > existing.length) {
        await supabase
          .from('user_notification_settings')
          .upsert(
            { user_email: userEmail, keywords: merged, updated_at: new Date().toISOString() },
            { onConflict: 'user_email' },
          );
      }
    }
  } catch (kwErr) {
    errors.push(`keywords (non-fatal): ${kwErr instanceof Error ? kwErr.message : 'derive failed'}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    identity_written: identityWritten,
    past_performance_written: pastPerfWritten,
    capabilities_written: capabilitiesWritten,
    sample_pp_written: samplePpWritten,
    keywords_derived: keywordsDerived,
    errors,
  });
}
