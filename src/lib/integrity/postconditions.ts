/**
 * INTEGRITY OS — postcondition controls for INT-008 and INT-010.
 *
 * Eric's sequencing (2026-08-23): "INT-008 / INT-010 — these should remain explicit
 * verification contracts rather than forced into static analysis. A broken diagnostic and a
 * partial-population ordering bug need evidence AFTER execution."
 *
 * So neither of these is a scanner. Both are assertions a probe or a ranking makes about
 * ITSELF, checkable only once it has run.
 */

/* ────────────────────────────── INT-008 ──────────────────────────────
 * THE DIAGNOSTIC PROBE IS ITSELF INVALID.
 *
 * THE INCIDENTS (both mine, both during this audit):
 *   · a probe sampling `alert_log` to measure the 1,000-row cap HIT THE SAME CAP — it reported
 *     "750 rows/cycle, flat for 10 weeks" from a truncated sample of the very thing it was
 *     measuring.
 *   · `curl -w "%{http_code}"` printed a blank line in one shell; I read that as HTTP 000 and
 *     concluded "Supabase is blocked by the sandbox". It was neither blocked nor failing — the
 *     probe was malformed, and I built a whole diagnosis on its output.
 *
 * THE RULE: a probe's output is evidence ONLY if the probe could have produced a different
 * answer. A measurement that cannot fail proves nothing — which is why every gate in this
 * codebase is proven by inject → red → revert → green.
 */

export interface ProbeValidity {
  probe: string;
  valid: boolean;
  reason: string;
}

/**
 * Assert a probe's own validity BEFORE trusting its result.
 *
 * @param probe          what is being measured, for the failure message
 * @param observed       what the probe returned
 * @param opts.capAt     a value that means "you hit a limit, not the truth" (e.g. 1000).
 *                       An observation landing exactly on a known cap is a truncated sample.
 * @param opts.control   a control observation that MUST differ from `observed` for the probe
 *                       to be discriminating. If a probe returns the same answer for a
 *                       known-good and known-bad input, it is not measuring anything.
 * @param opts.emptyIsInvalid  treat an empty/blank observation as probe failure rather than
 *                       as a measured zero (the `curl -w` case).
 */
export function assertProbeValid(
  probe: string,
  observed: number | string | null | undefined,
  opts: { capAt?: number; control?: number | string | null; emptyIsInvalid?: boolean } = {},
): ProbeValidity {
  const bad = (reason: string) => ({ probe, valid: false, reason });

  if (observed === null || observed === undefined) {
    return bad('probe returned nothing — that is a failed measurement, not a result');
  }
  if (opts.emptyIsInvalid && typeof observed === 'string' && observed.trim() === '') {
    // The `curl -w` case: a blank line is not "HTTP 000", it is a broken probe.
    return bad('probe returned an empty string — malformed probe, not a measured value');
  }
  if (opts.capAt !== undefined && typeof observed === 'number' && observed === opts.capAt) {
    // Landing exactly on a known cap means the sample was truncated by the very limit
    // being measured (the alert_log case).
    return bad(`observation equals the known cap (${opts.capAt}) — the sample is truncated, not measured`);
  }
  if (opts.control !== undefined && opts.control === observed) {
    return bad('probe returned the same answer for the control — it cannot discriminate');
  }
  return { probe, valid: true, reason: 'probe could have produced a different answer' };
}

/* ────────────────────────────── INT-010 ──────────────────────────────
 * PARTIAL POPULATION CORRUPTS ORDERING, NOT JUST COUNTS.
 *
 * THE INCIDENT: `target-market-research` ranked agencies by open-opportunity count from 1,000
 * of 15,065 notices (6.6%). No population figure was displayed anywhere, so nothing LOOKED
 * wrong — but which agency appeared #1 was decided by whichever rows landed in the first page.
 * Every count-based check is blind to this: the number was never shown.
 *
 * THE RULE: a ranking may only be presented when it was computed over the COMPLETE population.
 * A "top N" over a sample is an artifact of the sample.
 */

export interface RankingIntegrity {
  label: string;
  /** Rows the ranking was actually computed over. */
  observed: number;
  /** The true size of the population it claims to rank. */
  population: number;
  complete: boolean;
  /** Safe to render as "top N"? */
  presentable: boolean;
  detail: string;
}

/**
 * Assert a ranking was computed over the whole population.
 *
 * Call this with the row count you ranked and an EXACT head-count of the population. If they
 * disagree, the order is an artifact — refuse to present it rather than showing a plausible
 * "top 5" that a human will act on.
 */
export function assertRankingComplete(
  label: string,
  observed: number,
  population: number | null,
): RankingIntegrity {
  if (population === null) {
    return {
      label, observed, population: -1, complete: false, presentable: false,
      detail: `${label}: population unknown — a ranking cannot be defended without it`,
    };
  }
  const complete = observed >= population;
  return {
    label, observed, population, complete, presentable: complete,
    detail: complete
      ? `${label}: ranked over the complete population (${observed}/${population})`
      : `${label}: ranked over ${observed} of ${population} rows `
        + `(${Math.round((observed / Math.max(population, 1)) * 100)}%) — the ORDER is an artifact `
        + 'of which rows were read, not a property of the data',
  };
}
