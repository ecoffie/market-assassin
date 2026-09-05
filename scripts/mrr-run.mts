/**
 * MRR Phase 1 vertical slice — end-to-end runner.
 *
 *   npx tsx scripts/mrr-run.mts [--requirement <file.json>] [--out <dir>]
 *
 * Default requirement: the real public SAM notice DHA_JOMIS_JMP_20260813.
 *
 * Produces, in the output directory:
 *   MRR-<solicitation>.docx            the filled Market Research Report
 *   MRR-<solicitation>-appendix.docx   the Sourced Evidence Appendix
 *   MRR-<solicitation>-evidence.json   the sanitized evidence bundle
 *
 * Read-only with respect to production: it calls Mindy tools in-process, writes
 * nothing to any database, and never modifies the source template.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRequirement } from '../src/lib/mrr/normalizer';
import { buildSection5 } from '../src/lib/mrr/section-5-taxonomy';
import { buildSection9 } from '../src/lib/mrr/section-9-history';
import { assembleMrr } from '../src/lib/mrr/assemble';
import { writeAppendix } from '../src/lib/mrr/appendix';
import { sha256File, TEMPLATE_PATH, PROTOTYPE_BANNER } from '../src/lib/mrr/docx-fill';
import { isPrimaryVerified, tableCitation } from '../src/lib/mrr/sba-size-standards';

/** The verified public notice (WEEKEND corrections item 8). */
const DEFAULT_REQUIREMENT = {
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  sub_agency: 'Department of Defense',
  naics: '541512',
  psc: 'DA01',
  keyword: 'modeling and simulation',
  description:
    'The Defense Health Agency (DHA), Joint Operational Medicine Information Systems (JOMIS) Program ' +
    'Management Office is conducting market research on joint medical planning, modeling and simulation ' +
    'capabilities. Sources sought notice; responses due 2026-09-13.',
  solicitation_number: 'DHA_JOMIS_JMP_20260813',
  notice_id: '213a2fe3a447465e8f30699c9f056ec4',
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const outDir = arg('out') ?? 'out/mrr';
  const reqFile = arg('requirement');
  const input = reqFile ? JSON.parse(readFileSync(reqFile, 'utf8')) : DEFAULT_REQUIREMENT;
  const generatedAt = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });

  console.log('── MRR Phase 1 vertical slice ──');
  console.log(`template      ${TEMPLATE_PATH}`);
  console.log(`template sha  ${sha256File(TEMPLATE_PATH)}`);

  // 1. normalize
  const { normalized, notes } = normalizeRequirement(input);
  console.log(`\nrequirement   ${normalized.title}`);
  console.log(`solicitation  ${normalized.solicitation_number ?? '(none)'}`);
  notes.forEach((n) => console.log(`  note: ${n}`));

  // 2. §5 and §9
  const s5 = await buildSection5(normalized);
  const primaryNaics = s5.primaryNaics.state === 'value' ? s5.primaryNaics.value : undefined;
  const s9 = await buildSection9(normalized, primaryNaics);

  // 3. assemble (only rendered cells reach the document)
  const base = (normalized.solicitation_number ?? 'requirement').replace(/[^A-Za-z0-9_-]/g, '_');
  const mrrPath = join(outDir, `MRR-${base}.docx`);
  const { cells } = assembleMrr(normalized, s5, s9, mrrPath, generatedAt);

  // 4. appendix, from the SAME cells
  const appendixPath = join(outDir, `MRR-${base}-appendix.docx`);
  const limitations = [
    'Only §5 (Taxonomy) and §9 (Procurement History) are implemented. All other sections are Phase 2 placeholders.',
    'Predecessor / incumbent results are inferential and agency-validated; they are never a certified contract lineage.',
    `SBA size standards come from a limited versioned local fixture (${tableCitation()}), not the full published table${isPrimaryVerified() ? ', though every included value was read from the authoritative source' : ', and the value was corroborated only from SECONDARY sources because the primary host blocks automated retrieval — REQUIRES HUMAN CONFIRMATION before signature'}.`,
    '§11 Potential Suppliers and §12 Small Business / Rule of Two are intentionally deferred: they require parent-company deduplication, which the 2026-09-04 data-readiness audit found unresolved.',
    'No Independent Government Estimate, supplier count, or Rule-of-Two recommendation is generated.',
    'Award amounts are reproduced with the source’s own label; obligated, current and ceiling values are not interchanged, and lifetime totals are never summed.',
    `This artifact is a draft for review. ${PROTOTYPE_BANNER}.`,
  ];
  await writeAppendix({
    requirementTitle: normalized.title,
    solicitationNumber: normalized.solicitation_number,
    noticeId: normalized.notice_id,
    generatedAt,
    cells,
    calls: [...s5.calls, ...s9.calls],
    ...(s9.predecessorCandidate
      ? { rejectedCandidate: { source: s9.predecessorSource, checks: s9.predecessorChecks, candidate: s9.predecessorCandidate } }
      : {}),
    limitations,
  }, appendixPath);

  // 5. sanitized evidence bundle (no secrets, no local paths, no raw payload dumps)
  const bundlePath = join(outDir, `MRR-${base}-evidence.json`);
  writeFileSync(bundlePath, JSON.stringify({
    generatedAt,
    requirement: normalized,
    normalizationNotes: notes,
    templateSha256: sha256File(TEMPLATE_PATH),
    cells: cells.map((c) => ({ label: c.label, state: c.state, text: c.text, evidence: c.evidence, reason: c.reason })),
    calls: [...s5.calls, ...s9.calls].map((c) => ({ tool: c.tool, args: c.args, ok: c.ok, error: c.error, retrievedAt: c.evidence.retrievedAt })),
    predecessor: { status: s9.predecessorStatus, source: s9.predecessorSource, checks: s9.predecessorChecks, candidate: s9.predecessorCandidate },
    limitations,
  }, null, 2));

  // 6. report
  const by = (s: string) => cells.filter((c) => c.state === s).length;
  console.log('\n── rendered field states ──');
  console.log(`  sourced value ${by('value')}`);
  console.log(`  measured zero ${by('true_zero')}`);
  console.log(`  unknown       ${by('unknown')}`);
  console.log(`  degraded      ${by('degraded')}`);
  console.log('\n── unknown / degraded fields ──');
  for (const c of cells.filter((x) => x.state === 'unknown' || x.state === 'degraded')) {
    console.log(`  [${c.state}] ${c.label}: ${(c.reason ?? '').slice(0, 120)}`);
  }
  console.log('\n── artifacts ──');
  console.log(`  MRR       ${mrrPath}`);
  console.log(`  appendix  ${appendixPath}`);
  console.log(`  evidence  ${bundlePath}`);
  console.log(`\ntemplate unchanged: ${sha256File(TEMPLATE_PATH)}`);
}

main().catch((e) => { console.error('RUN FAILED:', e); process.exit(1); });
