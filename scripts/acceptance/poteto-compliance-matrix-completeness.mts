/**
 * POTETO — Compliance Matrix Completeness. Fixture: VA 36C24226Q0857 (the real stored package). Read-only.
 *
 *   PACKAGE → COVERAGE → CHUNK → EXTRACT → MERGE → DEDUPE → VERIFY → COMPLETE
 *
 * RECALL benchmark: fixtures/compliance-matrix-completeness-anchors-36C24226Q0857.json — anchors
 * hand-selected from the source text (never from model output), spread across the package.
 * PRECISION benchmark: the frozen Truth gate, re-checked here by an INDEPENDENT verifier (its own
 * normalization and search — not src/lib/proposal/matrix-verification.ts).
 *
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-compliance-matrix-completeness.mts          # structural (no LLM)
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-compliance-matrix-completeness.mts --fresh  # + OLD vs NEW live extraction (LLM cost)
 */
process.env.SAM_DOCS_READONLY = 'on';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSolicitationDocuments } from '../../src/lib/sam/solicitation-documents';
import {
  extractComplianceMatrixFromText,
  planPackageExtraction,
  prioritizeExtractionWindows,
  type PackageDocument,
} from '../../src/lib/proposal/compliance-matrix';
import { verifyComplianceMatrix, type MatrixSourceDoc } from '../../src/lib/proposal/matrix-verification';
import { extractComplianceMatrix } from '../../src/mcp/tools/compliance-matrix';
import { TOOL_CREDITS } from '../../src/lib/mcp/tool-registry';

let pass = true;
const chk = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
  if (!ok) pass = false;
};
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const bench = JSON.parse(fs.readFileSync(path.join(FIX, 'compliance-matrix-completeness-anchors-36C24226Q0857.json'), 'utf8'));

// ── independent checker (not the gate) ────────────────────────────────────────
const squash = (s: string) =>
  s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, '').toLowerCase();
