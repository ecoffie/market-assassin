/**
 * Reconstruct the shared Phase 1 review DTO from a run's evidence bundle.
 *
 * Live completion (`startMrrJob`) and restamp/reassembly both call
 * `createPhase1ReviewDto`. This module is the evidence → review-source half
 * so a completed run can be persisted after process restart without MCP or
 * BigQuery, and without a second review schema.
 */
import type { RenderedCell } from './grounding';
import type {
  EvidenceRef,
  GroundedField,
  Requirement,
  RuleOfTwoDetermination,
} from './types';
import type { Phase1ReviewSource } from './workspace-dto';

const CELL_STATES = new Set(['value', 'true_zero', 'unknown', 'degraded']);
const ROT_VALUES = new Set<RuleOfTwoDetermination>(['met', 'not_met', 'undetermined']);

export function requireRunIdentity(bundle: {
  runId?: unknown;
  generatedAt?: unknown;
}): { runId: string; generatedAt: string } {
  const runId = typeof bundle.runId === 'string' ? bundle.runId.trim() : '';
  const generatedAt = typeof bundle.generatedAt === 'string' ? bundle.generatedAt.trim() : '';
  if (!runId) {
    throw new Error('reassembly refused: evidence is missing runId — will not mint a replacement identity');
  }
  if (!generatedAt) {
    throw new Error('reassembly refused: evidence is missing generatedAt — will not mint "now"');
  }
  return { runId, generatedAt };
}

export function requireFiniteCensus(label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `reassembly refused: missing required census field ${label} — will not substitute a fixture default`,
    );
  }
  return value;
}

export function requireEvidenceRequirement(bundle: { requirement?: unknown }): {
  title: string;
  agency: string;
  naics: string;
  office: string | undefined;
} {
  const req = bundle.requirement;
  if (!req || typeof req !== 'object') {
    throw new Error(
      'reassembly refused: evidence bundle missing requirement — will not substitute fixture agency/NAICS',
    );
  }
  const r = req as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const agency = typeof r.agency === 'string' ? r.agency.trim() : '';
  const naics = typeof r.naics === 'string' ? r.naics.trim() : '';
  const office = typeof r.office === 'string' && r.office.trim() ? r.office.trim() : undefined;
  if (!title) {
    throw new Error('reassembly refused: evidence requirement missing title — will not substitute a fixture title');
  }
  if (!agency) {
    throw new Error('reassembly refused: evidence requirement missing agency — will not substitute a fixture agency');
  }
  if (!naics) {
    throw new Error('reassembly refused: evidence requirement missing naics — will not substitute a fixture NAICS');
  }
  return { title, agency, naics, office };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`reassembly refused: missing or malformed ${label}`);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseEvidenceRef(label: string, raw: unknown): EvidenceRef {
  const rec = asRecord(raw, `evidence ref for ${label}`);
  const source = optionalText(rec.source);
  const retrievedAt = optionalText(rec.retrievedAt);
  if (!source) {
    throw new Error(`reassembly refused: ${label} evidence is missing source`);
  }
  if (!retrievedAt) {
    throw new Error(`reassembly refused: ${label} evidence is missing retrievedAt — will not mint "now"`);
  }
  if (!rec.query || typeof rec.query !== 'object' || Array.isArray(rec.query)) {
    throw new Error(`reassembly refused: ${label} evidence is missing query`);
  }
  return {
    source,
    retrievedAt,
    query: rec.query as Record<string, unknown>,
    ...(optionalText(rec.url) ? { url: optionalText(rec.url) } : {}),
  };
}

function parseEvidenceRefList(label: string, raw: unknown): EvidenceRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`reassembly refused: ${label} evidence list is malformed`);
  }
  return raw.map((item, index) => parseEvidenceRef(`${label}[${index}]`, item));
}

