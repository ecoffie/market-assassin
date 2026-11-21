/**
 * Ask Mindy company profile (Ask Mindy Backend Spec, Nov 21 2026, section 3): what Mindy knows about the
 * user's company, built from the Vault and the user's settings. Not wired into any route.
 *
 * `buildCompanyProfile` is PURE: it maps records the existing loaders already return. `loadCompanyProfile`
 * only calls those two loaders (loadBidderProfile, loadVaultContext); it adds no query and writes nothing.
 *
 * Owner resolution (Agent 4, YELLOW): `loadCompanyProfile` takes a ChatActingScope from the existing strict
 * resolver (resolveChatActingScope, called with the VERIFIED session email), never a raw email. It reads the
 * Vault owner that `vaultEmailFor` returns: the caller's own, or a client workspace the resolver authorized
 * server-side. An unconfirmed or failed workspace resolution (`unavailable`) is refused: nothing is read, so a
 * coach acting for a client can never get their own profile in its place.
 *
 * Rules (spec section 3 and CLAUDE.md rule 5):
 *   - A field nothing filled is ABSENT, never guessed, never an empty array standing in for "none". The
 *     absent fields are listed in `unknown` so the profile page can show them once.
 *   - Set-aside PREFERENCES (what the user wants to target) are not certifications (what the company holds).
 *     They stay `targetSetAsides` and never become eligibility.
 *   - Vault certifications are user-entered, so they are labelled self_reported. SBA-certified status needs
 *     the SBA profile lookup (a Data Core tool not built yet), so it is unknown, not assumed.
 *   - Past performance keeps prime and subcontract work apart: a sub award is never counted as prime.
 *
 * Known limit: both existing loaders degrade a query ERROR to an empty result (they log it). Through them a
 * failed read is indistinguishable from an empty Vault, so this module reports the fields as unknown in both
 * cases, which is the safe direction, but it cannot say "unavailable". Fixing that belongs in the loaders.
 */
import { loadBidderProfile, loadVaultContext, ALL_VAULT_SECTIONS } from '@/lib/proposal/loaders';
import type { BidderProfile, VaultContext } from '@/lib/proposal/types';
import { vaultEmailFor, type ChatActingScope } from '@/lib/chat/chat-acting-scope';

export interface CompanyCertification {
  name: string;
  source: 'self_reported';
}

export interface PastPerformanceSummary {
  buyerAgencies: string[];
  buyerOffices: string[];
  naicsCodes: string[];
  /** Largest parseable contract value, any role. Absent when no value parses. */
  largestAward?: number;
  primeCount: number;
  subCount: number;
  /** Rows whose role is neither prime nor sub (or empty). */
  otherRoleCount: number;
}

export interface CompanyProfile {
  companyName?: string;
  uei?: string;
  naicsCodes?: string[];
  /** Two-letter states the company works in (service states, HQ state, settings locations). */
  states?: string[];
  targetAgencies?: string[];
  /** Set-asides the user wants to target. NOT certifications. */
  targetSetAsides?: string[];
  certifications?: CompanyCertification[];
  vehiclesHeld?: string[];
  keywords?: string[];
  pastPerformance?: PastPerformanceSummary;
  /** Profile fields nothing filled, for the profile page. */
  unknown: ProfileField[];
}

export type ProfileField =
  | 'companyName' | 'uei' | 'naicsCodes' | 'states' | 'targetAgencies' | 'targetSetAsides'
  | 'certifications' | 'vehiclesHeld' | 'keywords' | 'pastPerformance';

const FIELDS: readonly ProfileField[] = ['companyName', 'uei', 'naicsCodes', 'states', 'targetAgencies', 'targetSetAsides', 'certifications', 'vehiclesHeld', 'keywords', 'pastPerformance'];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : []);

/** Case-insensitive de-duplication that keeps the first spelling; undefined when empty. */
function uniq(xs: string[], max = Infinity): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out.length ? out : undefined;
}

const STATE = /^[A-Z]{2}$/;

