/**
 * MarketScope — the executable retrieval contract for Ralph Phase 1 MRR.
 *
 * MarketScope is not documentation. Every evidence-producing query must declare
 * which dimensions it consumed, which the underlying tool cannot express, and
 * whether the resulting evidence is in_scope / contextual / expanded / unresolved.
 *
 * No dimension may disappear silently. Empty strict-scope stays empty/unknown.
 * Expansion is an explicit operation (expandMarketScope); Phase 1 may choose
 * not to expand at all.
 */
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';
import type { Requirement } from './types';

export const SCOPE_DIMENSIONS = [
  'department',
  'service',
  'installation',
  'contracting_office',
  'naics',
  'psc',
  'phrase',
  'geography',
] as const;

export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

export type EvidenceClass = 'in_scope' | 'contextual' | 'expanded' | 'unresolved';

export type StrictScopeResult = 'populated' | 'empty' | 'unknown';

export interface MarketScope {
  department?: string;
  service?: string;
  installation?: string;
  /** Verbatim office text from intake (e.g. "FA4610 / 30 CONS"). */
  contractingOffice?: string;
  /** Structured DoDAAC when the office text contains one. */
  contractingOfficeCode?: string;
  naics?: string;
  psc?: string;
  phrase?: string;
  geography?: string;
}

export interface ScopeExpansionRecord {
  original: MarketScope;
  resulting: MarketScope;
  removed: ScopeDimension[];
  reason: string;
  strictResultCount: number | null;
  expandedResultCount: number | null;
  provenance: string;
}

export interface RetrievalManifest {
  section: string;
  tool: string;
  requested_scope: Partial<Record<ScopeDimension, string>>;
  consumed_scope: Partial<Record<ScopeDimension, string>>;
  unsupported_scope: Partial<Record<ScopeDimension, string>>;
  expanded_scope: Partial<Record<ScopeDimension, string>>;
  result_count: number | null;
  grounded: boolean | null;
  source: string;
  as_of: string;
  evidence_class: EvidenceClass;
  strict_scope_result?: StrictScopeResult;
}

export function extractDodaac(office: string | undefined): string | undefined {
  if (!office) return undefined;
  const tokens = office.toUpperCase().split(/[^A-Z0-9]+/);
  for (const token of tokens) {
    if (isValidDodaac(token)) return token;
  }
  return undefined;
}

export function marketScopeFromRequirement(req: Requirement): MarketScope {
  const contractingOffice = req.office;
  const contractingOfficeCode = extractDodaac(contractingOffice);
  return {
    ...(req.agency ? { department: req.agency } : {}),
    ...(req.sub_agency ? { service: req.sub_agency } : {}),
    ...(req.installation ? { installation: req.installation } : {}),
    ...(contractingOffice ? { contractingOffice } : {}),
    ...(contractingOfficeCode ? { contractingOfficeCode } : {}),
    ...(req.naics ? { naics: req.naics } : {}),
    ...(req.psc ? { psc: req.psc } : {}),
    ...(req.keyword ? { phrase: req.keyword } : {}),
    ...(req.place_of_performance_state ? { geography: req.place_of_performance_state } : {}),
  };
}

export function requestedScopeMap(scope: MarketScope): Partial<Record<ScopeDimension, string>> {
  const out: Partial<Record<ScopeDimension, string>> = {};
  if (scope.department) out.department = scope.department;
  if (scope.service) out.service = scope.service;
  if (scope.installation) out.installation = scope.installation;
  if (scope.contractingOffice || scope.contractingOfficeCode) {
    out.contracting_office = [scope.contractingOfficeCode, scope.contractingOffice]
      .filter(Boolean)
      .join(' — ');
  }
  if (scope.naics) out.naics = scope.naics;
  if (scope.psc) out.psc = scope.psc;
  if (scope.phrase) out.phrase = scope.phrase;
  if (scope.geography) out.geography = scope.geography;
  return out;
}

/**
 * Explicit expansion only. Phase 1 may never call this; that is preferable to
 * silently dropping agency / office / NAICS / geography on an empty result.
 */
