/**
 * Vitest setup: the unit suite can never reach BigQuery.
 *
 * Belt and braces on top of src/lib/bigquery/guard.ts (which blocks the shared client,
 * platform-health and the relationships REST call). This tripwire catches the paths the
 * guard cannot see: a test (or code under test) shelling out to the `bq` CLI, or a raw
 * fetch to bigquery.googleapis.com. Both throw immediately unless RUN_LIVE_BQ_TESTS=1,
 * and live integration tests additionally need an approved disposable dataset
 * (resolveDisposableBqTestTarget).
 *
 * Background: on 2026-09-29 a unit test switched on merely because
 * GOOGLE_APPLICATION_CREDENTIALS was set, ran the real `bq` CLI and wrote two load jobs
 * into a production dataset.
 */
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const LIVE = process.env.RUN_LIVE_BQ_TESTS === '1';

export class BigQueryTripwireError extends Error {
  constructor(what: string) {
    super(`Unit tests may not call BigQuery (${what}). Set RUN_LIVE_BQ_TESTS=1 with an approved disposable dataset for integration tests.`);
    this.name = 'BigQueryTripwireError';
  }
}

if (!LIVE) {
  const isBq = (cmd: unknown) => typeof cmd === 'string' && /(^|\/)bq$/.test(cmd.trim());
  const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const original = cp[name];
    cp[name] = function (this: unknown, cmd: unknown, ...rest: unknown[]) {
      if (isBq(cmd)) throw new BigQueryTripwireError(`child_process.${name}('bq')`);
      return original.call(this, cmd, ...rest);
    };
  }
  for (const name of ['exec', 'execSync']) {
    const original = cp[name];
    cp[name] = function (this: unknown, command: unknown, ...rest: unknown[]) {
      if (typeof command === 'string' && /(^|[\s;&|/])bq\s/.test(command)) throw new BigQueryTripwireError(`child_process.${name}('bq …')`);
      return original.call(this, command, ...rest);
    };
  }
  syncBuiltinESMExports();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:\/\/(www\.)?bigquery\.googleapis\.com\//i.test(url)) throw new BigQueryTripwireError(`fetch ${new URL(url).host}`);
    return originalFetch(input, init);
  }) as typeof fetch;
}