/** "$1,200,000", "1200000", "1.2M", "850K" → number. Anything else → undefined (never 0). */
export function parseMoney(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return undefined;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  const n = Number(m[1]) * mult;
  return n > 0 ? n : undefined;
}

function summarizePastPerformance(rows: Array<Record<string, unknown>> | undefined): PastPerformanceSummary | undefined {
  if (!rows?.length) return undefined;
  let primeCount = 0, subCount = 0, otherRoleCount = 0;
  let largest: number | undefined;
  for (const r of rows) {
    const role = (str(r.role) || '').toLowerCase();
    if (/\bsub/.test(role)) subCount++;
    else if (/\bprime\b/.test(role)) primeCount++;
    else otherRoleCount++;
    const v = parseMoney(r.contract_value);
    if (v !== undefined && (largest === undefined || v > largest)) largest = v;
  }
  return {
    buyerAgencies: uniq(rows.flatMap((r) => [str(r.agency), str(r.sub_agency)].filter((x): x is string => !!x))) ?? [],
    buyerOffices: uniq(rows.map((r) => str(r.office)).filter((x): x is string => !!x)) ?? [],
    naicsCodes: uniq(rows.flatMap((r) => strs(r.naics_codes))) ?? [],
    ...(largest !== undefined ? { largestAward: largest } : {}),
    primeCount, subCount, otherRoleCount,
  };
}

/** Pure: map what the existing loaders returned into the Ask Mindy profile. */
export function buildCompanyProfile(input: { bidder: BidderProfile; vault: VaultContext }): CompanyProfile {
  const id = (input.vault.identity ?? {}) as Record<string, unknown>;
  const b = input.bidder;

  const profile: Omit<CompanyProfile, 'unknown'> = {
    companyName: str(id.legal_name) ?? str(id.dba) ?? str(b.companyName),
    uei: str(id.uei)?.toUpperCase(),
    naicsCodes: uniq([...strs(id.primary_naics), ...strs(b.naicsCodes)]),
    states: uniq([...strs(id.service_states), ...(str(id.hq_state) ? [str(id.hq_state) as string] : []), ...strs(b.locationStates)]
      .map((s) => s.toUpperCase()).filter((s) => STATE.test(s))),
    targetAgencies: uniq(strs(b.agencies)),
    targetSetAsides: uniq(strs(b.setAsides)),
    certifications: uniq(strs(id.certifications))?.map((name) => ({ name, source: 'self_reported' as const })),
    vehiclesHeld: uniq(strs(id.contract_vehicles)),
    keywords: uniq([
      ...(input.vault.capabilities ?? []).map((c) => str(c.capability_name)).filter((x): x is string => !!x),
      ...(input.vault.past_performance ?? []).flatMap((r) => strs(r.relevance_keywords)),
    ], 20),
    pastPerformance: summarizePastPerformance(input.vault.past_performance),
  };
  const clean = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined)) as Omit<CompanyProfile, 'unknown'>;
  return { ...clean, unknown: FIELDS.filter((f) => clean[f] === undefined) };
}

export type CompanyProfileLoad =
  | { status: 'ok'; profile: CompanyProfile; workspace: 'own' | 'client' }
  | { status: 'refused'; reason: 'workspace_unconfirmed' };

/**
 * Reads the acting scope's Vault through the existing loaders only (no new query, no write), then maps.
 * `scope` must come from resolveChatActingScope(verifiedEmail, request).
 */
export async function loadCompanyProfile(scope: ChatActingScope): Promise<CompanyProfileLoad> {
  const owner = vaultEmailFor(scope);
  if (!owner || scope.kind === 'unavailable') return { status: 'refused', reason: 'workspace_unconfirmed' };
  const [bidder, vault] = await Promise.all([
    loadBidderProfile(owner),
    loadVaultContext(owner, 'exec_summary', { sections: ALL_VAULT_SECTIONS }),
  ]);
  return { status: 'ok', profile: buildCompanyProfile({ bidder, vault }), workspace: scope.kind };
}
