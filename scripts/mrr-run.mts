/**
 * MRR Phase 1 complete — end-to-end runner.
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
import { buildSection11 } from '../src/lib/mrr/section-11-suppliers';
import { buildSection12 } from '../src/lib/mrr/section-12-rule-of-two';
import { buildSection15 } from '../src/lib/mrr/section-15-intel';
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

/** Some local .env.local values are quoted with a literal `\n` suffix that breaks Supabase auth. */
function scrubEnvKeys(): void {
  for (const k of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]) {
    const v = process.env[k];
    if (typeof v === 'string' && (v.includes('\\n') || /[\r\n]/.test(v))) {
      process.env[k] = v.replace(/\\n/g, '').replace(/[\r\n]/g, '').trim();
    }
  }
}

async function main() {
  scrubEnvKeys();
  const outDir = arg('out') ?? 'out/mrr';
  const reqFile = arg('requirement');
  const input = reqFile ? JSON.parse(readFileSync(reqFile, 'utf8')) : DEFAULT_REQUIREMENT;
  const generatedAt = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });

  console.log('── MRR Phase 1 complete (sourced hero sections) ──');
  console.log(`template      ${TEMPLATE_PATH}`);
  console.log(`template sha  ${sha256File(TEMPLATE_PATH)}`);

  const { normalized, notes } = normalizeRequirement(input);
  console.log(`\nrequirement   ${normalized.title}`);
  console.log(`solicitation  ${normalized.solicitation_number ?? '(none)'}`);
  notes.forEach((n) => console.log(`  note: ${n}`));

  const s5 = await buildSection5(normalized);
  const primaryNaics = s5.primaryNaics.state === 'value' ? s5.primaryNaics.value : undefined;
  const s9 = await buildSection9(normalized, primaryNaics);
  const s11 = await buildSection11(normalized, primaryNaics);
  const s12 = await buildSection12(normalized, primaryNaics, s11);
  const s15 = await buildSection15(normalized, primaryNaics, s5, s12);

  const base = (normalized.solicitation_number ?? 'requirement').replace(/[^A-Za-z0-9_-]/g, '_');
  const mrrPath = join(outDir, `MRR-${base}.docx`);
  const { cells } = assembleMrr(normalized, s5, s9, s11, s12, s15, mrrPath, generatedAt);

  const appendixPath = join(outDir, `MRR-${base}-appendix.docx`);
  const limitations = [
    'Phase 1 populates §5 (Taxonomy), §9 (Procurement History), §11 (Potential Suppliers), §12 (Small Business / Rule of Two), and §15 (Market Intelligence). Remaining sections are Phase 2 placeholders.',
    'Predecessor / incumbent results are inferential and agency-validated; they are never a certified contract lineage.',
    `SBA size standards come from a limited versioned local fixture (${tableCitation()}), not the full published table${isPrimaryVerified() ? ', though every included value was read from the authoritative source' : ', and the value was corroborated only from SECONDARY sources because the primary host blocks automated retrieval — REQUIRES HUMAN CONFIRMATION before signature'}.`,
    'Corporate-family deduplication uses current-state USASpending parent_uei edges only. It is NOT point-in-time safe for investment backtests. Name/amount/keyword heuristics never create a parent match. Ambiguous parentage stays unresolved and cannot satisfy Rule of Two.',
    'Supplier counts distinguish raw UEI rows from parent-deduplicated families. Truncated samples are never treated as populations.',
    'Pricing in §15 is supporting market evidence only — never an Independent Government Estimate. The KO owns the IGE in Phase 2.',
    'Award amounts are reproduced with the source’s own label; obligated, current and ceiling values are not interchanged, and lifetime totals are never summed.',
    ...s11.limitations.map((l) => `§11: ${l}`),
    ...s12.limitations.map((l) => `§12: ${l}`),
    ...s15.limitations.map((l) => `§15: ${l}`),
    `This artifact is a draft for review. ${PROTOTYPE_BANNER}.`,
  ];
  const allCalls = [...s5.calls, ...s9.calls, ...s11.calls, ...s12.calls, ...s15.calls];
  await writeAppendix({
    requirementTitle: normalized.title,
    solicitationNumber: normalized.solicitation_number,
    noticeId: normalized.notice_id,
    generatedAt,
    cells,
    calls: allCalls,
    ...(s9.predecessorCandidate
      ? { rejectedCandidate: { source: s9.predecessorSource, checks: s9.predecessorChecks, candidate: s9.predecessorCandidate } }
      : {}),
    limitations,
  }, appendixPath);

  const bundlePath = join(outDir, `MRR-${base}-evidence.json`);
  writeFileSync(bundlePath, JSON.stringify({
    generatedAt,
    requirement: normalized,
    normalizationNotes: notes,
    templateSha256: sha256File(TEMPLATE_PATH),
    cells: cells.map((c) => ({ label: c.label, state: c.state, text: c.text, evidence: c.evidence, reason: c.reason })),
    calls: allCalls.map((c) => ({ tool: c.tool, args: c.args, ok: c.ok, error: c.error, retrievedAt: c.evidence.retrievedAt })),
    predecessor: { status: s9.predecessorStatus, source: s9.predecessorSource, checks: s9.predecessorChecks, candidate: s9.predecessorCandidate },
    suppliers: {
      rawUeiCount: s11.rawUeiCount,
      evaluatedUeiCount: s11.evaluatedUeiCount,
      toolLimit: s11.toolLimit,
      deduplicatedFamilyCount: s11.deduplicatedFamilyCount,
      ambiguousParentCount: s11.ambiguousParentCount,
      eligiblePopulation: s11.eligiblePopulation,
      sampleCoverage: s11.sampleCoverage,
      rowCount: s11.suppliers.length,
      families: s11.suppliers.slice(0, 50).map((s) => ({
        uei: s.uei.state === 'value' ? s.uei.value : s.family.rawUei,
        familyKey: s.family.canonical?.familyKey ?? null,
        method: s.family.method,
        confidence: s.family.confidence,
        ruleOfTwoEligible: s.family.ruleOfTwoEligible,
        memberUeis: s.family.memberUeis,
      })),
    },
    ruleOfTwo: {
      determination: s12.determination,
      recommendation: s12.recommendation,
      capableFamilyCount: s12.capableFamilyCount,
      countedFamilies: s12.countedFamilies,
      excluded: s12.excluded,
      socioCounts: s12.socioCounts,
    },
    marketIntel: {
      totalMarket: s15.totalMarket,
      pricingIsIge: s15.pricingIsIge,
      pricingEvidence: s15.pricingEvidence,
      sbFootprint: s15.sbFootprint,
    },
    limitations,
  }, null, 2));

  const by = (s: string) => cells.filter((c) => c.state === s).length;
  console.log('\n── rendered field states ──');
  console.log(`  sourced value ${by('value')}`);
  console.log(`  measured zero ${by('true_zero')}`);
  console.log(`  unknown       ${by('unknown')}`);
  console.log(`  degraded      ${by('degraded')}`);
  console.log('\n── §11 / §12 / §15 summary ──');
  console.log(`  raw UEIs            ${JSON.stringify(s11.rawUeiCount)}`);
  console.log(`  dedup families      ${JSON.stringify(s11.deduplicatedFamilyCount)}`);
  console.log(`  RoT determination   ${JSON.stringify(s12.determination)}`);
  console.log(`  capable families    ${JSON.stringify(s12.capableFamilyCount)}`);
  console.log(`  pricingIsIge        ${s15.pricingIsIge}`);
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
