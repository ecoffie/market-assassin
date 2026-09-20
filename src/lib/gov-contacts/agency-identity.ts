/**
 * Canonical agency identity for OSBP / federal-contact promotion.
 *
 * ⚠️ WHY THIS EXISTS
 * `getAgencyInfoByParentAgency` used unanchored `haystack.includes(keyword)`
 * so the keyword "STATE" matched "UNITED STATES COAST GUARD" and prepended
 * Gail Clark / sdbupolicy@state.gov as a Coast Guard OSBP contact.
 * lookup_federal_osbp for the same string correctly returned not_in_directory.
 *
 * Contract (same as src/lib/strategic-intel/agency-resolver.ts):
 *   1. Exact canonical identity
 *   2. Exact normalized alias
 *   3. Established abbreviation / acronym
 *   4. Explicit parent / sub-agency relationship
 *   5. Otherwise NOT ESTABLISHED
 * Never promote on arbitrary substring containment.
 * "STATE" must not match "UNITED STATES COAST GUARD".
 *
 * Reuses `resolveAgency` for toptier identity. Directory command matching
 * is whole-token / identity-key only.
 */
import commandInfoData from '@/data/dod-command-info.json';
import { resolveAgency } from '@/lib/strategic-intel/agency-resolver';

export type IdentityMethod =
  | 'exact_canonical'
  | 'exact_alias'
  | 'abbreviation'
  | 'parent_subagency'
  | 'not_established';

export interface DirectoryCommandLike {
  fullName: string;
  abbreviation: string;
  parentAgency: string;
  smallBusinessOffice?: {
    name?: string;
    director?: string;
    email?: string;
  };
}

/** Filler that must not remain as identity evidence. UNITED STATES is collapsed as a pair so STATES cannot be mistaken for STATE. */
const FILLER = /\b(DEPARTMENT|DEPT|OF|THE|ADMINISTRATION|AGENCY|NATIONAL|OFFICE|BUREAU|FEDERAL)\b/g;

