/**
 * MRR Block 8 — connect the renderer to the template assembler.
 *
 * ONLY rendered cells reach this file. Nothing here formats a raw value: every
 * string it writes came out of `EvidenceCollector.render(...)`, so a bare value
 * cannot bypass the grounding renderer on its way to the page.
 *
 * Phase 1 populates §5, §9, §11, §12, and §15. Remaining sections stay marked
 * `[To be completed — Phase 2]` — the document structure stays intact and
 * nothing is faked.
 */
import type { Section5 } from './section-5-taxonomy';
import type { Section9 } from './section-9-history';
import type { Section11 } from './section-11-suppliers';
import type { Section12 } from './section-12-rule-of-two';
import type { Section15 } from './section-15-intel';
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

/** Sections deliberately NOT built in Phase 1; each is marked, never faked. */
const PHASE2_SECTIONS = [
  '2. Points of Contact', '3. Contracting Activity', '4. Independent Government Estimate (IGE)',
  '6. Description of Supplies/Services', '7. Performance Requirements', '8. Background',
  '10. Non-Commercial Rationale (RFA)',
  '13. Mandatory Sources (FAR Part 8 / DFARS Part 208)',
  '14. Market Research Techniques Used',
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
  s11: Section11,
  s12: Section12,
  s15: Section15,
  outPath: string,
  generatedAt: string,
): AssembleResult {
  assertTemplateUnchanged();
  const collector = new EvidenceCollector();

  const parts = readDocxParts(TEMPLATE_PATH);
  const xml = getDocumentXml(parts);
  const blocks = splitBlocks(xml);

  // Fill later anchors first so earlier indices stay stable.
  fillSection15(blocks, collector, s15);
  fillSection12(blocks, collector, s12);
  fillSection11(blocks, collector, s11);
  fillSection9(blocks, parts, collector, s9);
  fillSection5(blocks, collector, s5);
  fillSection1(blocks, req, generatedAt);

  // ---------- Phase-2 markers on every out-of-scope section ----------
  for (const name of PHASE2_SECTIONS) {
    let idx: number;
    try { idx = findAnchorIndex(blocks, name); } catch { continue; }
    blocks.splice(idx + 1, 0, paragraph(PHASE2, { bold: true }));
  }

  // ---------- prototype banner at the very top ----------
  blocks.unshift(paragraph(
    `${PROTOTYPE_BANNER} — generated from a rebuilt editable template. Sections 5, 9, 11, 12, and 15 ` +
    'are populated from sourced data; remaining sections are Phase 2 placeholders. ' +
    'Not a signed government determination.',
    { bold: true },
  ));

  writeDocx(parts, rebuildDocumentXml(xml, blocks), outPath);
  assertTemplateUnchanged();

  return { cells: collector.all(), outPath };
}

function fillSection15(blocks: string[], collector: EvidenceCollector, s15: Section15): void {
  const anchor = findAnchorIndex(blocks, '15. Market Intelligence / Industry Analysis');
  let end = anchor + 1;
  while (end < blocks.length && !blockText(blocks[end]).startsWith('Part 3')) end++;

  const total = collector.render('§15 Total measured market', s15.totalMarket, money);
  const conc = collector.render('§15 Supplier concentration', s15.supplierConcentration);
  const div = collector.render('§15 Market diversity', s15.marketDiversity);
  const sb = collector.render('§15 Small business footprint', s15.sbFootprint);
  const socio = collector.render('§15 Socioeconomic footprint', s15.socioeconomicFootprint);
  const price = collector.render('§15 Pricing evidence', s15.pricingEvidence);

  const body = [
    paragraph(
      'a. Measured market and supplier structure (AUTO — sourced). Commerciality determination ' +
      '(template item b) remains Phase 2 / KO-owned and is not asserted here.',
    ),
    paragraph(`Total measured market: ${total.text}. Measurement basis: ${s15.marketBasis}`),
    paragraph(`Supplier concentration: ${conc.text}`),
    paragraph(`Market diversity: ${div.text}`),
    paragraph(`Small business footprint (from §12): ${sb.text}`),
    paragraph(`Socioeconomic footprint (from §12): ${socio.text}`),
    paragraph(
      `Pricing evidence (GSA CALC / market rates — ${s15.pricingIsIge === false ? 'NOT an Independent Government Estimate' : 'ERROR'}): ${price.text}`,
    ),
    paragraph('b. Commerciality / FAR Part 12 determination: ' + PHASE2),
    paragraph('c. Additional industry analysis: ' + PHASE2),
    paragraph('d. Other: ' + PHASE2),
  ];
  blocks.splice(anchor + 1, end - (anchor + 1), ...body);
}

