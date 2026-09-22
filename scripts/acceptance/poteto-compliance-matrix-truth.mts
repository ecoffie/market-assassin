/**
 * POTETO — Compliance Matrix Truth. Fixture: VA 36C24226Q0857 (the real stored package). Read-only.
 *
 *   PACKAGE → DOCUMENT → REQUIREMENT → QUOTE → SOURCE → MATRIX → VERIFY
 *
 * The verifier in THIS file is deliberately independent of src/lib/proposal/matrix-verification.ts
 * (its own normalization, its own search) so the gate is not grading itself.
 *
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-compliance-matrix-truth.mts          # frozen fixtures + live package
 *   npx tsx --env-file=.env.local scripts/acceptance/poteto-compliance-matrix-truth.mts --fresh  # + one live extraction (LLM cost)
 */
process.env.SAM_DOCS_READONLY = 'on';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSolicitationDocuments } from '../../src/lib/sam/solicitation-documents';
import { summarizeSourceCoverage } from '../../src/lib/sam/source-coverage';
import { verifyComplianceMatrix, type MatrixSourceDoc } from '../../src/lib/proposal/matrix-verification';
import { extractComplianceMatrix } from '../../src/mcp/tools/compliance-matrix';

let pass = true;
const chk = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
  if (!ok) pass = false;
};
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

// ── independent checker ───────────────────────────────────────────────────────
const squash = (s: string) =>
  s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2').replace(/\s+/g, '').toLowerCase();
