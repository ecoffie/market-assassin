/**
 * Build the MINIMAL recertification regression fixture from a target register.
 *
 *   npx tsx scripts/diligence/build-recert-fixture.ts --register .claude/diligence/halvik/register.json \
 *     --download .claude/diligence/halvik/download-v2.json --out src/lib/diligence/recert/__fixtures__/halvik-register-2026-01-21.json
 *
 * Keeps only (a) the target UEI's awards not ended at as-of and (b) every vehicle the target
 * holds (vehicles are needed for parent set-aside lookups even when their ordering period closed),
 * and only the fields the engine reads. Public federal data only — nothing private, nothing
 * descriptive beyond identifiers.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function arg(n: string) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const regPath = arg('register');
const dlPath = arg('download');
const out = arg('out');
if (!regPath || !dlPath || !out) throw new Error('--register, --download and --out are required');

export const FIXTURE_FIELDS = [
  'award_key', 'piid', 'kind', 'recipient_uei', 'instrument', 'parent_piid', 'parent_award_type', 'parent_single_or_multiple',
  'awarding_agency', 'naics', 'set_aside_base', 'set_aside_latest', 'co_business_size_latest',
  'obligated', 'base_and_exercised_options', 'base_and_all_options',
  'pop_start', 'pop_current_end', 'pop_potential_end', 'ordering_period_end', 'status_as_of', 'source_url',
] as const;
const VALUE_FIELDS = new Set(['obligated', 'base_and_exercised_options', 'base_and_all_options']);

const register = JSON.parse(readFileSync(regPath, 'utf8')).register;
const dl = JSON.parse(readFileSync(dlPath, 'utf8'));
const target = register.target_uei as string;
const rows = (register.rows as Array<Record<string, any>>)
  .filter((r) => r.recipient_uei === target && (r.kind === 'idv' || r.status_as_of !== 'ended'))
  .map((r) => Object.fromEntries(FIXTURE_FIELDS.map((f) => [f, VALUE_FIELDS.has(f) ? { value: r[f].value } : r[f]])));

let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }

const fixture = {
  _meta: {
    purpose: 'Regression fixture for the recertification review engine (Halvik, as of 2026-01-21).',
    public_federal_data_only: true,
    target_uei: target,
    as_of: register.as_of,
    inclusion_mode: register.mode,
    source: {
      system: 'USASpending.gov prime transaction download (FPDS-derived)',
      file_name: dl.file_name,
      requested_at: dl.requested_at,
      window: `2007-10-01..${dl.end_date}`,
    },
    built_by: ['scripts/diligence/build-target-register.ts (PR #1859, merged 2c2bd266)', 'scripts/diligence/build-recert-fixture.ts'],
    generated_at: new Date().toISOString(),
    generated_from_commit: commit,
    row_selection: 'target UEI only; awards whose status at as-of is not "ended", plus every vehicle (IDV) the target holds',
    fields: FIXTURE_FIELDS,
    counts: { awards: rows.filter((r) => r.kind === 'award').length, vehicles: rows.filter((r) => r.kind === 'idv').length },
  },
  as_of: register.as_of,
  rows,
};
writeFileSync(out, JSON.stringify(fixture) + '\n');
console.error('[fixture]', fixture._meta.counts, `${(JSON.stringify(fixture).length / 1024).toFixed(1)} KB`);