function fillSection12(blocks: string[], collector: EvidenceCollector, s12: Section12): void {
  const anchor = findAnchorIndex(blocks, '12. Small Business Opportunities');
  let end = anchor + 1;
  while (end < blocks.length && !blockText(blocks[end]).startsWith('13. Mandatory')) end++;

  const det = collector.render('§12 Rule of Two determination', s12.determination);
  const rec = collector.render('§12 Set-aside recommendation', s12.recommendation);
  const n = collector.render('§12 Capable parent-deduplicated SB families', s12.capableFamilyCount);
  const cov = collector.render('§12 Sample coverage', s12.sampleCoverage, (v) => `${(v * 100).toFixed(0)}%`);
  const goal = collector.render('§12 SBA goaling context', s12.goalingContext);

  const socioLines = s12.socioCounts.map((s) => {
    const cell = collector.render(`§12 ${s.designation} family count`, s.familyCount);
    return `${s.designation}: ${cell.text}`;
  });

  const listed = s12.countedFamilies.length
    ? s12.countedFamilies.map((f) => `${f.displayName} (${f.familyKey} / UEI ${f.uei})`).join('; ')
    : 'none counted';

  // Collapse identical exclusion reasons (e.g. the same BQ quota error on 50 UEIs)
  // so the Word body does not become pages of duplicated URLs.
  const excludedText = summarizeExclusions(s12.excluded);

  const body = [
    paragraph(`Rule of Two determination: ${det.text}`),
    paragraph(`Recommendation: ${rec.text}`),
    paragraph(
      s12.capableFamilyCount.state === 'unknown' || s12.capableFamilyCount.state === 'degraded'
        ? `Capable small-business family count (parent-deduplicated, among the evaluated sample only): ${n.text}. ` +
          `This is not a measured market-wide finding of zero capable small businesses. ` +
          `Sample coverage for the depth query: ${cov.text}.`
        : `Capable small-business concerns counted (distinct parent-deduplicated corporate families among the evaluated sample, ` +
          `not raw UEIs and not a complete-market census): ${n.text}. Sample coverage for the depth query: ${cov.text}.`,
    ),
    paragraph(`Counted families: ${listed}`),
    paragraph(`Excluded from the Rule-of-Two count: ${excludedText}`),
    paragraph(`Socioeconomic designations (family-deduplicated; no double-count across UEIs): ${socioLines.join(' · ') || 'Unknown'}`),
    paragraph(`SBA goaling context: ${goal.text}`),
    ...(s12.limitations.length
      ? [paragraph(`§12 limitations: ${s12.limitations.join(' | ')}`)]
      : []),
  ];
  blocks.splice(anchor + 1, end - (anchor + 1), ...body);
}

/** Summarize RoT exclusions: group by reason, list a few UEIs, avoid URL spam. */
function summarizeExclusions(excluded: Array<{ uei: string; reason: string }>): string {
  if (!excluded.length) return 'none';
  const byReason = new Map<string, string[]>();
  for (const e of excluded) {
    const reason = shortenReason(e.reason);
    const list = byReason.get(reason) ?? [];
    list.push(e.uei);
    byReason.set(reason, list);
  }
  const parts: string[] = [];
  for (const [reason, ueis] of byReason) {
    const sample = ueis.slice(0, 5).join(', ');
    const more = ueis.length > 5 ? ` (+${ueis.length - 5} more)` : '';
    parts.push(`${ueis.length} UEI(s) — ${reason} [e.g. ${sample}${more}]`);
  }
  return parts.join('; ');
}

function shortenReason(reason: string): string {
  const r = (reason || '').trim();
  if (/QueryUsagePerDay|Custom quota exceeded/i.test(r)) {
    return 'parent-edge lookup failed (BigQuery QueryUsagePerDay quota exceeded)';
  }
  if (r.length > 160) return `${r.slice(0, 157)}…`;
  return r || 'unspecified';
}

