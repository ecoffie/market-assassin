/**
 * MRR Block 8 — connect the renderer to the template assembler.
 *
 * ONLY rendered cells reach this file. Nothing here formats a raw value: every
 * string it writes came out of `EvidenceCollector.render(...)`, so a bare value
 * cannot bypass the grounding renderer on its way to the page.
 *
 * Sections outside this weekend's slice are left present and visibly marked
 * `[To be completed — Phase 2]` — the document structure stays intact and
 * nothing is faked.
 */
import type { Section5 } from './section-5-taxonomy';
import type { Section9 } from './section-9-history';
import type { Requirement } from './types';
import { EvidenceCollector, type RenderedCell } from './grounding';
import { formatSizeStandard } from './sba-size-standards';
import {
  PROTOTYPE_BANNER, TEMPLATE_PATH, assertTemplateUnchanged, blockText, findAnchorIndex,
  findTableIndexAfter, getDocumentXml, paragraph, readDocxParts, rebuildDocumentXml,
  rebuildTable, splitBlocks, tableCell, tableCellAmount, tableCellLink, tableRow, tableRows,
  withRowProps, addHyperlinks, setTableWidths, writeDocx,
} from './docx-fill';

const PHASE2 = '[To be completed — Phase 2]';

/** Sections deliberately NOT built this weekend; each is marked, never faked. */
const PHASE2_SECTIONS = [
  '2. Points of Contact', '3. Contracting Activity', '4. Independent Government Estimate (IGE)',
  '6. Description of Supplies/Services', '7. Performance Requirements', '8. Background',
  '10. Non-Commercial Rationale (RFA)', '11. Potential Supplier Information',
  '12. Small Business Opportunities', '13. Mandatory Sources (FAR Part 8 / DFARS Part 208)',
  '14. Market Research Techniques Used', '15. Market Intelligence / Industry Analysis',
  '16. Conclusions and Recommendations',
];

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export interface AssembleResult {
  cells: RenderedCell[];
  outPath: string;
}

