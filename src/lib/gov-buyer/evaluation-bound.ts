/**
 * Evaluation-bound helpers for assess_market_depth / MRR §11.
 *
 * Census counts (eligible population, matching UEIs) are measured separately
 * from the UEI sample that is scored and family-resolved. `limit` is the
 * evaluation sample size — never a population cap, and never a license to
 * build a ~2,500-UEI BigQuery activity pool.
 */

/** Historic cost-bomb floor: max(limit×10, 2500) activity EXISTS. */
export const FORBIDDEN_ACTIVITY_POOL_FLOOR = 2_500;

/** Activity EXISTS billed-bytes cap for the evaluation sample only. */
export const ACTIVITY_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Real 541512 UEIs from the live DHA JOMIS evaluated set.
 * Synthetic UEIs are invalid cost evidence — clustering prunes empty blocks.
 */
export const REAL_541512_ACTIVITY_UEIS = [
  'C5DRJNDU5LD7',
  'NLXHVL2Z2967',
  'HCBJCK2G9EM1',
  'QNM9J87U6PW4',
  'CB42CNL4JNM5',
  'JY5MNLLPX1K5',
  'DK3YDPKR7DA9',
  'N8MCPJFMLSM4',
  'DCYJEYKZNYX5',
  'GB4LSAFPM513',
] as const;

/**
 * Same 50 real 541512 UEIs used for the parent-edge batch dry-run.
 * 43 are the capable/active families from run h_gWL9VCEws; 7 more are
 * additional real UEIs from that DHA evaluated set (the 10-UEI activity
 * fingerprint minus overlap). Synthetic UEIs are invalid cost evidence.
 */
export const REAL_541512_PARENT_BATCH_UEIS = [
  'G9GRLUNKF3T4',
  'K22WGLWY6ZK6',
  'HCBJCK2G9EM1',
  'GMLCLKXPK8S3',
  'MMJUKEH7ENA7',
  'KAKNBZ3MWJV3',
  'JDP4LVPK5JR9',
  'LYMKSJG6DLQ5',
  'JSL9E59CT6J9',
  'MMNMLCK4KTJ4',
  'LUAJMZUYPN69',
  'EBC8TT6W1LR7',
  'NNHYHBK3HD45',
  'JZR9XYGMPLY5',
  'CSR2PJKFP7H3',
  'CJN6YQNAKHQ1',
  'CHNNG7Z26293',
  'LL15D6XUN6E9',
  'KGFLM4FB7M99',
  'FLG4E9KX6Z86',
  'M33RDNML7LD3',
  'ML65Z3L75MQ1',
  'JHH5NXX58DM4',
  'HXLKB5PUEUM7',
  'G76WDNVMM3K3',
  'MHKSZC69V2Q3',
  'LJM9BNU47VP8',
  'JKR6NFJ3BX37',
  'CU11EQG1CTY9',
  'D1RRJ5JVNKQ9',
  'G61TZZQKC3L9',
  'JS2LX8NLBPJ8',
  'N3T8X4HCMNB7',
  'FMCVFMNEQF31',
  'JA6DRAGJ4JJ1',
  'MTBPNK9AH9J5',
  'LY9DQ99L8817',
  'JZJ5JTQAJ1Z2',
  'C116E6T5MGD6',
  'C113JMW3WGS7',
  'C11UNZ93M595',
  'C12KE5EJ5HM8',
  'C12EWRVYBKX5',
  'C5DRJNDU5LD7',
  'NLXHVL2Z2967',
  'QNM9J87U6PW4',
  'CB42CNL4JNM5',
  'JY5MNLLPX1K5',
  'DK3YDPKR7DA9',
  'N8MCPJFMLSM4',
] as const;

export function uniqueUeis(ueis: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ueis) {
    const uei = String(raw ?? '').trim().toUpperCase();
    if (!uei || seen.has(uei)) continue;
    seen.add(uei);
    out.push(uei);
  }
  return out;
}

export function evaluationCap(limit: number | undefined, fallback = 200): number {
  const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.max(1, n);
}

export function assertBoundedActivityPool(limit: number | undefined, activityUeiCount: number): void {
  const cap = evaluationCap(limit);
  if (activityUeiCount > cap) {
    throw new Error(
      `activity pool ${activityUeiCount} exceeds evaluation cap ${cap} — refusing to reconstruct the inflated EXISTS join`,
    );
  }
  if (activityUeiCount >= FORBIDDEN_ACTIVITY_POOL_FLOOR) {
    throw new Error(
      `activity pool ${activityUeiCount} reconstructs the ${FORBIDDEN_ACTIVITY_POOL_FLOOR}-UEI cost bomb`,
    );
  }
}

export type SamSizeStatus = 'Y' | 'N' | 'E';

/** SAM per-NAICS size only. Missing / wrong-code / garbage → null. Never inferred. */
export function sizeStatusForNaics(
  map: Record<string, string> | null | undefined,
  naics: string,
): SamSizeStatus | null {
  const code = String(naics ?? '').trim();
  if (!code || !map || typeof map !== 'object') return null;
  const raw = map[code];
  if (raw === 'Y' || raw === 'N' || raw === 'E') return raw;
  return null;
}

export function describeSamSizeForRequirement(opts: {
  sizeStatus: SamSizeStatus | null | undefined;
  sizeStatusNaics: string | null | undefined;
  requirementNaics: string;
}): { established: boolean; small: boolean | null; label: string; reason: string } {
  const requirementNaics = String(opts.requirementNaics ?? '').trim();
  if (!requirementNaics) {
    return {
      established: false,
      small: null,
      label: '',
      reason: 'requirement NAICS was not established — SAM size cannot be applied',
    };
  }
  if (!opts.sizeStatusNaics || opts.sizeStatusNaics !== requirementNaics) {
    return {
      established: false,
      small: null,
      label: '',
      reason: `SAM size status was not stated for requirement NAICS ${requirementNaics}`,
    };
  }
  if (opts.sizeStatus === 'E') {
    return {
      established: false,
      small: null,
      label: '',
      reason:
        `SBA size-standard exception for NAICS ${requirementNaics} — ordinary small / other-than-small does not apply`,
    };
  }
  if (opts.sizeStatus === 'Y') {
    return {
      established: true,
      small: true,
      label: `Small (SAM self-certified for NAICS ${requirementNaics}; not an SBA size determination)`,
      reason: '',
    };
  }
  if (opts.sizeStatus === 'N') {
    return {
      established: true,
      small: false,
      label: `Other than small (SAM self-certified for NAICS ${requirementNaics}; not an SBA size determination)`,
      reason: '',
    };
  }
  return {
    established: false,
    small: null,
    label: '',
    reason: `SAM did not state Y/N size status for NAICS ${requirementNaics}`,
  };
}