function fillSection11(blocks: string[], collector: EvidenceCollector, s11: Section11): void {
  const anchor = findAnchorIndex(blocks, '11. Potential Supplier Information');
  // Drop template instructional paragraphs between the heading and the vendor table.
  let tblIdx = findTableIndexAfter(blocks, anchor);
  if (tblIdx > anchor + 1) {
    blocks.splice(anchor + 1, tblIdx - (anchor + 1));
    tblIdx = findTableIndexAfter(blocks, anchor);
  }

  const original = blocks[tblIdx];
  const header = withRowProps(tableRows(original)[0], { header: true, cantSplit: true });
  // Template vendor table: Vendor · CAGE · Size · Location · POC · Capability (sum 9360)
  const WIDTHS = [2000, 1000, 1400, 1400, 1560, 2000];

  const UNKNOWN_MARK = 'Unknown¹';
  const concise = (cell: RenderedCell) => (cell.state === 'unknown' ? UNKNOWN_MARK : cell.text);

  /** Cap rendered table rows — full resolved set still feeds §12 via Section11. */
  const MAX_TABLE_ROWS = 25;
  const displaySuppliers = s11.suppliers.slice(0, MAX_TABLE_ROWS);

  const bodyRows: string[] = [];
  if (displaySuppliers.length === 0) {
    const finding = collector.render('§11 Supplier list', unknownAsFinding(s11));
    bodyRows.push(tableRow(
      [tableCell(finding.text, WIDTHS[0]), ...WIDTHS.slice(1).map((w) => tableCell('—', w))],
      { cantSplit: true },
    ));
  } else {
    displaySuppliers.forEach((s, i) => {
      const n = i + 1;
      const name = collector.render(`§11 Supplier ${n} canonical name`, s.canonicalName);
      const legal = collector.render(`§11 Supplier ${n} legal entity`, s.legalEntityName);
      const uei = collector.render(`§11 Supplier ${n} UEI`, s.uei);
      const cage = collector.render(`§11 Supplier ${n} CAGE`, s.cage);
      const size = collector.render(`§11 Supplier ${n} business size`, s.businessSize);
      const socio = collector.render(`§11 Supplier ${n} socioeconomic`, s.socioeconomic, (v) => (v.length ? v.join(', ') : 'none recorded'));
      const loc = collector.render(`§11 Supplier ${n} location`, s.location);
      const poc = collector.render(`§11 Supplier ${n} POC`, s.poc);
      // Capability stays compact in the Word table; full award/capability prose is in the appendix.
      const cap = collector.render(`§11 Supplier ${n} capability`, s.capabilityEvidence);
      collector.render(`§11 Supplier ${n} award evidence`, s.relevantAwardEvidence);
      const conf = collector.render(`§11 Supplier ${n} resolution confidence`, s.resolutionConfidence);
      const confMark =
        conf.state === 'value' ? conf.text
        : conf.state === 'unknown' || conf.state === 'degraded' ? UNKNOWN_MARK
        : conf.text;

      // Compact vendor cell: one line name + UEI (no multi-line award dump — that overflowed pages).
      const vendorCell = `${name.text} [${confMark}] · ${legal.text} · UEI ${uei.text}`;
      const sizeCell = `${concise(size)}${socio.state === 'value' ? ` · ${socio.text}` : ''}`;
      const capText = cap.state === 'value'
        ? compactCapability(cap.text)
        : concise(cap);

      bodyRows.push(tableRow(
        [
          tableCell(vendorCell, WIDTHS[0]),
          tableCell(concise(cage), WIDTHS[1]),
          tableCell(sizeCell, WIDTHS[2]),
          tableCell(concise(loc), WIDTHS[3]),
          tableCell(concise(poc), WIDTHS[4]),
          tableCell(capText, WIDTHS[5]),
        ],
        { cantSplit: true },
      ));
    });
  }

  blocks[tblIdx] = setTableWidths(rebuildTable(original, [header, ...bodyRows]), WIDTHS);

  const raw = collector.render('§11 Raw matching UEI total (source-reported)', s11.rawUeiCount);
  const evaluated = collector.render('§11 Evaluated UEI count (returned sample)', s11.evaluatedUeiCount);
  const toolLim = collector.render('§11 Tool limit', s11.toolLimit);
  const dedup = collector.render(
    '§11 Resolved families in evaluated sample (not full-population dedup)',
    s11.deduplicatedFamilyCount,
  );
  const ambiguous = collector.render(
    '§11 Ambiguous/unresolved parents in evaluated sample',
    s11.ambiguousParentCount,
  );
  const coverage = collector.render('§11 Sample coverage', s11.sampleCoverage, (v) =>
    typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : String(v),
  );
  const eligiblePop = collector.render('§11 Eligible population (tool-reported)', s11.eligiblePopulation);
  const efforts = collector.render('§11 Efforts to locate sources', s11.effortsToLocate);

  const truncated =
    (s11.evaluatedUeiCount.state === 'value' &&
      s11.rawUeiCount.state === 'value' &&
      s11.evaluatedUeiCount.value < s11.rawUeiCount.value) ||
    (s11.sampleCoverage.state === 'value' && s11.sampleCoverage.value < 1);

  const after: string[] = [
    paragraph(
      '¹ Missing CAGE, business size, socioeconomic designation, location, or POC is Unknown — ' +
      'not empty, not false, and not zero. Parent-company resolution is current-state USASpending ' +
      'parent_uei only; ambiguous parentage cannot satisfy Rule of Two.',
    ),
    paragraph(
      `Tool-reported matching/eligible population: ${raw.text}. ` +
      `Tool limit: ${toolLim.text}. ` +
      `UEIs returned and evaluated for corporate-family resolution: ${evaluated.text}. ` +
      `Resolved corporate families in that evaluated sample: ${dedup.text}. ` +
      `Ambiguous/unresolved parents in that evaluated sample: ${ambiguous.text}. ` +
      (truncated
        ? 'The resolved-family count is NOT a deduplication of the full matching population, ' +
          'and this evaluated sample is not the complete market.'
        : 'Family counts above describe the evaluated set only.'),
    ),
    paragraph(
      `Sample coverage: ${coverage.text}. Eligible population (when reported by the depth tool): ${eligiblePop.text}.`,
    ),
    paragraph(
      s11.suppliers.length > 25
        ? `Vendor table shows the top 25 of ${s11.suppliers.length} resolved supplier rows by capability score.`
        : `Vendor table rows: ${s11.suppliers.length}.`,
    ),
    paragraph(`Efforts to locate sources: ${efforts.text}`),
  ];
  if (s11.limitations.length) {
    after.push(paragraph(`§11 limitations: ${s11.limitations.join(' | ')}`));
  }
  blocks.splice(tblIdx + 1, 0, ...after);
}

