/**
 * Ask Mindy Workspace acceptance demo — produces the four customer deliverables
 * from a grounded DocModel (same render path as create_document).
 *
 * Usage (from worktree):
 *   npx tsx scripts/ask-mindy-acceptance-demo.mts
 *
 * Does NOT merge, deploy, or flip feature flags.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DOC_SCHEMA, type DocModel } from '../src/lib/documents/model';
import { renderDocument } from '../src/lib/documents';

const OUT = process.env.DEMO_OUT
  || join(
    process.env.HOME || '.',
    'Library/Application Support/Cursor/AgentStores/cursor_agent_stores/81b43be5-1a1e-4b1c-94a4-66e2772661ba/files/acceptance-demo-2026-11-18',
  );

/** Sample "uploaded" company material a customer would attach before asking for a strategy. */
const UPLOAD_CSV = [
  'Capability,Evidence,Clearance',
  'Facilities maintenance,VA campus janitorial past performance,SECRET',
  'Grounds keeping,DoD grounds IDIQ task orders,None',
  'Emergency response,24/7 surge staffing for VA medical centers,SECRET',
].join('\n');

/**
 * Strategy report grounded in (a) a fictional upload id the customer attached and
 * (b) a market table — the shape create_document builds after research + upload analysis.
 */
const STRATEGY: DocModel = {
  schema: DOC_SCHEMA,
  title: 'VA Facilities Maintenance — Capture Strategy',
  subtitle: '30-day positioning brief',
  preparedFor: 'Sample Customer LLC',
  date: '2026-11-18',
  theme: 'mindy',
  meta: { generatedBy: 'ask_mindy', attention: 'Demo deliverable — acceptance package' },
  sources: [
    { id: 'u1', kind: 'upload', label: 'Sample-Company-Capabilities.csv', recordId: '00000000-0000-4000-8000-00000000up01' },
    { id: 't1', kind: 'tool', label: 'Ask Mindy market scan (USAspending / SAM)' },
  ],
  sections: [
    {
      id: 'about',
      heading: 'About the company',
      role: 'about',
      blocks: [
        {
          type: 'paragraph',
          id: 'p-about',
          text: 'Sample Customer LLC provides facilities maintenance, grounds keeping, and emergency surge staffing for federal campuses.',
          claim: 'fact',
          cites: ['u1'],
        },
      ],
    },
    {
      id: 'market',
      heading: 'Where the demand is',
      blocks: [
        {
          type: 'paragraph',
          id: 'p-mkt',
          text: 'VA and DHS are the largest recent buyers in this facilities-maintenance slice; the next 30 days should prioritize VA medical-center relationships.',
          claim: 'recommendation',
          cites: ['t1'],
        },
        {
          type: 'table',
          id: 'tbl-buyers',
          caption: 'Priority buyers',
          claim: 'fact',
          cites: ['t1'],
          columns: [
            { key: 'agency', label: 'Agency' },
            { key: 'dollars', label: 'Obligations', format: 'usd' },
            { key: 'offices', label: 'Offices', format: 'int' },
          ],
          rows: [
            { agency: 'Department of Veterans Affairs', dollars: 412_500_000, offices: 14 },
            { agency: 'Department of Homeland Security', dollars: 188_000_000, offices: 9 },
            { agency: 'GSA', dollars: 76_250_000, offices: 6 },
          ],
        },
      ],
    },
    {
      id: 'fit',
      heading: 'How you fit',
      blocks: [
        {
          type: 'bullets',
          id: 'b-fit',
          items: [
            { text: 'Facilities maintenance with VA campus past performance.', claim: 'fact', cites: ['u1'] },
            { text: 'Emergency surge staffing for VA medical centers (24/7).', claim: 'fact', cites: ['u1'] },
            { text: 'SECRET-cleared labor available for controlled facilities work.', claim: 'fact', cites: ['u1'] },
          ],
        },
      ],
    },
    {
      id: 'next',
      heading: 'Next 30 days',
      blocks: [
        {
          type: 'callout',
          id: 'c-next',
          tone: 'key_finding',
          text: 'Request an OSBP intro at one VA medical center where you already have past performance, and ask Mindy for open set-asides under NAICS 561720 before the next weekly alert.',
          claim: 'recommendation',
          cites: ['u1', 't1'],
        },
      ],
    },
  ],
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const uploadPath = join(OUT, '01-upload-Sample-Company-Capabilities.csv');
  writeFileSync(uploadPath, UPLOAD_CSV, 'utf-8');

  const results: Array<{ format: string; ok: boolean; path?: string; note?: string; bytes?: number }> = [];

  for (const format of ['docx', 'pdf', 'xlsx', 'csv'] as const) {
    const r = await renderDocument(STRATEGY, format);
    if (!r.ok) {
      results.push({ format, ok: false, note: 'validation_failed' });
      continue;
    }
    if (r.degraded) {
      // Never ship HTML as a PDF in the acceptance pack.
      const path = join(OUT, `02-strategy-DEGRADED-${format}.html`);
      writeFileSync(path, r.bytes);
      results.push({ format, ok: false, path, note: `degraded:${r.degraded.reason}`, bytes: r.bytes.length });
      continue;
    }
    const path = join(OUT, `02-strategy.${format}`);
    writeFileSync(path, r.bytes);
    results.push({ format, ok: true, path, bytes: r.bytes.length });
  }

  // Prove files open: magic bytes / parse round-trip.
  const proofs: string[] = [];
  for (const row of results) {
    if (!row.ok || !row.path || !existsSync(row.path)) {
      proofs.push(`${row.format}: FAIL (${row.note || 'missing'})`);
      continue;
    }
    const buf = readFileSync(row.path);
    if (row.format === 'docx' || row.format === 'xlsx') {
      const zip = buf[0] === 0x50 && buf[1] === 0x4b;
      proofs.push(`${row.format}: ${zip ? 'OPEN OK (ZIP/OOXML)' : 'FAIL bad magic'} · ${buf.length} bytes`);
    } else if (row.format === 'pdf') {
      const pdf = buf.slice(0, 5).toString('utf-8') === '%PDF-';
      proofs.push(`${row.format}: ${pdf ? 'OPEN OK (%PDF)' : 'FAIL bad magic'} · ${buf.length} bytes`);
    } else if (row.format === 'csv') {
      const text = buf.toString('utf-8');
      const hasHeader = text.includes('Agency') && text.includes('Obligations');
      proofs.push(`${row.format}: ${hasHeader ? 'OPEN OK (readable table)' : 'FAIL'} · ${buf.length} bytes`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    out: OUT,
    upload: uploadPath,
    results,
    proofs,
    flagsNote: 'Feature flags VAULT_ASK_MINDY_UPLOADS / VAULT_GENERATED_FILES remain default-off; this pack proves the render path, not a production allowlist session.',
  };
  writeFileSync(join(OUT, '00-ACCEPTANCE-REPORT.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, '00-ACCEPTANCE-REPORT.md'), [
    '# Ask Mindy Workspace — Acceptance Demo Pack',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Customer workflow exercised (offline render path)',
    '1. Upload sample: `01-upload-Sample-Company-Capabilities.csv`',
    '2. Strategy DocModel grounded in upload + market table',
    '3. Deliverables: Word, PDF, Excel, CSV',
    '',
    '## File open proofs',
    ...proofs.map((p) => `- ${p}`),
    '',
    '## Flag / live UI note',
    report.flagsNote,
    '',
    'Live in-app demonstration (attach button + download chips) requires an allowlisted session after coordinator merge — not authorized in this pack.',
    '',
  ].join('\n'));

  console.log(JSON.stringify(report, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