export function assembleMrr(
  req: Requirement,
  s5: Section5,
  s9: Section9,
  outPath: string,
  generatedAt: string,
): AssembleResult {
  assertTemplateUnchanged();
  const collector = new EvidenceCollector();

  const parts = readDocxParts(TEMPLATE_PATH);
  const xml = getDocumentXml(parts);
  const blocks = splitBlocks(xml);

  // ---------- §9 table first (indices shift as we insert; do the LAST anchor first) ----------
  const s9Anchor = findAnchorIndex(blocks, '9. Procurement History');
  const tblIdx = findTableIndexAfter(blocks, s9Anchor);
  const original = blocks[tblIdx];
  // The template's own header row, marked to REPEAT on every page the table spans.
  const header = withRowProps(tableRows(original)[0], { header: true, cantSplit: true });
  // Widths re-balanced (total 9360 twips = the body width). The contract column no
  // longer has to hold a ~90-char URL, so that space goes to Amount and Period of
  // Performance, which were breaking dollar amounts mid-number.
  // Sized to the CONTENT, total 9360 twips (the body width):
  //   contract+recipient 2400 · type 900 · method 800 · offerors 800 · AMOUNT 2260 · POP 2200
  // Amount is the widest data column because a figure like "$1,680,767,128" is 14
  // characters at 9pt (~1,900 twips) and must never wrap; the rest is padding so the
  // right-aligned figure never touches the cell edge.
  const WIDTHS = [2400, 900, 800, 800, 2260, 2200];

  // The scope banner must appear BEFORE the table, not after it. A reader who scans
  // the award rows and stops has to already know these are market-wide comparables
  // for the NAICS/PSC — not this activity's own procurement history. Putting the
  // caveat below the data is the same failure as a footnote nobody reaches.
  const scopeBanner: string[] = [];
  if (s9.awardsFinding.state === 'value' && /Scope note:/.test((s9.awardsFinding as { value: string }).value)) {
    scopeBanner.push(paragraph(
      'SCOPE — MARKET-WIDE COMPARABLES, NOT THIS ACTIVITY’S CONTRACT HISTORY: ' +
      'no awards matched when the search was filtered to the requiring activity, so the rows below are ' +
      'comparable awards across the NAICS/PSC market. They are NOT the requiring activity’s own ' +
      'procurement history and must not be read as prior awards by this office.',
      { bold: true },
    ));
  }

  // Register one hyperlink relationship per award BEFORE building rows, so each row
  // can reference a real rId (a dangling r:id makes Word declare the file corrupt).
  const linkUrls = s9.awards.map((a) => a.usaSpendingUrl).filter((u): u is string => !!u);
  const linkIds = linkUrls.length ? addHyperlinks(parts, linkUrls) : [];
  let linkCursor = 0;

  // Repeating the full "Unknown / Insufficient evidence — the source did not report…"
  // sentence in 50 cells made every row four lines tall and pushed the table over four
  // pages. The concise marker carries the same meaning; the full explanation is stated
  // ONCE below the table, where a reader still meets it.
  const UNKNOWN_MARK = 'Unknown¹';
  const concise = (cell: RenderedCell) => (cell.state === 'unknown' ? UNKNOWN_MARK : cell.text);

  const bodyRows: string[] = [];
  if (s9.awards.length === 0) {
    const finding = collector.render('§9 Award history', s9.awardsFinding);
    bodyRows.push(tableRow(
      [tableCell(finding.text, WIDTHS[0]), ...WIDTHS.slice(1).map((w) => tableCell('—', w))],
      { cantSplit: true },
    ));
  } else {
    s9.awards.forEach((a, i) => {
      const n = i + 1;
      const num = collector.render(`§9 Award ${n} contract number`, a.contractNumber);
      const rec = collector.render(`§9 Award ${n} recipient`, a.recipient);
      const typ = collector.render(`§9 Award ${n} contract type`, a.awardType);
      const met = collector.render(`§9 Award ${n} procurement method`, a.procurementMethod);
      const off = collector.render(`§9 Award ${n} offerors`, a.offerors);
      // Amount: the FIGURE and its source label are rendered as two paragraphs in one
      // cell, so the complete currency token can never be split across lines while the
      // label is free to wrap. The rendered cell text still carries both, so the
      // evidence appendix and the document agree.
      const amt = collector.render(`§9 Award ${n} amount`, a.amount, (v) => `${money(v.value)} — ${v.label}`);
      const amtFigure = a.amount.state === 'value' ? money((a.amount as { value: { value: number } }).value.value) : amt.text;
      const amtLabel = a.amount.state === 'value' ? (a.amount as { value: { label: string } }).value.label : '';
      const pop = collector.render(`§9 Award ${n} period of performance`, a.periodOfPerformance);

      const firstCell = a.usaSpendingUrl
        ? tableCellLink(`${num.text} — ${rec.text}`, 'USASpending source', linkIds[linkCursor++], WIDTHS[0])
        : tableCell(`${num.text} — ${rec.text}`, WIDTHS[0]);

      bodyRows.push(tableRow(
        [
          firstCell,
          tableCell(typ.text, WIDTHS[1]),
          tableCell(concise(met), WIDTHS[2]),
          tableCell(concise(off), WIDTHS[3]),
          tableCellAmount(amtFigure, amtLabel, WIDTHS[4]),
          tableCell(pop.text, WIDTHS[5]),
        ],
        { cantSplit: true },
      ));
    });
  }
  // Apply WIDTHS to the tblGrid AND every row (template header included). The grid is
  // resolved first by both Word and LibreOffice, so body-cell tcW alone had no effect.
  blocks[tblIdx] = setTableWidths(rebuildTable(original, [header, ...bodyRows]), WIDTHS);
  if (scopeBanner.length) blocks.splice(tblIdx, 0, ...scopeBanner);

  // §9 narrative directly after the table: the footnote, the finding, the predecessor.
  const findingCell = s9.awards.length ? collector.render('§9 Award history finding', s9.awardsFinding) : null;
  const pred = collector.render('§9 Predecessor / incumbent', s9.predecessor);
  const after: string[] = [];
  // The single, complete explanation for every Unknown¹ marker in the table.
  after.push(paragraph(
    '¹ The source did not report the procurement method or number of offerors. ' +
    'Unknown is not treated as zero.',
  ));
  if (findingCell) after.push(paragraph(`Award history: ${findingCell.text}`));
  after.push(paragraph(`Predecessor / incumbent: ${pred.text}`));
  if (s9.predecessorStatus === 'degraded') {
    after.push(paragraph(
      'The candidate award returned by the incumbent lookup did not satisfy the agency and NAICS consistency ' +
      'checks required to identify it as a predecessor. It is retained in the Sourced Evidence Appendix for ' +
      'reviewer judgement and is not asserted here as the incumbent.',
    ));
  }
  blocks.splice(tblIdx + scopeBanner.length + 1, 0, ...after);

  // ---------- §5 Taxonomy ----------
  const s5Anchor = findAnchorIndex(blocks, '5. Taxonomy');
  // Replace the template's grey sample lines (PSC/NAICS/basis) with rendered facts.
  // The instructional paragraphs that follow the heading are the sample text the
  // template says to delete on export; we replace exactly those.
  let end = s5Anchor + 1;
  while (end < blocks.length && !blockText(blocks[end]).startsWith('6. Description')) end++;

  const psc = collector.render('§5 Primary PSC', s5.primaryPsc);
  const pscT = collector.render('§5 PSC description', s5.pscTitle);
  const naics = collector.render('§5 Primary NAICS', s5.primaryNaics);
  const naicsT = collector.render('§5 NAICS description', s5.naicsTitle);
  const size = collector.render('§5 SBA size standard', s5.sizeStandard, formatSizeStandard);
  const basis = collector.render('§5 Basis for NAICS selection', s5.naicsBasis);
  const market = collector.render('§5 Measured market total', s5.marketTotal, money);
  const cov = collector.render('§5 Cumulative coverage', s5.cumulativeCoveragePct, (v) => `${(v * 100).toFixed(0)}%`);
  const kw = collector.render('§5 Coverage keyword', s5.coverageKeyword);

  const s5Body = [
    paragraph('Portfolio Group: ' + PHASE2),
    paragraph('Portfolio: ' + PHASE2),
    paragraph(`PSC: ${psc.text}   PSC Description: ${pscT.text}`),
    paragraph(`NAICS Code: ${naics.text}   Size Standard: ${size.text}`),
    paragraph(`NAICS Description / Index Category: ${naicsT.text}`),
    paragraph(`Basis for NAICS selection: ${basis.text}`),
    paragraph(`Measured market for keyword "${kw.text}": ${market.text}; cumulative coverage ${cov.text}.`),
    paragraph(`Measurement basis: ${s5.marketBasis}`),
    paragraph(`Size standard source: ${s5.sizeStandardCitation}`),
    paragraph(`Keyword selection rule: ${s5.selectionRule}`),
  ];
  blocks.splice(s5Anchor + 1, end - (s5Anchor + 1), ...s5Body);

  // ---------- §1 identification ----------
  const a1 = findAnchorIndex(blocks, '1. Product/Equipment/Service/Program');
  const id: string[] = [
    paragraph(`${req.title} — ${req.agency}${req.sub_agency ? ` (${req.sub_agency})` : ''}`),
  ];
  if (req.solicitation_number) id.push(paragraph(`Solicitation number: ${req.solicitation_number}`));
  if (req.notice_id) id.push(paragraph(`SAM notice ID: ${req.notice_id}`));
  id.push(paragraph(`Report generated: ${generatedAt}`));
  blocks.splice(a1 + 1, 1, ...id);

  // ---------- Phase-2 markers on every out-of-scope section ----------
  for (const name of PHASE2_SECTIONS) {
    let idx: number;
    try { idx = findAnchorIndex(blocks, name); } catch { continue; }
    blocks.splice(idx + 1, 0, paragraph(PHASE2, { bold: true }));
  }

  // ---------- prototype banner at the very top ----------
  blocks.unshift(paragraph(
    `${PROTOTYPE_BANNER} — generated from a rebuilt editable template. Sections 5 and 9 are populated from ` +
    'sourced data; all other sections are Phase 2 placeholders. Not a signed government determination.',
    { bold: true },
  ));

  writeDocx(parts, rebuildDocumentXml(xml, blocks), outPath);
  assertTemplateUnchanged();

  return { cells: collector.all(), outPath };
}