/** Empty-table finding: reuse efforts text without double-rendering the efforts label. */
function unknownAsFinding(s11: Section11): Section11['effortsToLocate'] {
  if (s11.effortsToLocate.state === 'value') {
    return {
      state: 'value',
      value: `No supplier rows to display. ${s11.effortsToLocate.value}`,
      evidence: s11.effortsToLocate.evidence,
    };
  }
  return s11.effortsToLocate;
}

/** Keep §11 capability cells to a single short line so rows fit on one printable page. */
function compactCapability(text: string): string {
  const tier = /tier=([a-z_]+)/i.exec(text)?.[1];
  const awards = /awards?=(\d+)/i.exec(text)?.[1];
  if (tier && awards) return `tier=${tier}; awards=${awards}`;
  if (tier) return `tier=${tier}`;
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 48 ? `${one.slice(0, 45)}…` : one;
}

function fillSection9(
  blocks: string[],
  parts: ReturnType<typeof readDocxParts>,
  collector: EvidenceCollector,
  s9: Section9,
): void {
  const s9Anchor = findAnchorIndex(blocks, '9. Procurement History');
  const tblIdx = findTableIndexAfter(blocks, s9Anchor);
  const original = blocks[tblIdx];
  // Rebuild header with non-wrapping short labels for the narrow Method/Offerors columns.
  const WIDTHS = [2400, 900, 1100, 900, 1960, 2100];
  const header = tableRow(
    [
      tableCell('Contract Number', WIDTHS[0], { bold: true }),
      tableCell('Type', WIDTHS[1], { bold: true }),
      tableCell('Method', WIDTHS[2], { bold: true }),
      tableCell('Offers', WIDTHS[3], { bold: true }),
      tableCell('Amount', WIDTHS[4], { bold: true }),
      tableCell('Period of Performance', WIDTHS[5], { bold: true }),
    ],
    { header: true, cantSplit: true },
  );

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

  const linkUrls = s9.awards.map((a) => a.usaSpendingUrl).filter((u): u is string => !!u);
  const linkIds = linkUrls.length ? addHyperlinks(parts, linkUrls) : [];
  let linkCursor = 0;

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
  blocks[tblIdx] = setTableWidths(rebuildTable(original, [header, ...bodyRows]), WIDTHS);
  if (scopeBanner.length) blocks.splice(tblIdx, 0, ...scopeBanner);

  const findingCell = s9.awards.length ? collector.render('§9 Award history finding', s9.awardsFinding) : null;
  const pred = collector.render('§9 Predecessor / incumbent', s9.predecessor);
  const after: string[] = [];
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
}

function fillSection5(blocks: string[], collector: EvidenceCollector, s5: Section5): void {
  const s5Anchor = findAnchorIndex(blocks, '5. Taxonomy');
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
}

function fillSection1(blocks: string[], req: Requirement, generatedAt: string): void {
  const a1 = findAnchorIndex(blocks, '1. Product/Equipment/Service/Program');
  const id: string[] = [
    paragraph(`${req.title} — ${req.agency}${req.sub_agency ? ` (${req.sub_agency})` : ''}`),
  ];
  if (req.solicitation_number) id.push(paragraph(`Solicitation number: ${req.solicitation_number}`));
  if (req.notice_id) id.push(paragraph(`SAM notice ID: ${req.notice_id}`));
  id.push(paragraph(`Report generated: ${generatedAt}`));
  blocks.splice(a1 + 1, 1, ...id);
}
