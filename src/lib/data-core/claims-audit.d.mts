/**
 * Types for the shared C2 classifier (claims-audit.mjs).
 *
 * The implementation is plain `.mjs` ON PURPOSE: it must be importable BOTH by the
 * bundled server module (Platform Health) and by a plain `node scripts/...` CLI,
 * with no TS loader in either path. One implementation, two consumers, no drift.
 */
export type ClaimKind = 'derived' | 'pinned' | 'unfalsifiable' | 'contradicted';

export interface ClaimFinding {
  id: string;
  file: string;
  line: number;
  kind: ClaimKind;
  claimed: number | null;
  measured: number | null;
  detail: string;
  census: string;
}

export interface BaselineEntry {
  file: string; id: string; kind: string;
  claimed: number | null; measured: number | null;
}

/** @returns findings, or `null` when the registry could not be read (= unmeasured). */
export function computeClaimFindings(root?: string): ClaimFinding[] | null;
export function selectNewFindings(findings: ClaimFinding[], baselineFindings: BaselineEntry[]): ClaimFinding[];