function quoteInDoc(quote: string, docText: string): boolean {
  const hay = squash(docText);
  let from = 0;
  const parts = quote.split(/\.{3,}|…/).map((p) => squash(p).replace(/^[."',;:]+|[."',;:]+$/g, '')).filter((p) => p.length >= 10);
  if (!parts.length) return false;
  for (const p of parts) {
    const at = hay.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}
const PARAGRAPH_LETTER = /^\(?[a-z]{1,2}\)?(\(\w+\))*$/i; // l, m(3), B(vi), (l)
function sectionPrinted(label: string, docText: string): boolean {
  const esc = label.replace(/^section\s+/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)[ \\t]*(section[ \\t]+)?${esc}(?![\\w.])`, 'i').test(docText);
}

// ── STEP 1: the package ───────────────────────────────────────────────────────
const pkg: any = await getSolicitationDocuments({ noticeId: '36C24226Q0857', textMode: 'full' } as any);
const cov = summarizeSourceCoverage(pkg);
const docs: MatrixSourceDoc[] = [
  ...(pkg.description ? [{ document_id: 'notice_description', filename: 'Notice description', text: pkg.description, role: 'notice_description' as const }] : []),
  ...pkg.documents.filter((d: any) => (d.extracted_text || '').trim())
    .map((d: any) => ({ document_id: d.document_id, filename: d.filename, text: d.extracted_text, role: 'attachment' as const })),
];
const byName = new Map(docs.map((d) => [d.filename, d.text]));
const all = docs.map((d) => d.text).join('\n');
chk('PACKAGE 7 documents, all complete, none unreadable', pkg.documents.length === 7 && cov.complete && cov.documents_unreadable === 0,
  pkg.documents.map((d: any) => `${d.filename}:${d.text_availability}`).join(', ').slice(0, 160));
chk('PACKAGE no amendment documents', !pkg.documents.some((d: any) => d.doc_kind === 'amendment' || /amend|sf.?30/i.test(d.filename)));
chk('PACKAGE truncated_attachments is honest (0 — every doc complete)', pkg.truncated_attachments === 0, String(pkg.truncated_attachments));
// STEP 5: does Section L exist?
chk('SECTION L does NOT exist in any readable document', !/(^|\n)\s*SECTION\s+L\b/i.test(all) && !/(^|\n)\s*L\.\d/.test(all));
chk('SECTION E (52.212-1 instructions / 52.212-2 evaluation) is where this FAR Part 12 package puts them',
  /SECTION E - SOLICITATION PROVISIONS/.test(all) && /52\.212-1\s+INSTRUCTIONS TO OFFERORS/.test(all) && /52\.212-2\s+EVALUATION/.test(all));

// ── STEP 2/4: the production-before matrix through the gate ───────────────────
const prod = load('compliance-matrix-36C24226Q0857-prod-before.json');
const gP = verifyComplianceMatrix(prod.requirements, docs);
chk('PROD-BEFORE 68 candidates', gP.summary.candidates_total === 68);
chk('PROD-BEFORE good rows survive (≥50 of 68 verified)', gP.requirements.length >= 50, `${gP.requirements.length} verified / ${gP.withheld.length} withheld`);
const submittal = gP.withheld.filter((w) => /as specified in Section/.test(String(w.requirement)));
chk('PROD-BEFORE submittal-log rows quoting an unrelated sentence are withheld', submittal.length >= 13 && gP.requirements.every((r) => !/Fire Safety Plan|Debris Management Plan/.test(String(r.requirement))),
  `${submittal.length} withheld`);
chk('PROD-BEFORE no trusted row cites a paragraph letter or invented C.2.x section',
  gP.requirements.every((r) => !r.section || (!PARAGRAPH_LETTER.test(r.section) && !/^C\.2\./.test(r.section))),
  [...new Set(gP.requirements.map((r) => r.section).filter(Boolean))].join(','));

// ── STEP 4: the reproduced pre-fix failures (4 × section "l", unverifiable quotes) ─
const pre = load('compliance-matrix-36C24226Q0857-prefix-run.json');
const secL = pre.requirements.filter((r: any) => /^l$/i.test(String(r.section)));
const notFound = pre.requirements.filter((r: any) => !quoteInDoc(String(r.source_quote || ''), all));
chk('PRE-FIX reproduces 4 rows citing section "l"', secL.length === 4, String(secL.length));
chk('PRE-FIX reproduces quotes absent from the package', notFound.length >= 3, `${notFound.length} of ${pre.requirements.length}`);
const gR = verifyComplianceMatrix(pre.requirements, docs);
chk('PRE-FIX no "l" section survives on any trusted/interpreted row',
  [...gR.requirements, ...gR.interpretations].every((r: any) => !/^l$/i.test(String(r.section ?? ''))));
chk('PRE-FIX every absent quote is withheld or demoted to interpretation (never a trusted quote)',
  notFound.every((r: any) => !gR.requirements.some((t) => t.id === r.id)));

// ── STEP 3: independent re-verification of every trusted row ──────────────────
function independentAudit(label: string, rows: any[]) {
  const bad = rows.filter((r) => !quoteInDoc(String(r.source_quote), byName.get(r.source_doc) ?? ''));
  chk(`${label} every trusted source_quote is in its cited source_doc (independent check)`, bad.length === 0,
    bad.length ? bad.map((r) => `${r.id}:${r.source_doc}`).join(', ') : `${rows.length} rows`);
  const badSec = rows.filter((r) => r.section && (PARAGRAPH_LETTER.test(r.section) || !sectionPrinted(r.section, byName.get(r.source_doc) ?? '')));
  chk(`${label} every trusted section is printed in its document`, badSec.length === 0, badSec.map((r) => `${r.id}:${r.section}`).join(','));
}
independentAudit('PROD-BEFORE(gated)', gP.requirements);
independentAudit('PRE-FIX(gated)', gR.requirements);
chk('PRE-FIX interpretations carry VERBATIM source evidence, never a quote field',
  gR.interpretations.every((i: any) => !('source_quote' in i) && quoteInDoc(i.source_evidence, byName.get(i.source_doc) ?? '')));

// ── optional: one fresh extraction through the real tool ──────────────────────
if (process.argv.includes('--fresh')) {
  const r: any = await extractComplianceMatrix({ notice_id: '36C24226Q0857', userEmail: 'eric@govcongiants.com' });
  const m = r._meta;
  chk('FRESH grounded, not degraded', m.grounded === true && m.degraded === false, `${r.requirements.length} verified`);
  chk('FRESH reports verified vs withheld', m.verification?.requirements_verified === r.requirements.length &&
    m.verification?.candidates_withheld === r.withheld.length, JSON.stringify(m.verification?.withheld_by_reason));
  chk('FRESH does not claim completeness from a partial read', m.extraction_coverage.complete === false &&
    m.extraction_completeness === 'unproven', `${m.extraction_coverage.chars_read}/${m.extraction_coverage.source_chars} chars read`);
  chk('FRESH truncated_attachments = 0 on a fully-complete package', m.truncated_attachments === 0);
  independentAudit('FRESH', r.requirements);
}

console.log(pass ? '\n✅ POTETO — Compliance Matrix Truth VERIFIED' : '\n❌ FAILED');
process.exit(pass ? 0 : 1);
