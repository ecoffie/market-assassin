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

export const PROGRESS_LABEL: Record<Phase1ProgressStage, string> = {
  queued: 'Understanding the buyer',
  running_section_5: 'Understanding the buyer',
  running_section_9: 'Reviewing buyer history',
  running_section_11: 'Checking supplier capacity',
  running_section_12: 'Reviewing competition evidence',
  running_section_15: 'Preparing the decision',
  assembling_documents: 'Preparing the decision',
  complete: 'Research complete',
  // Do not surface "complete_degraded" as a primary label — methodology holds the detail.
  complete_degraded: 'Research complete',
  failed: 'Research failed',
};

/** Five demo-facing stages (engine stages map onto these; internals stay hidden). */
export const DEMO_PROGRESS_STAGES = [
  'Understanding the buyer',
  'Reviewing buyer history',
  'Checking supplier capacity',
  'Reviewing competition evidence',
  'Preparing the decision',
] as const;

export function demoProgressIndex(stage: Phase1ProgressStage): number {
  switch (stage) {
    case 'queued':
    case 'running_section_5':
      return 0;
    case 'running_section_9':
      return 1;
    case 'running_section_11':
      return 2;
    case 'running_section_12':
      return 3;
    case 'running_section_15':
    case 'assembling_documents':
    case 'complete':
    case 'complete_degraded':
      return 4;
    case 'failed':
      return -1;
    default:
      return 0;
  }
}

export type MrrJobStatus = 'queued' | 'running' | 'done' | 'error';
export type MrrArtifactKind = 'mrr' | 'appendix' | 'evidence';

export const MRR_ARTIFACT_KINDS: readonly MrrArtifactKind[] = [
  'mrr',
  'appendix',
  'evidence',
];

export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isSafeMrrRunId(id: string): boolean {
  return RUN_ID_PATTERN.test(id);
}
