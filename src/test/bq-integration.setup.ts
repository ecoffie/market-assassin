/**
 * Vitest setup for the LIVE BigQuery integration process ONLY (vitest.bq-integration.config.ts,
 * `npm run test:bq-integration`). It never loads in the unit suite.
 *
 * - Refuses to start unless RUN_LIVE_BQ_TESTS=1 and BQ_TEST_PROJECT/BQ_TEST_DATASET name an
 *   approved disposable dataset (resolveDisposableBqTestTarget throws otherwise).
 * - `bq` CLI calls are admitted ONLY when authorizeBqCommand() proves they are confined to that
 *   dataset. Anything else throws, as does any exec/execSync string form (unparseable).
 * - Raw fetches to bigquery.googleapis.com always throw, and app code stays blocked by the guard
 *   (it refuses under Vitest in every process), so only the explicit, authorized CLI path exists.
 */
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { authorizeBqCommand, resolveDisposableBqTestTarget } from '@/lib/bigquery/guard';

if (process.env.RUN_LIVE_BQ_TESTS !== '1') {
  throw new Error('The BigQuery integration process requires RUN_LIVE_BQ_TESTS=1 (npm run test:bq-integration).');
}
const target = resolveDisposableBqTestTarget(); // throws unless approved + disposable
if (!target) throw new Error('No approved disposable BigQuery target resolved.');

class BigQueryIntegrationRefusal extends Error {
  constructor(what: string) {
    super(`Refused in the BigQuery integration process (${what}). Only commands confined to ${target!.project}:${target!.dataset} are allowed.`);
    this.name = 'BigQueryIntegrationRefusal';
  }
}

const isBq = (cmd: unknown) => typeof cmd === 'string' && /(^|\/)bq$/.test(cmd.trim());
const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[name];
  cp[name] = function (this: unknown, cmd: unknown, ...rest: unknown[]) {
    if (isBq(cmd)) {
      const args = Array.isArray(rest[0]) ? (rest[0] as unknown[]).map(String) : [];
      const verdict = authorizeBqCommand(args, target);
      if (!verdict.ok) throw new BigQueryIntegrationRefusal(`bq ${args.slice(1, 2).join(' ')}: ${verdict.reason}`);
    }
    return original.call(this, cmd, ...rest);
  };
}
for (const name of ['exec', 'execSync']) {
  const original = cp[name];
  cp[name] = function (this: unknown, command: unknown, ...rest: unknown[]) {
    if (typeof command === 'string' && /(^|[\s;&|/])bq\s/.test(command)) throw new BigQueryIntegrationRefusal('shell-string bq invocation (use execFileSync with an args array)');
    return original.call(this, command, ...rest);
  };
}
syncBuiltinESMExports();

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^https?:\/\/(www\.)?bigquery\.googleapis\.com\//i.test(url)) throw new BigQueryIntegrationRefusal('REST call to bigquery.googleapis.com');
  return originalFetch(input, init);
}) as typeof fetch;
