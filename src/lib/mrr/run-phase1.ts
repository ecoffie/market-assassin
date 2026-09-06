import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRequirement } from './normalizer';
import { buildSection5, type Section5 } from './section-5-taxonomy';
import { buildSection9, type Section9 } from './section-9-history';
import { buildSection11, type Section11 } from './section-11-suppliers';
import { buildSection12, type Section12 } from './section-12-rule-of-two';
import { buildSection15, type Section15 } from './section-15-intel';
import { assembleMrr, type AssembleResult } from './assemble';
import { writeAppendix, type AppendixInput } from './appendix';
import {
  PROTOTYPE_BANNER,
  TEMPLATE_PATH,
  getDocumentXml,
  readDocxParts,
  sha256File,
  writeDocx,
} from './docx-fill';
import { isPrimaryVerified, tableCitation } from './sba-size-standards';
import type { NormalizedRequirement } from './types';

export const DEFAULT_REQUIREMENT = {
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  sub_agency: 'Department of Defense',
  naics: '541512',
  psc: 'DA01',
  keyword: 'modeling and simulation',
  description:
    'The Defense Health Agency (DHA), Joint Operational Medicine Information Systems (JOMIS) Program ' +
    'Management Office is conducting market research on joint medical planning, modeling and simulation ' +
    'capabilities. Sources sought notice; responses due 2026-09-13.',
  solicitation_number: 'DHA_JOMIS_JMP_20260813',
  notice_id: '213a2fe3a447465e8f30699c9f056ec4',
} as const;

export const WORKSPACE_PROTOTYPE_BANNER =
  'PROTOTYPE — PUBLIC-DATA DEMO — NOT FOR SIGNATURE';

export type Phase1ProgressStage =
  | 'queued'
  | 'running_section_5'
  | 'running_section_9'
  | 'running_section_11'
  | 'running_section_12'
  | 'running_section_15'
  | 'assembling_documents'
  | 'complete'
  | 'complete_degraded'
  | 'failed';

export interface Phase1Artifacts {
  mrr: { path: string; fileName: string };
  appendix: { path: string; fileName: string };
  evidence: { path: string; fileName: string };
}

export interface Phase1RunResult {
  runId: string;
  intakeHash: string;
  generatedAt: string;
  requirement: NormalizedRequirement;
  section5: Section5;
  section9: Section9;
  section11: Section11;
  section12: Section12;
  section15: Section15;
  cells: AssembleResult['cells'];
  limitations: string[];
  artifacts: Phase1Artifacts;
}

export interface Phase1Dependencies {
  buildSection5: typeof buildSection5;
  buildSection9: typeof buildSection9;
  buildSection11: typeof buildSection11;
  buildSection12: typeof buildSection12;
  buildSection15: typeof buildSection15;
  assembleMrr: typeof assembleMrr;
  writeAppendix: (input: AppendixInput, outPath: string) => Promise<void>;
  templateSha256: () => string;
  applyWorkspaceBanner: (outPath: string) => void;
}

export interface RunPhase1Options {
  runId: string;
  intakeHash: string;
  outDir?: string;
  onProgress?: (stage: Phase1ProgressStage) => void | Promise<void>;
  dependencies?: Partial<Phase1Dependencies>;
  now?: () => Date;
}

const DEFAULT_DEPENDENCIES: Phase1Dependencies = {
  buildSection5,
  buildSection9,
  buildSection11,
  buildSection12,
  buildSection15,
  assembleMrr,
  writeAppendix,
  templateSha256: () => sha256File(TEMPLATE_PATH),
  applyWorkspaceBanner: applyWorkspacePrototypeBanner,
};

export function applyWorkspacePrototypeBanner(outPath: string): void {
  const parts = readDocxParts(outPath);
  const xml = getDocumentXml(parts);
  if (!xml.includes(PROTOTYPE_BANNER)) {
    throw new Error(`Generated DOCX is missing the prototype banner: ${outPath}`);
  }
  writeDocx(
    parts,
    xml.replaceAll(PROTOTYPE_BANNER, WORKSPACE_PROTOTYPE_BANNER),
    outPath,
  );
}

function safeBase(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'requirement';
}

