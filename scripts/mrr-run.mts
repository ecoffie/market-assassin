/**
 * MRR Phase 1 complete — shared CLI runner.
 *
 *   npx tsx scripts/mrr-run.mts [--requirement <file.json>] [--out <dir>]
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File, TEMPLATE_PATH } from '../src/lib/mrr/docx-fill';
import { DEFAULT_REQUIREMENT, runPhase1 } from '../src/lib/mrr/run-phase1';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function scrubEnvKeys(): void {
  for (const key of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]) {
    const value = process.env[key];
    if (typeof value === 'string' && (value.includes('\\n') || /[\r\n]/.test(value))) {
      process.env[key] = value.replace(/\\n/g, '').replace(/[\r\n]/g, '').trim();
    }
  }
}

async function main() {
  scrubEnvKeys();
  const outDir = arg('out') ?? 'out/mrr';
  const requirementFile = arg('requirement');
  const input = requirementFile
    ? JSON.parse(readFileSync(requirementFile, 'utf8'))
    : DEFAULT_REQUIREMENT;
  const runId = randomBytes(8).toString('base64url');
  const intakeHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');

  console.log('── MRR Phase 1 complete (sourced hero sections) ──');
  console.log(`template      ${TEMPLATE_PATH}`);
  console.log(`template sha  ${sha256File(TEMPLATE_PATH)}`);

  const result = await runPhase1(input, {
    runId,
    intakeHash,
    outDir,
    onProgress(stage) {
      console.log(`progress      ${stage}`);
    },
  });
  const by = (state: string) => result.cells.filter((cell) => cell.state === state).length;

  console.log(`\nrequirement   ${result.requirement.normalized.title}`);
  console.log(
    `solicitation  ${result.requirement.normalized.solicitation_number ?? '(none)'}`,
  );
  result.requirement.notes.forEach((note) => console.log(`  note: ${note}`));
  console.log('\n── rendered field states ──');
  console.log(`  sourced value ${by('value')}`);
  console.log(`  measured zero ${by('true_zero')}`);
  console.log(`  unknown       ${by('unknown')}`);
  console.log(`  degraded      ${by('degraded')}`);
  console.log('\n── §11 / §12 / §15 summary ──');
  console.log(`  matching UEIs       ${JSON.stringify(result.section11.rawUeiCount)}`);
  console.log(
    `  resolved families  ${JSON.stringify(result.section11.deduplicatedFamilyCount)}`,
  );
  console.log(`  RoT determination   ${JSON.stringify(result.section12.determination)}`);
  console.log(
    `  capable families    ${JSON.stringify(result.section12.capableFamilyCount)}`,
  );
  console.log(`  pricingIsIge        ${result.section15.pricingIsIge}`);
  console.log('\n── unknown / degraded fields ──');
  for (const cell of result.cells.filter(
    (item) => item.state === 'unknown' || item.state === 'degraded',
  )) {
    console.log(`  [${cell.state}] ${cell.label}: ${(cell.reason ?? '').slice(0, 120)}`);
  }
  console.log('\n── artifacts ──');
  console.log(`  MRR       ${result.artifacts.mrr.path}`);
  console.log(`  appendix  ${result.artifacts.appendix.path}`);
  console.log(`  evidence  ${result.artifacts.evidence.path}`);
  console.log(`\ntemplate unchanged: ${sha256File(TEMPLATE_PATH)}`);
}

const isDirectRun =
  !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error('RUN FAILED:', error);
    process.exit(1);
  });
}