export function identityKey(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[.,'’&]/g, ' ')
    .replace(/\bUNITED\s+STATES\b/g, ' ')
    .replace(/\bU\.?\s*S\.?\b/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function identityTokens(s: string): string[] {
  const k = identityKey(s);
  return k ? k.split(' ') : [];
}

export function identityEstablishedEqual(a: string, b: string): boolean {
  const ka = identityKey(a);
  const kb = identityKey(b);
  return !!ka && !!kb && ka === kb;
}

/** Needle tokens appear as a contiguous phrase in haystack tokens. */
export function tokensContainPhrase(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) return true;
  }
  return false;
}

/**
 * The query identifies the candidate when they share an identity key, or when
 * the query's tokens are a contiguous phrase inside the candidate (Navy ⊂
 * Department of the Navy). NEVER the reverse: a short candidate keyword is
 * not searched inside a longer query.
 */
export function queryIdentifiesCandidate(query: string, candidate: string): boolean {
  const q = identityTokens(query);
  const c = identityTokens(candidate);
  if (q.length === 0 || c.length === 0) return false;
  if (q.join(' ') === c.join(' ')) return true;
  return tokensContainPhrase(c, q);
}

export interface DirectoryMatch<T extends DirectoryCommandLike> {
  info: T;
  method: Exclude<IdentityMethod, 'not_established'>;
}

export type DirectoryResolution<T extends DirectoryCommandLike> =
  | { kind: 'command'; info: T; method: Exclude<IdentityMethod, 'not_established'> }
  | { kind: 'parent_roster'; parentLabel: string; children: T[] }
  | { kind: 'not_established' };

function uniqueCommand<T extends DirectoryCommandLike>(
  hits: T[],
  method: DirectoryMatch<T>['method'],
): DirectoryMatch<T> | null {
  const seen = new Set(hits.map((h) => h.abbreviation.toUpperCase() + '|' + h.fullName.toUpperCase()));
  if (seen.size !== 1) return null;
  return { info: hits[0], method };
}

/**
 * Unique directory command for a query, identified by ITS OWN name / key /
 * abbreviation. Parent-agency membership is a roster, never a child to pick.
 * Does not run OSBP_PARENT_ALIASES — those stay in getCommandInfo as explicit
 * parent/sub-agency relationships.
 */
export function matchDirectoryCommand<T extends DirectoryCommandLike>(
  query: string,
  commands: Record<string, T>,
): DirectoryMatch<T> | null {
  const raw = (query || '').trim();
  if (!raw) return null;
  const qKey = identityKey(raw);
  if (!qKey) return null;

  const entries = Object.entries(commands);

  const direct = commands[raw];
  if (direct) return { info: direct, method: 'exact_canonical' };
  const ci = entries.find(([k]) => k.toUpperCase() === raw.toUpperCase());
  if (ci) return { info: ci[1], method: 'exact_canonical' };

  const byName = uniqueCommand(
    entries.filter(([, info]) => identityEstablishedEqual(raw, info.fullName)).map(([, info]) => info),
    'exact_canonical',
  );
  if (byName) return byName;

  const byAbbr = uniqueCommand(
    entries.filter(([, info]) => identityEstablishedEqual(raw, info.abbreviation)).map(([, info]) => info),
    'abbreviation',
  );
  if (byAbbr) return byAbbr;

  const byKey = uniqueCommand(
    entries.filter(([k]) => identityEstablishedEqual(raw, k)).map(([, info]) => info),
    'exact_alias',
  );
  if (byKey) return byKey;

  const phraseHits = entries
    .filter(([k, info]) =>
      queryIdentifiesCandidate(raw, info.fullName)
      || queryIdentifiesCandidate(raw, k)
      || queryIdentifiesCandidate(raw, info.abbreviation),
    )
    .map(([, info]) => info);
  return uniqueCommand(phraseHits, 'exact_alias');
}

/** Parent query → the parent record if it exists, otherwise the child roster. Never first-wins a child. */
export function resolveDirectoryIdentity<T extends DirectoryCommandLike>(
  query: string,
  commands: Record<string, T>,
): DirectoryResolution<T> {
  const command = matchDirectoryCommand(query, commands);
  if (command) return { kind: 'command', info: command.info, method: command.method };
  const children = parentAgencyCommands(query, commands);
  if (children.length > 0) {
    return { kind: 'parent_roster', parentLabel: children[0].parentAgency, children };
  }
  return { kind: 'not_established' };
}

export function parentAgencyCommands<T extends DirectoryCommandLike>(
  parentQuery: string,
  commands: Record<string, T>,
): T[] {
  const raw = (parentQuery || '').trim();
  if (!raw || !identityKey(raw)) return [];
  return Object.values(commands).filter((cmd) =>
    identityEstablishedEqual(raw, cmd.parentAgency) || queryIdentifiesCandidate(raw, cmd.parentAgency),
  );
}

/** Unique directory command whose OSBP mailbox lives on this exact email domain. */
export function uniqueCommandForEmailDomain<T extends DirectoryCommandLike>(
  email: string,
  commands: Record<string, T>,
): T | null {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  const hits = Object.values(commands).filter((c) => {
    const d = (c.smallBusinessOffice?.email || '').split('@')[1]?.toLowerCase().trim();
    return d === domain;
  });
  const uniq = new Set(hits.map((h) => h.abbreviation.toUpperCase()));
  return uniq.size === 1 ? hits[0] : null;
}

export interface OsbpContradictionInput<T extends DirectoryCommandLike = DirectoryCommandLike> {
  requestedAgency: string;
  /** Directory row about to be prepended. This is the identity evidence. */
  selectedCommand?: T | null;
  osbpName?: string | null;
  osbpParentAgency?: string | null;
  /**
   * Accepted for callers that have it. NEVER used to override established
   * agency identity (a Navy POC @ state.gov is still a Navy contact).
   */
  osbpEmail?: string | null;
}

function sameCommand<T extends DirectoryCommandLike>(a: T, b: T): boolean {
  return a.abbreviation.toUpperCase() === b.abbreviation.toUpperCase()
    && identityEstablishedEqual(a.fullName, b.fullName);
}

/**
 * True when the DIRECTORY row being promoted names a different agency than
 * the request. Email domain may FLAG a mismatch for diagnostics; it does not
 * independently exclude a contact whose office/parent identity is established.
 */
export function osbpContradictsRequestedAgency<T extends DirectoryCommandLike>(
  input: OsbpContradictionInput<T>,
  commands: Record<string, T>,
): boolean {
  const requested = (input.requestedAgency || '').trim();
  if (!requested) return true;

  const req = resolveDirectoryIdentity(requested, commands);
  const selected = input.selectedCommand
    ?? (input.osbpParentAgency ? matchDirectoryCommand(input.osbpParentAgency, commands)?.info : null)
    ?? (input.osbpName ? matchDirectoryCommand(input.osbpName, commands)?.info : null)
    ?? null;

  if (req.kind === 'command' && selected && !sameCommand(req.info, selected)) {
    const selectedIsReqParent = identityEstablishedEqual(selected.fullName, req.info.parentAgency);
    if (!selectedIsReqParent) return true;
  }

  if (req.kind === 'parent_roster' && selected) {
    const selectedIsParentRecord = identityEstablishedEqual(selected.fullName, req.parentLabel);
    const selectedIsChild = identityEstablishedEqual(selected.parentAgency, req.parentLabel)
      && !identityEstablishedEqual(selected.fullName, req.parentLabel);
    if (selectedIsChild && !selectedIsParentRecord) return true;
  }

  const reqToptier = resolveAgency({ agencyName: requested });
  const selectedLabel = selected?.fullName || input.osbpParentAgency || '';
  const selectedToptier = selectedLabel
    ? resolveAgency({ agencyName: selectedLabel })
    : { resolved: false as const, canonicalAgency: null };
  if (reqToptier.resolved && selectedToptier.resolved && reqToptier.canonicalAgency !== selectedToptier.canonicalAgency) {
    return true;
  }

  return false;
}

/** Diagnostic only — never a promotion veto. */
export function emailDomainFlagsDifferentCommand<T extends DirectoryCommandLike>(
  email: string,
  established: T,
  commands: Record<string, T>,
): boolean {
  const fromEmail = uniqueCommandForEmailDomain(email, commands);
  if (!fromEmail) return false;
  return !sameCommand(fromEmail, established);
}

/** Legacy unanchored includes — kept for the collision audit, never used to promote. */
export function legacySubstringContains(haystack: string, needle: string): boolean {
  const h = (haystack || '').toUpperCase();
  const n = (needle || '').toUpperCase();
  return n.length > 0 && h.includes(n);
}

// ── Spending grain (NAVSEA lock, 2026-09-20) ──────────────────────────────
// A SYSCOM stays a SYSCOM. Parent-service dollars may be shown only as
// PARENT_SERVICE. Command-level spend abstains (NOT_ESTABLISHED). Never
// label Navy $176.6B as NAVSEA total_obligated.

export const DOD_PARENT = 'Department of Defense';

export const MILITARY_SERVICES = [
  'Department of the Navy',
  'Department of the Army',
  'Department of the Air Force',
] as const;

export type SpendingScope = 'REQUESTED' | 'PARENT_SERVICE' | 'NOT_ESTABLISHED';
export type CommandSpendingStatus = 'NOT_ESTABLISHED' | 'NOT_APPLICABLE';

export interface RequestedIdentity {
  command: string | null;
  service: string | null;
  parent: string | null;
}

export interface IdentitySpendingGrain {
  established: boolean;
  displayName: string | null;
  identity: RequestedIdentity;
  spendingScope: SpendingScope;
  spendingScopeName: string | null;
  commandSpending: CommandSpendingStatus;
  /** Military-department USASpending subtler (Navy / Army / AF under DoD 097). */
  serviceFetch: { subAgency: string } | null;
  /** Civilian / self-parented toptier name for the USASpending toptier list. */
  toptierName: string | null;
}

export function directoryCommands(): Record<string, DirectoryCommandLike> {
  return commandInfoData.commands as Record<string, DirectoryCommandLike>;
}

export function isMilitaryService(name: string): boolean {
  return MILITARY_SERVICES.some((s) => identityEstablishedEqual(name, s));
}

export function militaryServiceCanonical(name: string): string | null {
  const hit = MILITARY_SERVICES.find(
    (s) => identityEstablishedEqual(name, s) || queryIdentifiesCandidate(name, s),
  );
  return hit ?? null;
}

const EMPTY_GRAIN: IdentitySpendingGrain = {
  established: false,
  displayName: null,
  identity: { command: null, service: null, parent: null },
  spendingScope: 'NOT_ESTABLISHED',
  spendingScopeName: null,
  commandSpending: 'NOT_APPLICABLE',
  serviceFetch: null,
  toptierName: null,
};

/**
 * Whole-string directory identity → how (or whether) to fetch USASpending.
 * Substring containment cannot establish identity or spending grain.
 */
export function resolveIdentitySpendingGrain(query: string): IdentitySpendingGrain {
  const raw = (query || '').trim();
  if (!raw) return EMPTY_GRAIN;

  const dir = resolveDirectoryIdentity(raw, directoryCommands());

  if (dir.kind === 'command') {
    const info = dir.info;
    const self = identityEstablishedEqual(info.fullName, info.parentAgency);
    if (self) {
      return {
        established: true,
        displayName: info.fullName,
        identity: { command: info.abbreviation, service: null, parent: info.fullName },
        spendingScope: 'REQUESTED',
        spendingScopeName: info.fullName,
        commandSpending: 'NOT_APPLICABLE',
        serviceFetch: null,
        toptierName: info.fullName,
      };
    }
    const service = militaryServiceCanonical(info.parentAgency);
    if (service) {
      return {
        established: true,
        displayName: info.fullName,
        identity: { command: info.abbreviation, service, parent: DOD_PARENT },
        spendingScope: 'PARENT_SERVICE',
        spendingScopeName: service,
        commandSpending: 'NOT_ESTABLISHED',
        serviceFetch: { subAgency: service },
        toptierName: null,
      };
    }
    return {
      established: true,
      displayName: info.fullName,
      identity: { command: info.abbreviation, service: null, parent: info.parentAgency },
      spendingScope: 'NOT_ESTABLISHED',
      spendingScopeName: null,
      commandSpending: 'NOT_ESTABLISHED',
      serviceFetch: null,
      toptierName: null,
    };
  }

  if (dir.kind === 'parent_roster') {
    const service = militaryServiceCanonical(dir.parentLabel);
    if (service) {
      return {
        established: true,
        displayName: service,
        identity: { command: null, service, parent: DOD_PARENT },
        spendingScope: 'REQUESTED',
        spendingScopeName: service,
        commandSpending: 'NOT_APPLICABLE',
        serviceFetch: { subAgency: service },
        toptierName: null,
      };
    }
    return {
      established: true,
      displayName: dir.parentLabel,
      identity: { command: null, service: null, parent: dir.parentLabel },
      spendingScope: 'REQUESTED',
      spendingScopeName: dir.parentLabel,
      commandSpending: 'NOT_APPLICABLE',
      serviceFetch: null,
      toptierName: dir.parentLabel,
    };
  }

  return EMPTY_GRAIN;
}