function buildLimitations(
  s11: Section11,
  s12: Section12,
  s15: Section15,
  runId: string,
  intakeHash: string,
): string[] {
  return [
    'Phase 1 populates §5 (Taxonomy), §9 (Procurement History), §11 (Potential Suppliers), §12 (Small Business / Rule of Two), and §15 (Market Intelligence). Remaining sections are Phase 2 placeholders.',
    'Predecessor / incumbent results are inferential and agency-validated; they are never a certified contract lineage.',
    `SBA size standards come from a limited versioned local fixture (${tableCitation()}), not the full published table${isPrimaryVerified() ? ', though every included value was read from the authoritative source' : ', and the value was corroborated only from SECONDARY sources because the primary host blocks automated retrieval — REQUIRES HUMAN CONFIRMATION before signature'}.`,
    'Corporate-family deduplication uses current-state USASpending parent_uei edges only. It is NOT point-in-time safe for investment backtests. Name/amount/keyword heuristics never create a parent match. Ambiguous parentage stays unresolved and cannot satisfy Rule of Two.',
    'Supplier counts distinguish raw UEI rows from parent-deduplicated families. Truncated samples are never treated as populations.',
    'Pricing in §15 is supporting market evidence only — never an Independent Government Estimate. The KO owns the IGE in Phase 2.',
    ...s11.limitations.map((limitation) => `§11: ${limitation}`),
    ...s12.limitations.map((limitation) => `§12: ${limitation}`),
    ...s15.limitations.map((limitation) => `§15: ${limitation}`),
    `Run identity: ${runId}; normalized intake hash: ${intakeHash}.`,
    `This artifact is a draft for review. ${WORKSPACE_PROTOTYPE_BANNER}.`,
  ];
}

function sourcedGoalingFiscalYear(section: Section12): number | null {
  const call = section.calls.find((item) => item.tool === 'get_sba_goaling_share');
  const fromArgs = call?.args?.fiscal_year;
  const fromResult = (call?.result as { fiscal_year?: unknown } | undefined)?.fiscal_year;
  if (typeof fromArgs === 'number' && Number.isFinite(fromArgs)) return fromArgs;
  if (typeof fromResult === 'number' && Number.isFinite(fromResult)) return fromResult;
  return null;
}

function buildEvidenceBundle(result: Omit<Phase1RunResult, 'artifacts'>, templateSha256: string) {
  const { section5: s5, section9: s9, section11: s11, section12: s12, section15: s15 } = result;
  const calls = [...s5.calls, ...s9.calls, ...s11.calls, ...s12.calls, ...s15.calls];

  return {
    runId: result.runId,
    intakeHash: result.intakeHash,
    generatedAt: result.generatedAt,
    prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
    requirement: result.requirement.normalized,
    normalizationNotes: result.requirement.notes,
    templateSha256,
    cells: result.cells.map((cell) => ({
      label: cell.label,
      state: cell.state,
      text: cell.text,
      evidence: cell.evidence,
      reason: cell.reason,
    })),
    calls: calls.map((call) => ({
      tool: call.tool,
      args: call.args,
      ok: call.ok,
      error: call.error,
      retrievedAt: call.evidence.retrievedAt,
    })),
    predecessor: {
      status: s9.predecessorStatus,
      source: s9.predecessorSource,
      checks: s9.predecessorChecks,
      candidate: s9.predecessorCandidate,
    },
    suppliers: {
      rawUeiCount: s11.rawUeiCount,
      boundedSampleReturned: s11.boundedSampleReturned,
      capableActiveCount: s11.capableActiveCount,
      evaluatedUeiCount: s11.evaluatedUeiCount,
      excludedBeforeFamilyResolution: s11.excludedBeforeFamilyResolution,
      toolLimit: s11.toolLimit,
      deduplicatedFamilyCount: s11.deduplicatedFamilyCount,
      ambiguousParentCount: s11.ambiguousParentCount,
      eligiblePopulation: s11.eligiblePopulation,
      matchingCoverage: s11.matchingCoverage,
      sampleToMatchingCoverage: s11.sampleToMatchingCoverage,
      displayedVendorRows: Math.min(s11.suppliers.length, 25),
      families: s11.suppliers.slice(0, 50).map((supplier) => ({
        uei: supplier.uei.state === 'value' ? supplier.uei.value : supplier.family.rawUei,
        familyKey: supplier.family.canonical?.familyKey ?? null,
        method: supplier.family.method,
        confidence: supplier.family.confidence,
        ruleOfTwoEligible: supplier.family.ruleOfTwoEligible,
        memberUeis: supplier.family.memberUeis,
      })),
    },
    ruleOfTwo: {
      determination: s12.determination,
      recommendation: s12.recommendation,
      capableFamilyCount: s12.capableFamilyCount,
      countedFamilies: s12.countedFamilies,
      excluded: s12.excluded,
      socioCounts: s12.socioCounts,
      goalingFiscalYear: sourcedGoalingFiscalYear(s12),
    },
    marketIntel: {
      totalMarket: s15.totalMarket,
      pricingIsIge: s15.pricingIsIge,
      pricingEvidence: s15.pricingEvidence,
      sbFootprint: s15.sbFootprint,
    },
    limitations: result.limitations,
  };
}