export function expandMarketScope(args: {
  from: MarketScope;
  remove: ScopeDimension[];
  reason: string;
  strictResultCount: number | null;
  expandedResultCount: number | null;
  provenance: string;
}): { scope: MarketScope; record: ScopeExpansionRecord } {
  const resulting: MarketScope = { ...args.from };
  for (const dim of args.remove) {
    if (dim === 'department') delete resulting.department;
    if (dim === 'service') delete resulting.service;
    if (dim === 'installation') delete resulting.installation;
    if (dim === 'contracting_office') {
      delete resulting.contractingOffice;
      delete resulting.contractingOfficeCode;
    }
    if (dim === 'naics') delete resulting.naics;
    if (dim === 'psc') delete resulting.psc;
    if (dim === 'phrase') delete resulting.phrase;
    if (dim === 'geography') delete resulting.geography;
  }
  return {
    scope: resulting,
    record: {
      original: { ...args.from },
      resulting,
      removed: [...args.remove],
      reason: args.reason,
      strictResultCount: args.strictResultCount,
      expandedResultCount: args.expandedResultCount,
      provenance: args.provenance,
    },
  };
}

export function retrievalManifest(input: {
  section: string;
  tool: string;
  requested: MarketScope;
  consumed?: Partial<Record<ScopeDimension, string>>;
  unsupported?: Partial<Record<ScopeDimension, string>>;
  expanded?: Partial<Record<ScopeDimension, string>>;
  resultCount: number | null;
  grounded: boolean | null;
  source: string;
  asOf: string;
  evidenceClass: EvidenceClass;
  strictScopeResult?: StrictScopeResult;
}): RetrievalManifest {
  const requested_scope = requestedScopeMap(input.requested);
  const consumed_scope = input.consumed ?? {};
  return {
    section: input.section,
    tool: input.tool,
    requested_scope,
    consumed_scope,
    unsupported_scope: closeUnsupportedScope(requested_scope, consumed_scope, input.unsupported ?? {}),
    expanded_scope: input.expanded ?? {},
    result_count: input.resultCount,
    grounded: input.grounded,
    source: input.source,
    as_of: input.asOf,
    evidence_class: input.evidenceClass,
    ...(input.strictScopeResult ? { strict_scope_result: input.strictScopeResult } : {}),
  };
}

/**
 * No requested dimension may disappear. Anything not consumed must be declared
 * unsupported (or expanded). Callers may supply a more specific reason.
 */
export function closeUnsupportedScope(
  requested: Partial<Record<ScopeDimension, string>>,
  consumed: Partial<Record<ScopeDimension, string>>,
  unsupported: Partial<Record<ScopeDimension, string>>,
): Partial<Record<ScopeDimension, string>> {
  const out: Partial<Record<ScopeDimension, string>> = { ...unsupported };
  for (const dim of SCOPE_DIMENSIONS) {
    if (!requested[dim] || consumed[dim] || out[dim]) continue;
    out[dim] = `${dim} was requested but this tool cannot consume it as a retrieval predicate`;
  }
  return out;
}

/** Statewide (or unscoped) market-capacity label — never "this office has N families." */
export function marketCapacityLabel(scope: MarketScope, naics: string | undefined): string {
  const code = naics || scope.naics || 'the stated NAICS';
  if (scope.geography) {
    return `${geographyName(scope.geography)} small-business capacity for NAICS ${code}`;
  }
  return `National small-business capacity for NAICS ${code}`;
}

const USPS_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function geographyName(code: string): string {
  const key = code.trim().toUpperCase();
  return USPS_NAME[key] ?? key;
}

export function matchesInstallation(
  installation: string | undefined,
  haystack: string,
): boolean {
  if (!installation) return false;
  const inst = installation.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const text = haystack.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!inst || !text) return false;
  const tokens = inst.split(' ').filter((w) => w.length > 3 && !INSTALLATION_STOP.has(w));
  if (tokens.length === 0) return text.includes(inst);
  return tokens.every((t) => text.includes(t));
}

const INSTALLATION_STOP = new Set([
  'base', 'force', 'space', 'air', 'station', 'camp', 'fort', 'joint', 'the', 'and',
]);
