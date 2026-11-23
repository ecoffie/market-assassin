/**
 * MCP tools: get_company_profile + save_past_performance.
 *
 * Research 2026-11-22 (docs/research/2026-11-22-contractor-problems-and-industries.md):
 * "no past performance" and "proposal workload" are two of the top three contractor
 * problems. Both depend on a reusable company record. The app's Vault already holds
 * one (user_past_performance etc.), and every draft tool reads it, but an MCP user
 * had no way to see or fill it: drafts came back generic, and past-performance
 * sections came back as fill-in templates (no-past-performance.ts).
 *
 *   get_company_profile  (free, read-only)  — what Mindy knows about the caller's
 *                                             company, and what is missing.
 *   save_past_performance (free, additive)  — add ONE real project to the caller's
 *                                             own Vault (same row the app's Vault page
 *                                             writes; source='mcp').
 *
 * Owner is ALWAYS the verified caller (ctx.vaultEmail for an authorized coach
 * workspace, else ctx.userEmail) — never an email from args.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadVaultContext, loadBidderProfileResult } from '@/lib/proposal/loaders';
import { embedVaultRow } from '@/lib/vault/embed-evidence';
import { invalidateCapabilityVector } from '@/lib/alerts/capability-vector';

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

const PAST_PERFORMANCE_GUIDANCE = [
  'Relevant commercial, state and local, and subcontract work can count, not only federal prime contracts.',
  'The evaluation should consider predecessor companies, key personnel with relevant experience, and subcontractors doing major parts of the work (FAR 15.305(a)(2)(iii)).',
  'With no relevant record, an offeror may not be evaluated favorably or unfavorably on past performance (FAR 15.305(a)(2)(iv)), in FAR Part 15 source selections.',
  'Save only work the company actually did. Mindy drafts past performance only from saved projects.',
];

// ---------------------------------------------------------------- get_company_profile

export interface CompanyProfileResult {
  company: {
    name: string | null;
    uei: string | null;
    naics_codes: string[];
    set_asides: string[];
    certifications: string[];
  };
  past_performance: Array<{
    id: string;
    title: string;
    customer: string;
    role: string | null;
    period: string | null;
    value: number | null;
    scope: string | null;
    has_reference: boolean;
  }>;
  counts: { past_performance: number | null; capabilities: number | null; team: number | null };
  missing: string[];
  unavailable: string[];
  past_performance_guidance?: string[];
  _meta: { grounded: boolean; degraded: boolean };
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

export async function getCompanyProfile(input: { userEmail: string; vaultEmail?: string }): Promise<CompanyProfileResult> {
  const owner = input.vaultEmail || input.userEmail;
  const [vault, profileRes] = await Promise.all([
    loadVaultContext(owner, 'exec_summary', {
      sections: ['identity', 'past_performance', 'capabilities', 'team'],
      limits: { past_performance: 50, capabilities: 50, team: 50 },
    }),
    loadBidderProfileResult(owner),
  ]);
  const unavailable = [...(vault.unavailable || [])] as string[];
  if (profileRes.status === 'unavailable') unavailable.push('settings_profile');

  const id = vault.identity || {};
  const prof = profileRes.profile;
  const company = {
    name: str(id.legal_name) || str(id.dba) || prof.companyName || null,
    uei: str(id.uei),
    naics_codes: strArr(id.primary_naics).length ? strArr(id.primary_naics) : prof.naicsCodes || [],
    set_asides: prof.setAsides || [],
    certifications: strArr(id.certifications).length ? strArr(id.certifications) : prof.certifications || [],
  };

  const pp = (vault.past_performance || []).map((r) => {
    const start = str(r.period_start);
    const end = str(r.period_end);
    const scope = str(r.scope_description);
    return {
      id: String(r.id ?? ''),
      title: String(r.contract_title ?? ''),
      customer: String(r.agency ?? ''),
      role: str(r.role),
      period: start || end ? `${start ?? '?'} to ${end ?? 'present'}` : null,
      value: typeof r.contract_value === 'number' ? r.contract_value : r.contract_value != null && !isNaN(Number(r.contract_value)) ? Number(r.contract_value) : null,
      scope: scope && scope.length > 300 ? `${scope.slice(0, 297)}...` : scope,
      has_reference: !!str(r.reference_name),
    };
  });

  // Unknown is never zero: a section whose read failed has a null count.
  const count = (section: string, n: number) => (unavailable.includes(section) ? null : n);
  const counts = {
    past_performance: count('past_performance', pp.length),
    capabilities: count('capabilities', vault.capabilities?.length ?? 0),
    team: count('team', vault.team?.length ?? 0),
  };

  const missing: string[] = [];
  if (!company.name) missing.push('company name');
  if (!company.uei) missing.push('UEI');
  if (counts.past_performance === 0) missing.push('past performance');
  if (counts.capabilities === 0) missing.push('capabilities');
  if (counts.team === 0) missing.push('key personnel');

  return {
    company,
    past_performance: pp,
    counts,
    missing,
    unavailable,
    ...(counts.past_performance === 0 ? { past_performance_guidance: PAST_PERFORMANCE_GUIDANCE } : {}),
    _meta: { grounded: unavailable.length === 0, degraded: unavailable.length > 0 },
  };
}

// ---------------------------------------------------------------- save_past_performance

export interface SavePastPerformanceInput {
  userEmail: string;
  vaultEmail?: string;
  title?: unknown;
  customer?: unknown;
  role?: unknown;
  scope?: unknown;
  outcomes?: unknown;
  period_start?: unknown;
  period_end?: unknown;
  value?: unknown;
  contract_number?: unknown;
  reference_name?: unknown;
  reference_title?: unknown;
  reference_email?: unknown;
  reference_phone?: unknown;
  naics_codes?: unknown;
  confirm_real?: unknown;
}

export interface SavePastPerformanceResult {
  saved: boolean;
  id?: string;
  error?: string;
  missing_fields?: string[];
  past_performance_count?: number | null;
  _meta: { grounded: boolean; degraded: boolean };
}

const ROLES = new Set(['prime', 'sub', 'jv_partner', 'key_personnel']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function capped(v: unknown, max: number): string | null {
  const s = str(v);
  return s ? s.slice(0, max) : null;
}

/** Pure validation → the row to insert, or the reason it cannot be saved. Exported for tests. */
export function buildPastPerformanceRow(input: SavePastPerformanceInput):
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string; missing_fields?: string[] } {
  if (input.confirm_real !== true) {
    return {
      ok: false,
      error: 'confirm_real must be true: the user confirms this is work their company (or its key personnel) actually performed. Never save example or invented projects.',
    };
  }
  const title = capped(input.title, 300);
  const customer = capped(input.customer, 300);
  const scope = capped(input.scope, 4000);
  const missing = [!title && 'title', !customer && 'customer', !scope && 'scope'].filter(Boolean) as string[];
  if (missing.length) return { ok: false, error: `Missing required field(s): ${missing.join(', ')}.`, missing_fields: missing };

  const role = str(input.role)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
  if (role && !ROLES.has(role)) return { ok: false, error: `role must be one of: ${[...ROLES].join(', ')}.` };
  for (const k of ['period_start', 'period_end'] as const) {
    const d = str(input[k]);
    if (d && !DATE_RE.test(d)) return { ok: false, error: `${k} must be YYYY-MM-DD.` };
  }
  let value: number | null = null;
  if (input.value != null && input.value !== '') {
    value = typeof input.value === 'number' ? input.value : Number(String(input.value).replace(/[$,\s]/g, ''));
    if (!isFinite(value) || value < 0) return { ok: false, error: 'value must be a non-negative number (dollars).' };
  }

  return {
    ok: true,
    row: {
      contract_title: title,
      agency: customer,
      role,
      scope_description: scope,
      outcomes: capped(input.outcomes, 2000),
      period_start: str(input.period_start),
      period_end: str(input.period_end),
      contract_value: value,
      contract_number: capped(input.contract_number, 100),
      reference_name: capped(input.reference_name, 200),
      reference_title: capped(input.reference_title, 200),
      reference_email: capped(input.reference_email, 200),
      reference_phone: capped(input.reference_phone, 50),
      naics_codes: strArr(input.naics_codes).filter((n) => /^\d{2,6}$/.test(n)).slice(0, 20),
      source: 'mcp',
    },
  };
}