export async function runPhase1(
  input: Record<string, unknown>,
  options: RunPhase1Options,
): Promise<Phase1RunResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const progress = async (stage: Phase1ProgressStage) => {
    await options.onProgress?.(stage);
  };
  const requirement = normalizeRequirement(input);
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const outDir = options.outDir ?? join(process.cwd(), 'out', 'mrr-workspace', options.runId);
  mkdirSync(outDir, { recursive: true });

  await progress('running_section_5');
  const section5 = await dependencies.buildSection5(requirement.normalized);
  const primaryNaics =
    section5.primaryNaics.state === 'value' ? section5.primaryNaics.value : undefined;

  await progress('running_section_9');
  const section9 = await dependencies.buildSection9(requirement.normalized, primaryNaics);

  await progress('running_section_11');
  const section11 = await dependencies.buildSection11(requirement.normalized, primaryNaics);

  await progress('running_section_12');
  const section12 = await dependencies.buildSection12(
    requirement.normalized,
    primaryNaics,
    section11,
  );

  await progress('running_section_15');
  const section15 = await dependencies.buildSection15(
    requirement.normalized,
    primaryNaics,
    section5,
    section12,
  );

  await progress('assembling_documents');
  const base = safeBase(requirement.normalized.solicitation_number ?? requirement.normalized.title);
  const identity = `${base}-${options.runId}`;
  const mrr = { path: join(outDir, `MRR-${identity}.docx`), fileName: `MRR-${identity}.docx` };
  const appendix = {
    path: join(outDir, `MRR-${identity}-appendix.docx`),
    fileName: `MRR-${identity}-appendix.docx`,
  };
  const evidenceArtifact = {
    path: join(outDir, `MRR-${identity}-evidence.json`),
    fileName: `MRR-${identity}-evidence.json`,
  };

  const { cells } = dependencies.assembleMrr(
    requirement.normalized,
    section5,
    section9,
    section11,
    section12,
    section15,
    mrr.path,
    generatedAt,
    options.runId,
  );
  dependencies.applyWorkspaceBanner(mrr.path);
  const limitations = buildLimitations(
    section11,
    section12,
    section15,
    options.runId,
    options.intakeHash,
  );
  const calls = [
    ...section5.calls,
    ...section9.calls,
    ...section11.calls,
    ...section12.calls,
    ...section15.calls,
  ];
  await dependencies.writeAppendix(
    {
      requirementTitle: requirement.normalized.title,
      solicitationNumber: requirement.normalized.solicitation_number,
      noticeId: requirement.normalized.notice_id,
      generatedAt,
      runId: options.runId,
      cells,
      calls,
      ...(section9.predecessorCandidate
        ? {
            rejectedCandidate: {
              source: section9.predecessorSource,
              checks: section9.predecessorChecks,
              candidate: section9.predecessorCandidate,
            },
          }
        : {}),
      limitations,
    },
    appendix.path,
  );
  dependencies.applyWorkspaceBanner(appendix.path);

  const resultWithoutArtifacts = {
    runId: options.runId,
    intakeHash: options.intakeHash,
    generatedAt,
    requirement,
    section5,
    section9,
    section11,
    section12,
    section15,
    cells,
    limitations,
  };
  writeFileSync(
    evidenceArtifact.path,
    JSON.stringify(
      buildEvidenceBundle(resultWithoutArtifacts, dependencies.templateSha256()),
      null,
      2,
    ),
  );

  await progress(cells.some((cell) => cell.state === 'degraded') ? 'complete_degraded' : 'complete');
  return {
    ...resultWithoutArtifacts,
    artifacts: { mrr, appendix, evidence: evidenceArtifact },
  };
}