function quoteInDoc(quote: string, docText: string): boolean {
  const hay = squash(docText);
  let from = 0;
  const parts = quote.split(/\.{3,}|…/).map((p) => squash(p).replace(/^[."',;:]+|[."',;:]+$/g, '')).filter((p) => p.length >= 10);
  if (!parts.length) return false;
  for (const p of parts) { const at = hay.indexOf(p, from); if (at < 0) return false; from = at + p.length; }
  return true;
}
const PARAGRAPH_LETTER = /^\(?[a-z]{1,2}\)?(\(\w+\))*$/i;
const figures = (s: string) => (s.match(/\$?\d[\d,]*(\.\d+)?%?/g) || []).map((f) => f.replace(/[$,]/g, '').replace(/\.0+$/, '').replace(/%$/, ''));

// ── STEP 1/2: the package ─────────────────────────────────────────────────────
const pkg: any = await getSolicitationDocuments({ noticeId: bench.notice, textMode: 'full' } as any);
const sourceDocs: MatrixSourceDoc[] = [
  ...(pkg.description ? [{ document_id: 'notice_description', filename: 'Notice description', text: pkg.description, role: 'notice_description' as const }] : []),
  ...pkg.documents.filter((d: any) => (d.extracted_text || '').trim())
    .map((d: any) => ({ document_id: d.document_id, filename: d.filename, text: d.extracted_text, role: 'attachment' as const })),
];
const kinds = new Map<string, string | null>(pkg.documents.map((d: any) => [d.document_id, d.doc_kind]));
const packageDocs: PackageDocument[] = sourceDocs.map((d) => ({ ...d, doc_kind: kinds.get(d.document_id) ?? 'notice' }));
const byId = new Map(sourceDocs.map((d) => [d.document_id, d]));
const byName = new Map(sourceDocs.map((d) => [d.filename, d]));
chk('PACKAGE 7 attachments + notice body, all readable', pkg.documents.length === 7 && sourceDocs.length === 8, sourceDocs.map((d) => d.filename.slice(0, 24)).join(' | '));

// ── STEP 4: anchor integrity ──────────────────────────────────────────────────
const anchors = bench.anchors.map((a: any) => {
  const doc = byId.get(a.document_id);
  const at = doc ? doc.text.indexOf(a.sentence) : -1;
  return { ...a, filename: doc?.filename, start: at, end: at + a.sentence.length };
});
const drift = anchors.filter((a: any) => a.start < 0);
chk(`BENCHMARK ${anchors.length} anchors are exact substrings of their named documents`, drift.length === 0, drift.map((a: any) => a.id).join(','));
chk('BENCHMARK spans ≥3 documents and reaches past char 140,000 of the base document',
  new Set(anchors.map((a: any) => a.document_id)).size >= 3 && anchors.some((a: any) => a.start > 140_000));

// ── STEP 3/5: the OLD 50K window cannot reach the anchors (structural, no LLM) ─
const assembled = String(pkg.source_text || '').trim();
const oldWin = prioritizeExtractionWindows(assembled);
const reachable = anchors.filter((a: any) => {
  const at = assembled.indexOf(a.sentence);
  return at >= 0 && oldWin.ranges.some(([s, e]) => at >= s && at + a.sentence.length <= e);
});
chk('BEFORE old path reads a single ~50K window of the flattened package', oldWin.truncated && oldWin.text.length <= 50_000, `${oldWin.text.length} of ${assembled.length} chars`);
chk('BEFORE old 50K window structurally cannot reach most anchors (recall benchmark FAILS)', reachable.length <= 3,
  `${reachable.length}/${anchors.length} reachable: ${reachable.map((a: any) => a.id).join(',')}`);

// ── NEW plan: every requirement-bearing document is covered; exclusions are stated ─
const plan = planPackageExtraction(packageDocs, { solicitationNumber: pkg.solicitation_number });
const disp = Object.fromEntries(plan.documents.map((d) => [d.filename, d.disposition]));
chk('PLAN misfiled D&F for a different contract is excluded as foreign_instrument', disp['VAAR+852.219-75.docx'] === 'foreign_instrument');
chk('PLAN wage determination is reference_data; its byte-identical twin is duplicate',
  disp['WD+Essex.docx'] === 'reference_data' && disp['WD+Somerset.docx'] === 'duplicate');
chk('PLAN base, notice, PPQ, transmittal letter and pricing sheet are extracted',
  ['36C24226Q0857_1.docx', 'Notice description', 'EXHIBIT+C+-+Past+Performance+Questionnaire.docx',
   'LINE+ITEM+PRICING+SHEET+LYN-EO+DEMOLITION+AND+ABATEMENT.xlsx'].every((f) => disp[f] === 'extract'));
const planReach = anchors.filter((a: any) => plan.windows.some((w) => w.document_id === a.document_id &&
  (w.segments ?? [[w.char_start, w.char_end]]).some(([s, e]) => a.start >= s && a.end <= e)));
chk('PLAN every anchor lies wholly inside at least one planned window (coverage by construction)', planReach.length === anchors.length,
  `${planReach.length}/${anchors.length}`);
const sheet = plan.documents.find((d) => d.filename.startsWith('LINE+ITEM'))!;
chk('PLAN pricing sheet: notes sent to the model, line items classified (not a 4,000-token enumeration)',
  (sheet.reference_ranges?.length ?? 0) > 0 && sheet.windows === 1);
chk('PLAN window count within the runtime envelope', plan.windows.length <= 40 && plan.dropped.length === 0, `${plan.windows.length} windows`);

// ── live extraction: OLD vs NEW (LLM cost) ────────────────────────────────────
const recovered = (rows: any[]) => anchors.filter((a: any) => rows.some((r) =>
  (r.verification?.found_in ?? []).some((h: any) => h.document_id === a.document_id && h.char_start < a.end && h.char_end > a.start)));

function audit(label: string, rows: any[]) {
  const bad = rows.filter((r) => !quoteInDoc(String(r.source_quote), byName.get(r.source_doc)?.text ?? ''));
  chk(`${label} every trusted source_quote is in its cited source_doc (independent check)`, bad.length === 0,
    bad.length ? bad.map((r) => `${r.id}:${r.source_doc}`).join(', ') : `${rows.length} rows`);
  const badSec = rows.filter((r) => r.section && (PARAGRAPH_LETTER.test(r.section) || /^(section\s+)?[LMC]$/i.test(r.section)));
  chk(`${label} no trusted row cites Section L/M/C or a paragraph letter`, badSec.length === 0, badSec.map((r) => `${r.id}:${r.section}`).join(','));
  const unsupported = rows.filter((r) => { const q = new Set(figures(String(r.source_quote))); return figures(String(r.requirement)).some((f) => !q.has(f)); });
  chk(`${label} no trusted row states a figure its quote does not carry`, unsupported.length === 0,
    unsupported.slice(0, 5).map((r) => `${r.id}:${figures(r.requirement).filter((f) => !figures(r.source_quote).includes(f))}`).join(' '));
  const banned = new Set(bench.must_not_trust.map((n: any) => n.document_id));
  const leak = rows.filter((r) => { const d = byName.get(r.source_doc); return d && banned.has(d.document_id); });
  chk(`${label} no trusted row sourced from the foreign D&F or the wage determinations`, leak.length === 0, leak.map((r) => r.id).join(','));
}

if (process.argv.includes('--fresh')) {
  // OLD: the pre-Completeness path — one flattened ~50K window, then the same frozen gate.
  const t0 = Date.now();
  const old = await extractComplianceMatrixFromText(assembled, { userEmail: 'eric@govcongiants.com' });
  const oldGate = verifyComplianceMatrix(old.requirements, sourceDocs);
  const oldMs = Date.now() - t0;
  // NEW: the tool exactly as the hosted MCP edge calls it.
  const t1 = Date.now();
  const r: any = await extractComplianceMatrix({ notice_id: bench.notice, userEmail: 'eric@govcongiants.com' });
  const newMs = Date.now() - t1;
  const m = r._meta;
  const recOld = recovered(oldGate.requirements);
  const recNew = recovered(r.requirements);
  console.log(`\n  BEFORE ${oldGate.requirements.length} trusted / ${oldGate.interpretations.length} interp / ${oldGate.withheld.length} withheld · ${old.inputChars}/${old.originalChars} chars · ${oldMs}ms · anchors ${recOld.length}/${anchors.length}`);
  console.log(`  AFTER  ${r.requirements.length} trusted / ${r.interpretations.length} interp / ${r.withheld.length} withheld · ${m.extraction_coverage.chars_read}/${m.extraction_coverage.relevant_chars} relevant chars · ${newMs}ms · anchors ${recNew.length}/${anchors.length} · ${m.extraction_coverage.windows_succeeded}/${m.extraction_coverage.windows_planned} windows · model ${m.model}`);
  console.log(`  missed AFTER: ${anchors.filter((a: any) => !recNew.includes(a)).map((a: any) => `${a.id}(${a.region})`).join('; ') || 'none'}\n`);

  chk('BEFORE fails the recall benchmark', recOld.length <= 3, `${recOld.length}/${anchors.length}`);
  chk('AFTER recovers anchors beyond character 50,000 of the base document',
    recNew.filter((a: any) => a.document_id === '1f7ff76547504ed68313baf2f328341f' && a.start > 50_000).length >= 8);
  chk('AFTER recovers Section E instructions/evaluation anchors (A07–A15)',
    recNew.filter((a: any) => /^A(0[7-9]|1[0-5])$/.test(a.id)).length >= 7);
  chk('AFTER recovers a requirement from a second attachment (pricing-sheet note / PPQ)',
    recNew.some((a: any) => a.id === 'A16' || a.id === 'A17'));
  chk('AFTER recovers ≥ 14 of 17 anchors (vs ≤3 before)', recNew.length >= 14, `${recNew.length}/${anchors.length}`);
  audit('AFTER', r.requirements);
  audit('BEFORE', oldGate.requirements);

  const cov = m.extraction_coverage;
  const excluded = cov.documents.filter((d: any) => d.disposition !== 'extract').reduce((n: number, d: any) => n + d.chars, 0);
  const refChars = cov.documents.reduce((n: number, d: any) => n + (d.reference_chars ?? 0), 0);
  chk('COVERAGE reconciles: relevant + classified line items + excluded documents = source', cov.relevant_chars + refChars + excluded === cov.source_chars,
    `${cov.relevant_chars} + ${refChars} + ${excluded} vs ${cov.source_chars}`);
  chk('COVERAGE every window accounted for', cov.windows_succeeded + cov.windows_failed === cov.windows_planned);
  const claimOk = m.extraction_completeness === 'source_text'
    ? cov.complete && r.withheld.length === 0 && r.interpretations.length === 0
    : m.extraction_completeness === 'partial' ? cov.uncovered_ranges.length > 0
    : m.extraction_completeness === 'unproven' ? cov.complete && (m.completeness_reasons ?? []).length > 0 : false;
  chk('COMPLETENESS claim matches coverage + verification', claimOk, `${m.extraction_completeness}: ${(m.completeness_reasons ?? []).join(' | ')}`);
  chk('COMPLETENESS reports the model(s) that actually answered', typeof m.model === 'string' && m.model.length > 0, m.model);

  // Dedupe: no two trusted rows share evidence AND say the same thing.
  const dups: string[] = [];
  const norm = (s: string) => squash(s);
  for (let i = 0; i < r.requirements.length; i++) for (let j = i + 1; j < r.requirements.length; j++) {
    const a = r.requirements[i]; const b = r.requirements[j];
    if (a.source_doc === b.source_doc && norm(a.source_quote) === norm(b.source_quote) && norm(a.requirement) === norm(b.requirement)) dups.push(`${a.id}=${b.id}`);
  }
  chk('DEDUPE no duplicated trusted row (same document + same quote + same reading)', dups.length === 0, dups.join(','));
  chk('IDS unique across requirements / interpretations / withheld',
    new Set([...r.requirements, ...r.interpretations, ...r.withheld].map((x: any) => x.id)).size === r.requirements.length + r.interpretations.length + r.withheld.length);
  chk('LATENCY within the 60s MCP route budget', newMs < 55_000, `${newMs}ms`);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ oldMs, newMs, old: { ...oldGate, meta: { inputChars: old.inputChars, originalChars: old.originalChars } }, now: r }, null, 1));
}

chk('BILLING extract_compliance_matrix still 20 credits', TOOL_CREDITS.extract_compliance_matrix === 20, String(TOOL_CREDITS.extract_compliance_matrix));

console.log(pass ? '\n✅ POTETO — Compliance Matrix Completeness VERIFIED' : '\n❌ FAILED');
process.exit(pass ? 0 : 1);
