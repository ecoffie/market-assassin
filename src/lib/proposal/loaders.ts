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

// ---- Bidder profile (NAICS / agencies / set-asides) ----------------

export async function loadBidderProfile(email: string): Promise<BidderProfile> {
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
  const needsPastPerf = sectionType === 'past_performance' || sectionType === 'cap_past_performance' || sectionType === 'exec_summary';
  const needsCapabilities = sectionType === 'capabilities' || sectionType === 'technical' || sectionType === 'differentiators' || sectionType === 'company_overview';
  const needsTeam = sectionType === 'management' || sectionType === 'poc';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queries: any[] = [];
  if (needsIdentity) {
    queries.push(supabase.from('user_identity_profile').select('*').eq('user_email', email).maybeSingle());
  }
  if (needsPastPerf) {
    queries.push(supabase.from('user_past_performance')
      .select('contract_title, agency, sub_agency, contract_number, period_start, period_end, contract_value, role, scope_description, outcomes, cpars_rating, relevance_keywords, naics_codes')
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
  if (needsIdentity)     { ctx.identity = (results[idx++] as { data: Record<string, unknown> | null }).data; }
  if (needsPastPerf)     { ctx.past_performance = (results[idx++] as { data: Array<Record<string, unknown>> | null }).data || []; }
  if (needsCapabilities) { ctx.capabilities = (results[idx++] as { data: Array<Record<string, unknown>> | null }).data || []; }
  if (needsTeam)         { ctx.team = (results[idx++] as { data: Array<Record<string, unknown>> | null }).data || []; }

  const identityHas = ctx.identity && Object.entries(ctx.identity).some(([k, v]) =>
    k !== 'user_email' && k !== 'created_at' && k !== 'updated_at' &&
    v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
  ctx.has_any = Boolean(identityHas) || (ctx.past_performance?.length ?? 0) > 0 || (ctx.capabilities?.length ?? 0) > 0 || (ctx.team?.length ?? 0) > 0;

  return ctx;
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
    if (id.bonding_single) lines.push(`Single bonding capacity: ${id.bonding_single}`);
    if (id.bonding_aggregate) lines.push(`Aggregate bonding capacity: ${id.bonding_aggregate}`);
    // Point of contact (#41) — fills cert-package "Responsible Office / Contact
    // Person" + Point-of-Contact sections instead of [placeholders].
    if (id.contact_name) lines.push(`Contact person: ${id.contact_name}${id.contact_title ? `, ${id.contact_title}` : ''}`);
    if (id.contact_phone) lines.push(`Contact phone: ${id.contact_phone}`);
    if (id.contact_email) lines.push(`Contact email: ${id.contact_email}`);
    if (id.website) lines.push(`Website: ${id.website}`);
    if (lines.length) blocks.push(`### Bidder identity (FACTUAL — use verbatim)\n${lines.join('\n')}`);
  }

  if (ctx.past_performance && ctx.past_performance.length) {
    const lines = ctx.past_performance.map((p, i) => {
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
    blocks.push(`### Bidder past performance (FACTUAL — cite these, not [placeholders])\n${lines}`);
  }

  if (ctx.capabilities && ctx.capabilities.length) {
    const lines = ctx.capabilities.map((c) => {
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
