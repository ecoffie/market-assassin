/**
 * Shared context loaders for Proposal Assist (used by both v1 and v2).
 *
 * Extracted from src/app/api/app/proposal/draft/route.ts so v2 can
 * compose them differently without copy-paste.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BidderProfile, VaultContext, SectionType } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// ---- Stub / placeholder detection ----------------------------------
//
// The vault onboarding seeds TEMPLATE rows so a user has something to edit:
// "[Contract Title] — [Agency Name]", "[Briefly describe the scope...]", with a
// "📝 Fill in..." nudge. If the user never fills them, the rows still COUNT as
// present — the 94-char-stub trap. Feeding them to the model is worse than an
// empty vault: it either cites "[Contract Title]" (a fabrication) or, seeing
// junk, writes vague prose. So we detect stub text and treat it as absent.

const STUB_MARKERS = [/\[[^\]]+\]/, /📝/, /\bfill in\b/i, /\byour\b.*\bhere\b/i];

/** True if a string is empty or template-placeholder text (not real content). */
export function isStubValue(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  const t = v.trim();
  if (!t) return true;
  // Mostly-bracketed text ("[Contract Title] — [Agency Name]") or an explicit
  // fill-in nudge → a stub. A real value may MENTION a bracket, so require the
  // brackets/markers to dominate or an explicit nudge.
  if (STUB_MARKERS.some(re => re.test(t))) {
    const bracketed = (t.match(/\[[^\]]*\]/g) || []).join('');
    // Explicit nudge, or brackets make up a large share of the text → stub.
    if (/📝|\bfill in\b/i.test(t)) return true;
    if (bracketed.length >= t.length * 0.4) return true;
  }
  return false;
}

/**
 * True if a vault row carries no REAL content — its identifying fields are all
 * stubs. Past-performance: title + agency. Capability: name + description.
 */
export function isStubRow(row: Record<string, unknown>): boolean {
  const title = row.contract_title ?? row.project_name ?? row.engagement_name ?? row.capability_name;
  const body = row.scope_description ?? row.outcomes ?? row.description;
  // A row is real if EITHER its title or its body is non-stub. Both stub → drop.
  return isStubValue(title) && isStubValue(body);
}

/** Drop stub rows from an array; returns only rows with real content. */
export function filterRealRows<T extends Record<string, unknown>>(rows: T[] | null | undefined): T[] {
  return (rows || []).filter(r => !isStubRow(r));
}

// ---- Bidder profile (NAICS / agencies / set-asides) ----------------

export async function loadBidderProfile(email: string): Promise<BidderProfile> {
  try {
    const supabase = getSupabase();
    // NOTE: `company_name` is NOT a column on user_notification_settings — it
    // used to be in this SELECT, which made PostgREST fail the WHOLE query
    // (error, data=null) and silently return {} for EVERY user. That starved
    // the chat/proposal personalization of the user's real NAICS/set-asides.
    // Company name lives in the Vault (user_identity_profile), not here.
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, business_type, agencies, set_aside_preferences, location_states')
      .eq('user_email', email)
      .maybeSingle();
    // Surface the error instead of swallowing it — a bad column here should be
    // loud, not a silent empty profile (that's how the company_name bug hid).
    if (error) {
      console.error('[proposal/loaders] bidder profile query error:', error.message);
      return {};
    }
    if (!data) return {};
    return {
      businessType: data.business_type || undefined,
      naicsCodes: Array.isArray(data.naics_codes) ? data.naics_codes : [],
      agencies: Array.isArray(data.agencies) ? data.agencies : [],
      setAsides: Array.isArray(data.set_aside_preferences) ? data.set_aside_preferences : [],
      locationStates: Array.isArray(data.location_states) ? data.location_states : [],
    };
  } catch (err) {
    console.error('[proposal/loaders] profile lookup failed:', err);
    return {};
  }
}

export function formatProfileForPrompt(profile: BidderProfile): string {
  const parts: string[] = [];
  if (profile.companyName) parts.push(`Company: ${profile.companyName}`);
  if (profile.businessType) parts.push(`Business type: ${profile.businessType}`);
  if (profile.naicsCodes?.length) parts.push(`NAICS: ${profile.naicsCodes.slice(0, 8).join(', ')}`);
  if (profile.setAsides?.length) parts.push(`Set-aside certs: ${profile.setAsides.join(', ')}`);
  if (profile.agencies?.length) parts.push(`Target agencies: ${profile.agencies.slice(0, 6).join(', ')}`);
  if (profile.locationStates?.length) parts.push(`Locations: ${profile.locationStates.join(', ')}`);
  return parts.length > 0
    ? parts.join('\n')
    : 'No saved profile — write generically with [Company name] placeholders.';
}

