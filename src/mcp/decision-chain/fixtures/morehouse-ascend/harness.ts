/**
 * Shared loader for the Morehouse Ascend cohort fixture.
 *
 * The regression suite (anchor-level) and the e2e suite (full production tool) read the
 * same participants, the same expectation labels and the same evidence rows. Keeping one
 * copy is what stops the two suites from silently drifting onto different fixtures and
 * both reporting green.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnchorEvidence, EntityIdentityStatus } from '@/lib/market/capability-anchor';
import { emptyAnchorEvidence } from '@/lib/market/capability-anchor';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import { deriveCompanyKeywords } from '@/mcp/tools/company-keywords';
import type { RecipientSearchRow } from '@/lib/bigquery/recipients';
import { CAPABILITY_HEADS } from '@/lib/market/capability-phrases';

export const FIXTURE_DIR = __dirname;

export interface Participant {
  id: string;
  company_name: string;
  contact_name: string;
  title: string;
  website: string;
  description: string;
}

export type ExpectationLevel = 'exact_expected' | 'behavioral_expected' | 'pending_exact_label';

export interface CaseSpec {
  participant_id: string;
  expectation_level: ExpectationLevel;
  /** For exact cases: the capability the anchor must materially express. */
  expected_capability?: string;
  forbidden_anchors?: string[];
  forbidden_substrings?: string[];
  required_capability_signals?: string[];
  required_behavior?: string;
  allow_no_anchor?: boolean;
  reject_generic_mission_led?: boolean;
  reject_unrelated_rd_fallback?: boolean;
  reject_naics_prefixes?: string[];
  reject_naics_prefixes_when_anchor_signals_construction?: string[];
  must_not_claim_high_confidence_without_evidence?: boolean;
  notes?: string;
}

interface ExpectedFile {
  cases: CaseSpec[];
  shared_forbidden: {
    generic_mission_led_substrings: string[];
    unrelated_rd_fallback_substrings: string[];
  };
}

interface EvidenceRow {
  identity?: EntityIdentityStatus;
  identityUei?: string | null;
  identityCandidates?: number;
  samNaics?: string[];
  awardNaics?: string[];
  awardObligatedUsd?: number | null;
}

const read = <T,>(file: string): T => JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as T;

export const participantsFile = read<{ count: number; participants: Participant[] }>('participants.json');
export const participants = participantsFile.participants;
export const expected = read<ExpectedFile>('expected-outcomes.json');
export const caseById = new Map<string, CaseSpec>(expected.cases.map((c) => [c.participant_id, c]));

const evidenceFile = read<{ by_company_name: Record<string, EvidenceRow>; default: EvidenceRow }>(
  'evidence-fixtures.json',
);
// Company names in the source spreadsheet vary in case ("BUILDING CONSULTANTS, INC.");
// an exact-key lookup silently fell through to the no-evidence default.
const evidenceByLowerName = new Map(
  Object.entries(evidenceFile.by_company_name).map(([k, v]) => [k.toLowerCase(), v]),
);

/** Deterministic stand-in for `loadAnchorEvidence`, identity gate included. All UEIs/NAICS here are synthetic. */
export function evidenceFor(clientName: string | undefined): AnchorEvidence {
  const row = (clientName && evidenceByLowerName.get(clientName.toLowerCase())) || evidenceFile.default;
  const claimedUnique = (row.identity ?? 'none') === 'unique';
  const uei = claimedUnique ? (row.identityUei ?? null) : null;
  // A unique claim with a malformed UEI is not corroboration — same gate as production.
  const resolved = claimedUnique && isWellFormedUei(uei);
  const identity: EntityIdentityStatus = resolved ? 'unique' : claimedUnique ? 'none' : (row.identity ?? 'none');
  return {
    ...emptyAnchorEvidence(),
    identity,
    identityUei: resolved ? String(uei).toUpperCase() : null,
    identityName: resolved ? (clientName ?? null) : null,
    identityCandidates: row.identityCandidates ?? (resolved ? 1 : 0),
    samNaics: resolved ? (row.samNaics ?? []) : [],
    awardNaics: resolved ? (row.awardNaics ?? []) : [],
    awardObligatedUsd: resolved ? (row.awardObligatedUsd ?? null) : null,
    samAsOf: resolved ? '2026-08-01' : null,
  };
}

