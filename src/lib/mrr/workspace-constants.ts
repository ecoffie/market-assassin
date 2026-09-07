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
  queued: 'Queued',
  running_section_5: 'Researching §5 Taxonomy',
  running_section_9: 'Researching §9 Procurement History',
  running_section_11: 'Researching §11 Potential Suppliers',
  running_section_12: 'Assessing §12 Small Business / Rule of Two',
  running_section_15: 'Researching §15 Market Intelligence',
  assembling_documents: 'Assembling MRR and evidence artifacts',
  complete: 'Complete',
  complete_degraded: 'Complete with degraded evidence',
  failed: 'Failed',
};

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
