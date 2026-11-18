/**
 * Grants.gov sync outcome.
 *
 * A zero fetch is already a hard error (the corpus is never legitimately empty).
 * A mid-run upstream error used to return HTTP 200 and success:true after writing
 * a partial page (`degraded`). The dispatcher records any 2xx as success, so an
 * incomplete ingest looked healthy. Rows already written stay written; the run
 * itself must not.
 */
export type GrantsSyncOutcome = {
  success: boolean;
  httpStatus: number;
  cronOutcome: 'success' | 'error';
  disclosure: string | null;
};

export function classifyGrantsSync(input: { fetched: number; degraded: boolean }): GrantsSyncOutcome {
  if (input.fetched === 0) {
    return {
      success: false,
      httpStatus: 500,
      cronOutcome: 'error',
      disclosure: 'STARVED: fetched 0 grants. Grants.gov empty or blocked is not a verified empty market.',
    };
  }
  if (input.degraded) {
    return {
      success: false,
      httpStatus: 503,
      cronOutcome: 'error',
      disclosure: `Partial grants ingest (${input.fetched} fetched before the upstream failed). Rows already written stay written. This run is not a complete collection.`,
    };
  }
  return { success: true, httpStatus: 200, cronOutcome: 'success', disclosure: null };
}