export async function keywordsFor(p: Pick<Participant, 'description' | 'company_name'>): Promise<string[]> {
  const r = await deriveCompanyKeywords({
    description: p.description,
    brand_exclude: [p.company_name],
    limit: 25,
  });
  return r.keywords;
}

/**
 * Exact_expected matching: the anchor must express the labelled capability, not merely
 * share a nearby word. "energy solutions" is not "engineering services"; "infrastructure
 * modernization" is not "networks".
 *
 * Slashes in the label are alternatives ("civil/general construction" = construction
 * AND (civil OR general)). The last whitespace-delimited token is required unless it is
 * a packaging noun (services, capability, specialists).
 */
export function matchesExpectedCapability(expected: string, anchor: string | null): boolean {
  if (!anchor) return false;
  const a = anchor.toLowerCase();
  const label = expected.toLowerCase().trim();

  if (label.includes('/')) {
    const [alts, ...rest] = label.split(/\s+/);
    const requiredTail = rest.filter((t) => !PACKAGING.has(t));
    if (!requiredTail.every((t) => a.includes(t))) return false;
    return alts.split('/').some((opt) => a.includes(opt));
  }

  const tokens = label.split(/\s+/).filter((t) => !PACKAGING.has(t));
  if (!tokens.length) return a.includes(label);
  return tokens.every((t) => {
    if (t.endsWith('s') && t.length > 4) {
      const stem = t.slice(0, -1);
      return new RegExp(`\\b${stem}s?\\b`).test(a);
    }
    return a.includes(t);
  });
}

const PACKAGING = new Set(['services', 'service', 'capability', 'specialists', 'specialist']);

/**
 * Behavioral "this is a capability phrase" check — used by the e2e classifier for
 * the 24 cases that have no exact label. Forbidden mission/R&D language is never a
 * capability, even if it happens to end in a head noun.
 */
export function isCapabilityPhrase(spec: CaseSpec, anchor: string | null): boolean {
  const a = anchor?.toLowerCase().trim();
  if (!a) return false;
  if ((spec.forbidden_anchors ?? []).some((f) => a === f.toLowerCase())) return false;
  if ((spec.forbidden_substrings ?? []).some((f) => a.includes(f.toLowerCase()))) return false;
  const shared = expected.shared_forbidden;
  if (shared.generic_mission_led_substrings.some((f) => a.includes(f.toLowerCase()))) return false;
  if (shared.unrelated_rd_fallback_substrings.some((f) => a.includes(f.toLowerCase()))) return false;
  const words = a.split(/\s+/);
  if (words.length === 1) return CAPABILITY_HEADS.has(words[0]);
  return words.length >= 2 && CAPABILITY_HEADS.has(words[words.length - 1]);
}

/**
 * Synthetic competitor rows for the fabricated-relevance trap. UEIs are well-formed
 * 12-character identifiers, not SAM registrations. Two of three names only look
 * relevant because a substring matches a generic anchor word.
 */
export const FAKE_COMPETITORS: RecipientSearchRow[] = [
  {
    recipient_uei: 'SYNTH0OUT001',
    recipient_name: 'Outcomes Management Group LLC',
    city: 'Washington',
    state: 'DC',
    total_obligated: 50_000_000,
    award_count: 1,
    distinct_agency_count: 1,
    distinct_naics_count: 1,
  },
  {
    recipient_uei: 'SYNTH0CUS001',
    recipient_name: 'Customized Learning Partners Inc',
    city: 'Bethesda',
    state: 'MD',
    total_obligated: 30_000_000,
    award_count: 1,
    distinct_agency_count: 1,
    distinct_naics_count: 1,
  },
  {
    recipient_uei: 'SYNTH0LEG001',
    recipient_name: 'Legitimate Federal Contractor LLC',
    city: 'Arlington',
    state: 'VA',
    total_obligated: 120_000_000,
    award_count: 1,
    distinct_agency_count: 1,
    distinct_naics_count: 1,
  },
];
