// Gate on the importer's reconciliation output (scripts/import-sam-entity-extract.mjs).
// Exit 1 (abort) unless BOTH accounting lines BALANCE, nothing was dead-lettered, and (dry run) the report is a dry run.
// Usage: node scripts/sam-extract-dry-run-gate.mjs <log> [--real]
import { readFileSync } from 'node:fs';

export function gateReconciliation(log, { real = false } = {}) {
  const problems = [];
  if (!/=== IMPORT RECONCILIATION ===/.test(log)) problems.push('no reconciliation block (the run did not finish)');
  if (/MISMATCH/.test(log)) problems.push('reconciliation MISMATCH');
  const balances = (log.match(/\bBALANCES\b/g) || []).length;
  if (balances < 2) problems.push(`expected 2 BALANCES lines, found ${balances}`);
  const failed = log.match(/failed \(dead-letter\)\s+([\d,]+)/);
  if (!failed) problems.push('no dead-letter count');
  else if (Number(failed[1].replace(/,/g, '')) > 0) problems.push(`${failed[1]} rows failed / dead-lettered`);
  if (!real && !/DRY RUN — nothing written/.test(log)) problems.push('not a dry-run report');
  const kept = log.match(/kept \(matched filter\)\s+([\d,]+)/);
  if (kept && Number(kept[1].replace(/,/g, '')) < 100_000) problems.push(`only ${kept[1]} rows kept — expected the full registry (~900K); was --all-naics passed?`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , file, flag] = process.argv;
  const problems = gateReconciliation(readFileSync(file, 'utf8'), { real: flag === '--real' });
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log('Reconciliation gate: PASS');
}
