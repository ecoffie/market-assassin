import type { CsvValidation } from './csv-validate';
import { classifyZipMember, type ZipMember } from './zip-members';

export type AwardsPipelineStep =
  | 'classify_zip'
  | 'validate_contracts'
  | 'merge'
  | 'rebuild_recipients'
  | 'stamp_clocks';

export type AwardsPipelinePlan =
  | {
      status: 'ready';
      steps: AwardsPipelineStep[];
      loadablePaths: string[];
    }
  | {
      status: 'classified_failure' | 'empty_acquisition';
      steps: AwardsPipelineStep[];
      reason: string;
    };

export type AwardsPipelineOutcome =
  | { status: 'success'; exitCode: 0 }
  | { status: 'failed_merge'; exitCode: 1 }
  | { status: 'failed_recipients_rebuild'; exitCode: 1 }
  | { status: 'failed_clock_stamp'; exitCode: 1 };

export type AwardsPipelineExecution =
  | { lastCompleted: 'validate_contracts'; failedAt: 'merge' }
  | { lastCompleted: 'merge'; failedAt: 'rebuild_recipients' }
  | { lastCompleted: 'rebuild_recipients'; failedAt: 'stamp_clocks' }
  | { lastCompleted: 'stamp_clocks' };

export function classifyMembers(paths: string[]): ZipMember[] {
  return paths.map(classifyZipMember);
}

export function assertLoadableAcquisition(members: ZipMember[]): string[] {
  const failures = members.filter((member) =>
    member.kind === 'idv' || member.kind === 'assistance' || member.kind === 'unknown');
  if (failures.length > 0) {
    const summary = failures.map((member) => `${member.kind}:${member.path}`).join(', ');
    throw new Error(`unsupported or unknown ZIP members: ${summary}`);
  }
  const contracts = members
    .filter((member): member is Extract<ZipMember, { kind: 'contracts' }> => member.kind === 'contracts')
    .map((member) => member.path);
  if (contracts.length === 0) throw new Error('no contracts CSV found in acquisition');
  return contracts;
}

export function buildPipelinePlan(input: {
  members: ZipMember[];
  csvValidations: Array<CsvValidation & { path: string }>;
}): AwardsPipelinePlan {
  let loadablePaths: string[];
  try {
    loadablePaths = assertLoadableAcquisition(input.members);
  } catch (error) {
    return {
      status: 'classified_failure',
      steps: ['classify_zip'],
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const validationsByPath = new Map(input.csvValidations.map((validation) => [validation.path, validation]));
  const invalid = loadablePaths.filter((path) => validationsByPath.get(path)?.status !== 'loadable');
  if (invalid.length > 0) {
    return {
      status: 'empty_acquisition',
      steps: ['classify_zip', 'validate_contracts'],
      reason: `empty or unvalidated contracts CSV: ${invalid.join(', ')}`,
    };
  }

  return {
    status: 'ready',
    steps: ['classify_zip', 'validate_contracts', 'merge', 'rebuild_recipients', 'stamp_clocks'],
    loadablePaths,
  };
}

export function pipelineOutcome(execution: AwardsPipelineExecution): AwardsPipelineOutcome {
  switch (execution.lastCompleted) {
    case 'validate_contracts':
      return { status: 'failed_merge', exitCode: 1 };
    case 'merge':
      return { status: 'failed_recipients_rebuild', exitCode: 1 };
    case 'rebuild_recipients':
      return { status: 'failed_clock_stamp', exitCode: 1 };
    case 'stamp_clocks':
      return { status: 'success', exitCode: 0 };
  }
}
