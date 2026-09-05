/**
 * Word-LAYOUT regression tests.
 *
 * These exist because a LibreOffice render exposed defects that every other check
 * had passed: the §9 table had no repeating header and no `cantSplit`, so pages 4-7
 * each opened on the torn remains of the previous page's award; the appendix was A4
 * rather than US Letter; and it truncated three values with an ellipsis while
 * claiming to preserve exact rendered values.
 *
 * A green build and a parsed DOCX proved none of that. Structure is asserted here
 * directly against the emitted OOXML.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync } from 'fflate';
import { readFileSync, existsSync } from 'node:fs';

const MRR = 'out/mrr/MRR-DHA_JOMIS_JMP_20260813.docx';
const APPENDIX = 'out/mrr/MRR-DHA_JOMIS_JMP_20260813-appendix.docx';
const EVIDENCE = 'out/mrr/MRR-DHA_JOMIS_JMP_20260813-evidence.json';

/** These assert the GENERATED artifacts; run `npx tsx scripts/mrr-run.mts` first. */
const artifactsPresent = existsSync(MRR) && existsSync(APPENDIX);
const d = artifactsPresent ? describe : describe.skip;

function documentXml(path: string): string {
  const parts = unzipSync(readFileSync(path));
  return new TextDecoder().decode(parts['word/document.xml']);
}
function tables(xml: string): string[] {
  return xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
}
function rows(tableXml: string): string[] {
  return tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
}
function text(x: string): string {
  return (x.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
}

d('§9 table — Word pagination structure', () => {
  let s9: string;
  beforeAll(() => {
    const xml = documentXml(MRR);
    const t = tables(xml).find((x) => text(rows(x)[0]).includes('Contract Number'));
    expect(t, '§9 procurement-history table not found').toBeTruthy();
    s9 = t!;
  });

  it('marks the header row as a REPEATING Word table header', () => {
    const header = rows(s9)[0];
    expect(header).toContain('<w:tblHeader/>');
  });

  it('sets cantSplit on EVERY body row so an award never spans a page break', () => {
    const body = rows(s9).slice(1);
    expect(body.length).toBeGreaterThan(1);
    for (const [i, r] of body.entries()) {
      expect(r, `body row ${i + 1} may split across pages`).toContain('<w:cantSplit/>');
    }
  });

  it('uses the concise Unknown marker in-row, not the full sentence repeated 50 times', () => {
    const body = rows(s9).slice(1).join('');
    expect(body).toContain('Unknown¹');
    expect(body).not.toContain('the source did not report a procurement method');
    expect(body).not.toContain('the source did not report the number of offerors');
  });

  it('states the full Unknown explanation exactly once, below the table', () => {
    const xml = documentXml(MRR);
    const footnote = 'The source did not report the procurement method or number of offerors. Unknown is not treated as zero.';
    const body = xml.replace(/<[^>]+>/g, '');
    expect(body.split(footnote).length - 1, 'footnote must appear exactly once').toBe(1);
    expect(body.indexOf(footnote)).toBeGreaterThan(body.indexOf('Contract Number'));
  });

  it('replaces raw USASpending URLs with a compact labelled hyperlink', () => {
    expect(text(s9)).toContain('USASpending source');
    expect(text(s9)).not.toContain('https://www.usaspending.gov/award/');
    // every hyperlink must resolve to a real relationship, or Word calls the file corrupt
    const ids = [...s9.matchAll(/<w:hyperlink r:id="(rId\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    const rels = new TextDecoder().decode(unzipSync(readFileSync(MRR))['word/_rels/document.xml.rels']);
    for (const id of ids) {
      expect(rels, `${id} has no relationship`).toContain(`Id="${id}"`);
      expect(rels).toContain('TargetMode="External"');
    }
  });

  it('applies the SAME six column widths to tblGrid AND every row tcW', () => {
    // A table states its widths in three places and the GRID wins. Setting only the
    // body cells' tcW left the grid at 1000 twips for Amount, and LibreOffice split
    // "$1,205,937,998" into "$1,205,93" + "7,998". All three must agree.
    const EXPECTED = ['2400', '900', '1100', '900', '1960', '2100'];
    const grid = /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.exec(s9);
    expect(grid, 'table has no <w:tblGrid>').toBeTruthy();
    expect([...grid![0].matchAll(/w:w="(\d+)"/g)].map((m) => m[1])).toEqual(EXPECTED);
    for (const [i, r] of rows(s9).entries()) {
      const w = [...r.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"/g)].map((m) => m[1]);
      expect(w, `row ${i} tcW disagrees with the grid`).toEqual(EXPECTED);
    }
    expect(EXPECTED.reduce((a, b) => a + Number(b), 0)).toBe(9360);
  });

  it('renders the currency figure in its own non-hyphenating paragraph', () => {
    const amountCells = (s9.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).filter((c) => /\$[\d,]+/.test(text(c)));
    expect(amountCells.length).toBe(25);
    for (const c of amountCells) {
      expect(c, 'figure must be isolated from its label').toContain('<w:suppressAutoHyphens/>');
      // exactly one <w:t> holds the whole figure — no split runs
      const figureRun = (c.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])[0];
      expect(figureRun).toMatch(/\$[\d,]+$|\$[\d,]+<\/w:t>/);
    }
  });

  it('every currency token in the document is complete and unbroken', () => {
    // A split figure shows up as a short fragment; a complete one always ends in a
    // 3-digit group. This catches the "$1,205,93" + "7,998" failure directly.
    const body = documentXml(MRR).replace(/<[^>]+>/g, '');
    const tokens = body.match(/\$[\d,]+/g) ?? [];
    expect(tokens.length).toBeGreaterThan(20);
    for (const t of tokens) {
      if (!t.includes(',')) continue;
      expect(t, `truncated currency token: ${t}`).toMatch(/^\$\d{1,3}(,\d{3})+$/);
    }
  });

  it('keeps the amount label with its figure so the source meaning is not lost', () => {
    // The figure and its label are now SEPARATE paragraphs in one cell (the figure must
    // not wrap; the label may). Both must still be present — an amount without its
    // "obligated / current / ceiling / lifetime" label is an ambiguous number.
    const amountCells = (s9.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).filter((c) => /\$[\d,]+/.test(text(c)));
    expect(amountCells.length).toBe(25);
    for (const c of amountCells) {
      const t = text(c);
      expect(t).toMatch(/^\$[\d,]+/);
      expect(t).toContain('award lifetime total to date');
    }
  });
});

d('appendix — Word pagination + page geometry', () => {
  it('uses US LETTER page geometry, not A4', () => {
    const xml = documentXml(APPENDIX);
    const m = /<w:pgSz\b[^>]*w:w="(\d+)"[^>]*w:h="(\d+)"/.exec(xml) ?? /<w:pgSz\b[^>]*w:h="(\d+)"[^>]*w:w="(\d+)"/.exec(xml);
    expect(m, 'no <w:pgSz> found').toBeTruthy();
    const nums = [Number(m![1]), Number(m![2])].sort((a, b) => a - b);
    // US Letter = 8.5in x 11in = 12240 x 15840 twips. A4 would be 11906 x 16838.
    expect(nums).toEqual([12240, 15840]);
  });

  it('marks every table header row as repeating', () => {
    for (const [i, t] of tables(documentXml(APPENDIX)).entries()) {
      expect(rows(t)[0], `appendix table ${i + 1} header does not repeat`).toContain('<w:tblHeader/>');
    }
  });

  it('sets cantSplit on every body row of every table', () => {
    for (const [ti, t] of tables(documentXml(APPENDIX)).entries()) {
      for (const [ri, r] of rows(t).slice(1).entries()) {
        expect(r, `appendix table ${ti + 1} row ${ri + 1} may split`).toContain('<w:cantSplit/>');
      }
    }
  });

  it('preserves EXACT rendered values — no ellipsis truncation anywhere', () => {
    const body = documentXml(APPENDIX).replace(/<[^>]+>/g, '');
    expect(body).not.toContain('…');
    expect(body).not.toMatch(/\.\.\.\s*<\/w:t>/);
  });

  it('no GENERATED value in the MRR is elided either (template boilerplate excepted)', () => {
    // Ralph's template itself contains two ellipses inside the DFARS/RFA approval-page
    // boilerplate ("...for [title]. … I hereby determine"). Those are HIS words and must
    // not be edited. Everything WE write must be complete — notably the §5 coverage set,
    // which previously printed only the first 8 of 20 codes followed by ", …".
    const body = documentXml(MRR).replace(/<[^>]+>/g, '');
    const ours = body.split('\u2026').filter((_, i, arr) => i < arr.length - 1);
    for (const seg of ours) {
      const tail = seg.slice(-140);
      expect(tail, `unexpected elision near: ${tail}`).toMatch(/for \[title\]\.\s*$|price analysis\s*$/);
    }
    expect(body).toContain('Coverage set (20 code(s)):');
    expect(body).not.toMatch(/Coverage set[^.]*, \u2026/);
  });

  it('the appendix value matches the evidence bundle verbatim (not a shortened copy)', () => {
    const bundle = JSON.parse(readFileSync(EVIDENCE, 'utf8')) as { cells: Array<{ text: string }> };
    const body = documentXml(APPENDIX).replace(/<[^>]+>/g, '');
    const longest = bundle.cells.map((c) => c.text).sort((a, b) => b.length - a.length)[0];
    expect(longest.length).toBeGreaterThan(120);
    // the FULL value must be present, character for character
    const decoded = body.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    expect(decoded).toContain(longest);
  });
});