// ---- Vault context (identity + past perf + capabilities + team) ----

export async function loadVaultContext(email: string, sectionType: SectionType): Promise<VaultContext> {
  const supabase = getSupabase();
  const ctx: VaultContext = { has_any: false };

  // Same per-section narrowing as v1 — only load what THIS section uses.
  const needsIdentity = true;
  // Why Us (differentiators) and LOI Opening (company_overview) are EVIDENCE
  // sections — they argue "why this firm fits" and must cite real contracts,
  // not just capabilities. They previously loaded only capabilities, so a vault
  // WITH past performance still got vague "proven track record" prose because
  // the contracts were never put in front of the model. (Eval: Why Us 68, LOI
  // Opening 67 — the two lowest.)
  const needsPastPerf = sectionType === 'past_performance' || sectionType === 'cap_past_performance' || sectionType === 'exec_summary' || sectionType === 'differentiators' || sectionType === 'company_overview';
  const needsCapabilities = sectionType === 'capabilities' || sectionType === 'technical' || sectionType === 'differentiators' || sectionType === 'company_overview';
  const needsTeam = sectionType === 'management' || sectionType === 'poc';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queries: any[] = [];
  if (needsIdentity) {
    queries.push(supabase.from('user_identity_profile').select('*').eq('user_email', email).maybeSingle());
  }
  if (needsPastPerf) {
    queries.push(supabase.from('user_past_performance')
      .select('contract_title, agency, sub_agency, office, contract_number, period_start, period_end, contract_value, role, scope_description, outcomes, cpars_rating, reference_name, reference_phone, relevance_keywords, naics_codes')
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
  // Surface any query error (e.g. a stale column) instead of silently reading it
  // as an empty Vault — the same swallowed-error trap that hid the company_name
  // bug in loadBidderProfile. Behaviour is unchanged (still degrades to empty),
  // but a broken query is now loud.
  type QResult = { data: unknown; error: { message?: string } | null };
  const take = (label: string): unknown => {
    const r = results[idx++] as QResult;
    if (r?.error) console.error(`[proposal/loaders] vault ${label} query error:`, r.error.message);
    return r?.data;
  };
  if (needsIdentity)     { ctx.identity = take('identity') as Record<string, unknown> | null; }
  if (needsPastPerf)     { ctx.past_performance = (take('past_performance') as Array<Record<string, unknown>> | null) || []; }
  if (needsCapabilities) { ctx.capabilities = (take('capabilities') as Array<Record<string, unknown>> | null) || []; }
  if (needsTeam)         { ctx.team = (take('team') as Array<Record<string, unknown>> | null) || []; }

  const identityHas = ctx.identity && Object.entries(ctx.identity).some(([k, v]) =>
    k !== 'user_email' && k !== 'created_at' && k !== 'updated_at' &&
    v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  ctx.has_any = Boolean(identityHas) || (ctx.past_performance?.length ?? 0) > 0 || (ctx.capabilities?.length ?? 0) > 0 || (ctx.team?.length ?? 0) > 0;

  return ctx;
}

// Format a stored money value as clean, citable currency. Two shapes reach here:
//  - a bare number ("15000000") → "$15,000,000"
//  - a human string carrying a magnitude word ("$25 Million") → must NOT be
//    truncated to "$25" (the old bug: stripping non-digits killed "Million").
//    We expand the magnitude to a full number so the model can phrase it.
function fmtMoney(v: unknown): string | null {
  if (v == null || v === '') return null;
  const raw = String(v).trim();
  const numMatch = raw.replace(/,/g, '').match(/([\d.]+)/);
  if (!numMatch) return null;
  let n = Number(numMatch[1]);
  if (!Number.isFinite(n) || n <= 0) return raw || null;
  // Expand a trailing magnitude word so "$25 Million" → 25,000,000.
  if (/\bthousand\b|\bk\b/i.test(raw)) n *= 1e3;
  else if (/\bmillion\b|\bmm?\b/i.test(raw)) n *= 1e6;
  else if (/\bbillion\b|\bb\b/i.test(raw)) n *= 1e9;
  return `$${n.toLocaleString('en-US')}`;
}

export function formatVaultForPrompt(ctx: VaultContext): string {
  if (!ctx.has_any) return '';
  const blocks: string[] = [];

  if (ctx.identity) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = ctx.identity as any;
    const lines: string[] = [];
    if (id.legal_name) lines.push(`Legal name: ${id.legal_name}`);
    if (id.dba) lines.push(`DBA: ${id.dba}`);
    if (id.uei) lines.push(`UEI: ${id.uei}`);
    if (id.cage_code) lines.push(`CAGE: ${id.cage_code}`);
    if (id.ein) lines.push(`EIN: ${id.ein}`);
    if (id.year_founded) lines.push(`Founded: ${id.year_founded}`);
    if (id.employee_count) lines.push(`Employees: ${id.employee_count}`);
    if (Array.isArray(id.certifications) && id.certifications.length) lines.push(`Certifications: ${id.certifications.join(', ')}`);
    if (Array.isArray(id.primary_naics) && id.primary_naics.length) lines.push(`Primary NAICS: ${id.primary_naics.join(', ')}`);
    if (id.one_liner) lines.push(`One-liner: ${id.one_liner}`);
    if (id.elevator_pitch) lines.push(`Elevator pitch: ${id.elevator_pitch}`);
    if (id.hq_state || id.hq_city) lines.push(`HQ: ${[id.hq_city, id.hq_state].filter(Boolean).join(', ')}`);
    if (id.office_address) lines.push(`Office address: ${id.office_address}`);
    if (Array.isArray(id.service_states) && id.service_states.length) lines.push(`Service states: ${id.service_states.join(', ')}`);
    if (Array.isArray(id.contract_vehicles) && id.contract_vehicles.length) lines.push(`Contract vehicles: ${id.contract_vehicles.join(', ')}`);
    if (fmtMoney(id.bonding_single)) lines.push(`Single bonding capacity: ${fmtMoney(id.bonding_single)}`);
    if (fmtMoney(id.bonding_aggregate)) lines.push(`Aggregate bonding capacity: ${fmtMoney(id.bonding_aggregate)}`);
    if (fmtMoney(id.annual_revenue)) lines.push(`Annual revenue: ${fmtMoney(id.annual_revenue)}`);
    // Point of contact (#41) — fills cert-package "Responsible Office / Contact
    // Person" + Point-of-Contact sections instead of [placeholders].
    if (id.contact_name) lines.push(`Contact person: ${id.contact_name}${id.contact_title ? `, ${id.contact_title}` : ''}`);
    if (id.contact_phone) lines.push(`Contact phone: ${id.contact_phone}`);
    if (id.contact_email) lines.push(`Contact email: ${id.contact_email}`);
    if (id.website) lines.push(`Website: ${id.website}`);
    if (lines.length) blocks.push(`### Bidder identity (FACTUAL — use verbatim)\n${lines.join('\n')}`);
  }

  const realPastPerf = filterRealRows(ctx.past_performance);
  if (realPastPerf.length) {
    const lines = realPastPerf.map((p, i) => {
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

    // Aggregate total — so a draft can say "across N projects totaling $X" with a
    // REAL number instead of bracketing "[amount]illion" when the per-contract
    // values are all present. Only stated when enough contracts carry a value that
    // the sum is meaningful (avoids a misleadingly small "total" from one priced
    // row among many). The model still cites individual values per contract above.
    let totalLine = '';
    const valued = realPastPerf
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p) => Number((p as any).contract_value))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (valued.length >= 2 && valued.length >= realPastPerf.length * 0.5) {
      const sum = valued.reduce((a, b) => a + b, 0);
      totalLine = `\n\nAggregate portfolio value across the ${valued.length} priced contract${valued.length === 1 ? '' : 's'} above: $${sum.toLocaleString('en-US')} (a REAL figure — use it instead of a [placeholder] when summarizing total experience; do not round it up).`;
    }
    blocks.push(`### Bidder past performance (FACTUAL — cite these, not [placeholders])\n${lines}${totalLine}`);
  }

  const realCaps = filterRealRows(ctx.capabilities);
  if (realCaps.length) {
    const lines = realCaps.map((c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cc = c as any;
      let line = `- **${cc.capability_name}**: ${cc.description}`;
      if (cc.evidence) line += ` (${cc.evidence})`;
      return line;
    }).join('\n');
    blocks.push(`### Bidder capabilities (FACTUAL — weave in)\n${lines}`);
  }

  if (ctx.team && ctx.team.length) {
    const lines = ctx.team.map((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mm = m as any;
      const tags: string[] = [];
      if (mm.is_key_personnel) tags.push('KEY PERSONNEL');
      if (mm.years_experience) tags.push(`${mm.years_experience} yrs`);
      if (mm.security_clearance) tags.push(`${mm.security_clearance} cleared`);
      if (Array.isArray(mm.certifications) && mm.certifications.length) tags.push(mm.certifications.join(', '));
      const tagStr = tags.length ? ` [${tags.join(' · ')}]` : '';
      let line = `- **${mm.full_name}**, ${mm.title}${tagStr}`;
      if (mm.bio_short) line += `\n  ${mm.bio_short}`;
      return line;
    }).join('\n');
    blocks.push(`### Bidder team (FACTUAL — name these people)\n${lines}`);
  }

  return blocks.join('\n\n');
}

/**
 * Evidence-gap signal — the fix for the lowest-scoring sections (LOI Opening 67,
 * Why Us 68 in the eval). Those sections demand "concrete evidence", but when a
 * thin vault has NO past performance / capabilities (e.g. a brand-new user with
 * only an elevator pitch), the model gets SILENCE about the gap — so it bluffs,
 * paraphrasing the elevator pitch into the notice's vocabulary as if it were
 * proof. The judge correctly flags that as generic.
 *
 * This emits an EXPLICIT instruction to bracket the missing evidence instead of
 * inventing it — turning a hollow-but-confident draft into an honest assist
 * draft the user fills in. (ground_in_real_data / proposal_assist_v1: ASSIST,
 * not WRITER. The judge rubric rewards "a short honest draft that brackets the
 * unknowns".)
 *
 * Fires ONLY for evidence-dependent sections, and ONLY for the slices that are
 * actually empty — a vault WITH past performance gets no gap nag for it.
 */
export function formatEvidenceGapsForPrompt(ctx: VaultContext, sectionType: SectionType): string {
  // Sections whose quality depends on real proof points (vs. an "approach"
  // section like Technical, which scores well without past evidence).
  const EVIDENCE_SECTIONS: SectionType[] = [
    'differentiators',      // Why Us
    'company_overview',     // LOI Opening
    'cap_past_performance', // Relevant Experience
    'capabilities',         // Capability Fit
    'past_performance',
    'exec_summary',
  ];
  if (!EVIDENCE_SECTIONS.includes(sectionType)) return '';

  const gaps: string[] = [];
  const usesPastPerf = sectionType === 'past_performance' || sectionType === 'cap_past_performance' || sectionType === 'exec_summary' || sectionType === 'differentiators' || sectionType === 'company_overview';
  const usesCaps = sectionType === 'capabilities' || sectionType === 'differentiators' || sectionType === 'company_overview';

  // Count REAL rows only — a vault full of unfilled template stubs is, for
  // drafting purposes, an empty vault (the 94-char-stub trap).
  const hasRealPastPerf = filterRealRows(ctx.past_performance).length > 0;
  const hasRealCaps = filterRealRows(ctx.capabilities).length > 0;

  if (usesPastPerf && !hasRealPastPerf) {
    gaps.push('- No past-performance records in the vault. Do NOT assert "proven track record", "successfully delivered", "we have streamlined operations for clients", or similar without a specific contract behind it. Where the section needs a proof point, write a bracketed placeholder like "[relevant contract — title, agency, value]" for the user to fill in.');
  }
  if (usesCaps && !hasRealCaps) {
    gaps.push('- No confirmed capability records in the vault beyond the one-liner/elevator pitch. State the directly transferable strength plainly (tie it to THIS notice\'s scope), but do NOT manufacture specific expertise the vault can\'t back. Bracket the specifics the user must confirm, e.g. "[specific credentialing systems experience]".');
  }
  if (!gaps.length) return '';

  return `### Evidence gaps — BRACKET, do not bluff\nThis bidder's vault is thin for this section. An honest, notice-anchored draft that brackets the missing proof scores BETTER than a confident draft full of unbacked claims. Specifically:\n${gaps.join('\n')}`;
}