function parseGroundedField<T>(
  label: string,
  raw: unknown,
  parseValue: (value: unknown) => T,
): GroundedField<T> {
  const rec = asRecord(raw, `grounded field ${label}`);
  switch (rec.state) {
    case 'value':
      return { state: 'value', value: parseValue(rec.value), evidence: parseEvidenceRef(label, rec.evidence) };
    case 'true_zero': {
      const zeroLabel = optionalText(rec.label);
      if (!zeroLabel) {
        throw new Error(`reassembly refused: true_zero ${label} is missing its measured-zero label`);
      }
      return {
        state: 'true_zero',
        value: 0,
        label: zeroLabel,
        evidence: parseEvidenceRef(label, rec.evidence),
      };
    }
    case 'unknown': {
      const reason = optionalText(rec.reason);
      if (!reason) {
        throw new Error(`reassembly refused: unknown ${label} is missing a reason`);
      }
      return {
        state: 'unknown',
        reason,
        ...(rec.attemptedEvidence !== undefined
          ? { attemptedEvidence: parseEvidenceRefList(label, rec.attemptedEvidence) }
          : {}),
      };
    }
    case 'degraded': {
      const reason = optionalText(rec.reason);
      if (!reason) {
        throw new Error(`reassembly refused: degraded ${label} is missing a reason`);
      }
      const evidence = parseEvidenceRefList(label, rec.evidence);
      if (evidence.length === 0) {
        throw new Error(`reassembly refused: degraded ${label} has no evidence`);
      }
      return rec.value === undefined
        ? { state: 'degraded', reason, evidence }
        : { state: 'degraded', reason, evidence, value: parseValue(rec.value) };
    }
    default:
      throw new Error(`reassembly refused: ${label} has an unknown grounding state`);
  }
}

function parseFiniteNumber(label: string, value: unknown): number {
  return requireFiniteCensus(label, value);
}

function parseNonEmptyString(label: string, value: unknown): string {
  const text = optionalText(value);
  if (!text) {
    throw new Error(`reassembly refused: ${label} is not a sourced string`);
  }
  return text;
}

function parseDetermination(value: unknown): RuleOfTwoDetermination {
  if (typeof value === 'string' && ROT_VALUES.has(value as RuleOfTwoDetermination)) {
    return value as RuleOfTwoDetermination;
  }
  throw new Error('reassembly refused: Rule-of-Two determination is not a sourced vocabulary value');
}

function parseCell(raw: unknown, index: number): RenderedCell {
  const rec = asRecord(raw, `cell[${index}]`);
  const label = optionalText(rec.label);
  if (!label) {
    throw new Error(`reassembly refused: cell[${index}] is missing a label`);
  }
  if (typeof rec.state !== 'string' || !CELL_STATES.has(rec.state)) {
    throw new Error(`reassembly refused: ${label} has an unknown cell state`);
  }
  if (typeof rec.text !== 'string') {
    throw new Error(`reassembly refused: ${label} is missing cell text`);
  }
  return {
    label,
    state: rec.state as RenderedCell['state'],
    text: rec.text,
    evidence: parseEvidenceRefList(label, rec.evidence ?? []),
    ...(optionalText(rec.reason) ? { reason: optionalText(rec.reason) } : {}),
  };
}

function parseRequirement(bundle: { requirement?: unknown }): Requirement {
  const identity = requireEvidenceRequirement(bundle);
  const rec = asRecord(bundle.requirement, 'requirement');
  const keyword = optionalText(rec.keyword);
  const description = optionalText(rec.description);
  if (!keyword) {
    throw new Error('reassembly refused: evidence requirement missing keyword — will not substitute a fixture keyword');
  }
  if (!description) {
    throw new Error(
      'reassembly refused: evidence requirement missing description — will not substitute a fixture description',
    );
  }
  return {
    title: identity.title,
    agency: identity.agency,
    naics: identity.naics,
    keyword,
    description,
    ...(identity.office ? { office: identity.office } : {}),
    ...(optionalText(rec.sub_agency) ? { sub_agency: optionalText(rec.sub_agency) } : {}),
    ...(optionalText(rec.psc) ? { psc: optionalText(rec.psc) } : {}),
    ...(optionalText(rec.solicitation_number)
      ? { solicitation_number: optionalText(rec.solicitation_number) }
      : {}),
    ...(optionalText(rec.notice_id) ? { notice_id: optionalText(rec.notice_id) } : {}),
  };
}

function parseIntakeHash(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) {
    throw new Error('reassembly refused: evidence is missing intakeHash — will not mint a replacement identity');
  }
  return raw;
}

function parseNotes(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    throw new Error('reassembly refused: normalizationNotes is malformed');
  }
  return raw as string[];
}

