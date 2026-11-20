/**
 * Bounded retries for a public forecast fetch. A 429/5xx or a thrown network
 * error waits and tries again. A 403/404 is returned immediately — retrying
 * an access denial does not make the file exist.
 */

export const FORECAST_RETRY_STATUSES = [429, 500, 502, 503, 504];

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: {
    attempts?: number;
    retryBaseMs?: number;
    fetchImpl?: typeof fetch;
    retryStatuses?: number[];
  } = {},
): Promise<{ response: Response; attempts: number }> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.retryBaseMs ?? 400;
  const retryStatuses = new Set(opts.retryStatuses ?? FORECAST_RETRY_STATUSES);
  const doFetch = opts.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await doFetch(url, init);
      if (response.ok || !retryStatuses.has(response.status) || i === attempts) {
        return { response, attempts: i };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
      if (i === attempts) throw err;
    }
    if (base > 0) {
      await new Promise((resolve) => setTimeout(resolve, base * 2 ** (i - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('forecast fetch failed');
}