export async function savePastPerformance(input: SavePastPerformanceInput): Promise<SavePastPerformanceResult> {
  const built = buildPastPerformanceRow(input);
  if (!built.ok) {
    return { saved: false, error: built.error, ...(built.missing_fields ? { missing_fields: built.missing_fields } : {}), _meta: { grounded: false, degraded: false } };
  }
  const owner = input.vaultEmail || input.userEmail;
  const client = sb();
  const { data, error } = await client
    .from('user_past_performance')
    .insert({ ...built.row, user_email: owner })
    .select('id, contract_title, agency, scope_description, outcomes, role, relevance_keywords, naics_codes')
    .maybeSingle();
  if (error || !data) {
    console.error('[mcp/save_past_performance] insert failed:', error?.message);
    return { saved: false, error: 'Could not save right now. Nothing was saved; retry shortly.', _meta: { grounded: false, degraded: true } };
  }
  // Same follow-ups as the app's Vault page: embed for requirement matching, refresh the capability vector.
  try { await embedVaultRow(client, 'past_performance', data, new Date().toISOString()); } catch (e) { console.error('[mcp/save_past_performance] embed failed:', e); }
  void invalidateCapabilityVector(owner);

  const { count, error: cErr } = await client
    .from('user_past_performance')
    .select('id', { count: 'exact', head: true })
    .eq('user_email', owner)
    .is('archived_at', null);

  return {
    saved: true,
    id: String((data as { id: unknown }).id),
    past_performance_count: cErr ? null : count ?? null,
    _meta: { grounded: true, degraded: false },
  };
}
