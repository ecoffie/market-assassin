/**
 * Write-path amplification guard — the runtime half of the "wrong-but-VALID data"
 * defense (PRD phase 2, tasks/PRD-data-invariants-watch.md).
 *
 * THE BUG CLASS: a user performs ONE action and the system persists dozens of
 * values derived from it. Nothing throws, every unit test passes, the row is
 * valid — and the user's config now says something they never chose.
 *
 * The scar: one click on the "Professional Services" industry preset (a single
 * input, `['541']`) persisted all 51 codes of the 541 family. 51x amplification.
 * It ran ~4 months and corrupted 1,144 profiles before anyone looked.
 *
 * The insight this encodes: you do not need to know WHICH taxonomy broke to catch
 * it. The ratio itself is the smell. 1 input -> 51 stored values is pathological
 * regardless of whether it is NAICS, PSC, keywords, or agencies.
 *
 * DELIBERATELY NON-FATAL. This never throws and never truncates — a guard that
 * breaks a user's save is worse than the bloat it prevents. It logs loudly, and
 * the nightly data-invariants-watch catches whatever slips through. Callers that
 * genuinely need a cap should use the cap inside their normalize helper
 * (e.g. MAX_PERSISTED_NAICS), not this.
 */

/** Above this output/input ratio, a persist is treated as suspicious. */
export const MAX_AMPLIFICATION = 5;

/** Below this many outputs, the ratio is meaningless (1 -> 3 is not a blow-out). */
const MIN_OUTPUT_TO_CARE = 12;

export interface AmplificationReport {
  field: string;
  inputCount: number;
  outputCount: number;
  ratio: number;
  suspicious: boolean;
}

/**
 * Check an input -> output persist expansion and log when it looks pathological.
 *
 * @param field   what is being written, e.g. 'naics_codes' — appears in the log
 * @param input   what the USER actually supplied/clicked
 * @param output  what we are about to STORE
 * @param context optional extra detail for the log line (route, flags, etc.)
 */
export function checkAmplification(
  field: string,
  input: readonly unknown[],
  output: readonly unknown[],
  context?: Record<string, unknown>,
): AmplificationReport {
  const inputCount = input?.length ?? 0;
  const outputCount = output?.length ?? 0;
  const ratio = inputCount > 0 ? outputCount / inputCount : outputCount;

  const suspicious = outputCount >= MIN_OUTPUT_TO_CARE && ratio > MAX_AMPLIFICATION;

  if (suspicious) {
    // Loud, greppable, ratio-first.
    console.warn(
      `[amplification] ${field}: ${inputCount} input -> ${outputCount} stored ` +
        `(${ratio.toFixed(1)}x, threshold ${MAX_AMPLIFICATION}x). ` +
        `A single user choice should not fan out this far — check the persist path ` +
        `uses a curated/normalized set, not a query-time expander.`,
      context ?? {},
    );
  }

  return { field, inputCount, outputCount, ratio, suspicious };
}
