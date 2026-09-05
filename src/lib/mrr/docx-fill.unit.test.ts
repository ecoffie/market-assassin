/**
 * Block 3 (fake-data spike) done-test + the template contract.
 *
 *  - the template hash is what we vendored;
 *  - every required anchor resolves, uniquely;
 *  - a fill round-trip preserves EVERY other OOXML part and relationship byte-for-byte;
 *  - the synthetic value appears exactly once, in the right section;
 *  - the SOURCE template is byte-identical afterwards.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { unzipSync } from 'fflate';
import {
  TEMPLATE_PATH, TEMPLATE_SHA256, PROTOTYPE_BANNER,
  sha256File, assertTemplateUnchanged, readDocxParts, getDocumentXml, writeDocx,
  splitBlocks, blockText, findAnchorIndex, findTableIndexAfter, rebuildDocumentXml,
  paragraph, tableRows,
} from './docx-fill';

const OUT = 'out/mrr/__spike__';

describe('docx template contract', () => {
  it('the vendored template matches the expected SHA-256', () => {
    expect(sha256File(TEMPLATE_PATH)).toBe(TEMPLATE_SHA256);
    expect(() => assertTemplateUnchanged()).not.toThrow();
  });

  it('has NO Word content controls, confirming anchor-based fill is required', () => {
    const xml = getDocumentXml(readDocxParts());
    expect((xml.match(/<w:sdt>/g) ?? []).length).toBe(0);
  });

  it('resolves every required anchor uniquely', () => {
    const blocks = splitBlocks(getDocumentXml(readDocxParts()));
    for (const anchor of [
      '1. Product/Equipment/Service/Program',
      '5. Taxonomy',
      '9. Procurement History',
      '11. Potential Supplier Information',
      '12. Small Business Opportunities',
      '15. Market Intelligence / Industry Analysis',
    ]) {
      const i = findAnchorIndex(blocks, anchor);
      expect(i).toBeGreaterThan(0);
      expect(blockText(blocks[i]).startsWith(anchor)).toBe(true);
    }
  });

  it('locates the §11 vendor table with expected header columns', () => {
    const blocks = splitBlocks(getDocumentXml(readDocxParts()));
    const t = findTableIndexAfter(blocks, findAnchorIndex(blocks, '11. Potential Supplier Information'));
    expect(t).toBeGreaterThan(0);
    const header = tableRows(blocks[t])[0];
    for (const col of ['Vendor Name', 'CAGE Code', 'Business Size', 'Location', 'Point of Contact', 'Capability Assessment']) {
      expect(header).toContain(col);
    }
  });

  it('throws on a missing or ambiguous anchor rather than silently no-op', () => {
    const blocks = splitBlocks(getDocumentXml(readDocxParts()));
    expect(() => findAnchorIndex(blocks, '99. Does Not Exist')).toThrow(/anchor not found/);
  });

  it('locates the §9 procurement-history table with its 6 expected columns', () => {
    const blocks = splitBlocks(getDocumentXml(readDocxParts()));
    const t = findTableIndexAfter(blocks, findAnchorIndex(blocks, '9. Procurement History'));
    const rows = tableRows(blocks[t]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const header = blockText(rows[0]);
    for (const col of ['Contract Number', 'Contract Type', 'Procurement Method', 'Offerors', 'Amount', 'Period of Performance']) {
      expect(header).toContain(col);
    }
  });
});

describe('docx fill round-trip (Block 3 spike)', () => {
  it('preserves every untouched part, injects the value once, and leaves the source unchanged', () => {
    mkdirSync(OUT, { recursive: true });
    const before = sha256File(TEMPLATE_PATH);
    const parts = readDocxParts();
    const originalNames = Object.keys(parts).sort();

    // Replace exactly one known placeholder region: a synthetic line under §5.
    const xml = getDocumentXml(parts);
    const blocks = splitBlocks(xml);
    const i = findAnchorIndex(blocks, '5. Taxonomy');
    const SYNTHETIC = 'SYNTHETIC-SPIKE-VALUE-42';
    blocks.splice(i + 1, 0, paragraph(SYNTHETIC));

    const outPath = `${OUT}/spike.docx`;
    writeDocx(parts, rebuildDocumentXml(xml, blocks), outPath);

    // 1. every part survived, none added or dropped
    const outParts = unzipSync(readFileSync(outPath));
    expect(Object.keys(outParts).sort()).toEqual(originalNames);

    // 2. every part EXCEPT document.xml is byte-identical
    for (const name of originalNames) {
      if (name === 'word/document.xml') continue;
      expect(Buffer.from(outParts[name]).equals(Buffer.from(parts[name]))).toBe(true);
    }

    // 3. the synthetic value appears exactly once, after the §5 anchor
    const outXml = new TextDecoder().decode(outParts['word/document.xml']);
    expect((outXml.match(new RegExp(SYNTHETIC, 'g')) ?? []).length).toBe(1);
    const outBlocks = splitBlocks(outXml);
    const anchorIdx = findAnchorIndex(outBlocks, '5. Taxonomy');
    expect(blockText(outBlocks[anchorIdx + 1])).toBe(SYNTHETIC);

    // 4. the output is a valid, non-trivial ZIP archive
    expect(readFileSync(outPath).length).toBeGreaterThan(5000);

    // 5. THE SOURCE TEMPLATE IS UNTOUCHED
    expect(sha256File(TEMPLATE_PATH)).toBe(before);
    expect(() => assertTemplateUnchanged()).not.toThrow();

    rmSync(OUT, { recursive: true, force: true });
  });

  it('exports the prototype banner required for every generated document', () => {
    expect(PROTOTYPE_BANNER).toBe('PROTOTYPE — NOT FOR SIGNATURE');
  });
});