function sectionLimitations(all: unknown, section: '11' | '12' | '15'): string[] {
  if (all === undefined) return [];
  if (!Array.isArray(all) || all.some((item) => typeof item !== 'string')) {
    throw new Error('reassembly refused: limitations list is malformed');
  }
  const prefix = `§${section}:`;
  return (all as string[])
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length).trimStart());
}

function parseFamilies(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) {
    throw new Error('reassembly refused: supplier families are missing — will not invent a displayed-row count');
  }
  return raw;
}

export function reviewSourceFromEvidence(
  bundle: unknown,
  expected: { runId: string; intakeHash?: string },
): Phase1ReviewSource {
  const record = asRecord(bundle, 'evidence bundle');
  const { runId, generatedAt } = requireRunIdentity(record);
  if (runId !== expected.runId) {
    throw new Error(
      `reassembly refused: evidence runId ${runId} does not match the bound run ${expected.runId}`,
    );
  }
  const intakeHash = parseIntakeHash(record.intakeHash);
  if (expected.intakeHash && expected.intakeHash !== intakeHash) {
    throw new Error('reassembly refused: evidence intakeHash does not match the bound job identity');
  }
  if (!Array.isArray(record.cells) || record.cells.length === 0) {
    throw new Error('reassembly refused: evidence cells are missing — will not invent a review');
  }

  const suppliers = asRecord(record.suppliers, 'suppliers');
  const ruleOfTwo = asRecord(record.ruleOfTwo, 'ruleOfTwo');
  const marketIntel = asRecord(record.marketIntel, 'marketIntel');
  const requirement = parseRequirement(record);

  return {
    runId,
    intakeHash,
    generatedAt,
    requirement: {
      normalized: requirement,
      notes: parseNotes(record.normalizationNotes),
    },
    cells: record.cells.map((cell, index) => parseCell(cell, index)),
    section11: {
      suppliers: parseFamilies(suppliers.families),
      rawUeiCount: parseGroundedField('Matching UEIs', suppliers.rawUeiCount, (value) =>
        parseFiniteNumber('Matching UEIs', value),
      ),
      evaluatedUeiCount: parseGroundedField(
        'Submitted for family resolution',
        suppliers.evaluatedUeiCount,
        (value) => parseFiniteNumber('Submitted for family resolution', value),
      ),
      boundedSampleReturned: parseGroundedField(
        'Bounded sample returned',
        suppliers.boundedSampleReturned,
        (value) => parseFiniteNumber('Bounded sample returned', value),
      ),
      capableActiveCount: parseGroundedField(
        'Capable/active after tier filtering',
        suppliers.capableActiveCount,
        (value) => parseFiniteNumber('Capable/active after tier filtering', value),
      ),
      excludedBeforeFamilyResolution: parseGroundedField(
        'Excluded before family resolution',
        suppliers.excludedBeforeFamilyResolution,
        (value) => parseFiniteNumber('Excluded before family resolution', value),
      ),
      deduplicatedFamilyCount: parseGroundedField(
        'Resolved corporate families',
        suppliers.deduplicatedFamilyCount,
        (value) => parseFiniteNumber('Resolved corporate families', value),
      ),
      ambiguousParentCount: parseGroundedField(
        'Ambiguous/unresolved parents',
        suppliers.ambiguousParentCount,
        (value) => parseFiniteNumber('Ambiguous/unresolved parents', value),
      ),
      eligiblePopulation: parseGroundedField('Eligible population', suppliers.eligiblePopulation, (value) =>
        parseFiniteNumber('Eligible population', value),
      ),
      limitations: sectionLimitations(record.limitations, '11'),
    },
    section12: {
      determination: parseGroundedField('Rule-of-Two determination', ruleOfTwo.determination, parseDetermination),
      recommendation: parseGroundedField('Set-aside recommendation', ruleOfTwo.recommendation, (value) =>
        parseNonEmptyString('Set-aside recommendation', value),
      ),
      limitations: sectionLimitations(record.limitations, '12'),
    },
    section15: {
      pricingEvidence: parseGroundedField('Supporting pricing evidence', marketIntel.pricingEvidence, (value) =>
        parseNonEmptyString('Supporting pricing evidence', value),
      ),
      limitations: sectionLimitations(record.limitations, '15'),
    },
  };
}
