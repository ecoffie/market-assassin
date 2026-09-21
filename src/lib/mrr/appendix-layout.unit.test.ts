/**
 * Appendix pagination structure — asserts the LibreOffice merge/overflow class
 * against emitted OOXML. A later LibreOffice physical-page render is still
 * required; these tests catch adjacent-table merge, orphan caption/header packs,
 * and truncated evidence before that render.
 *
 * Failures this file exists to catch:
 *   - §11 Efforts stored in a page-taller table row
 *   - a cantSplit body row whose value exceeds the declared safe budget
 *   - continuation tables that drop Field/State/Source/Retrieved headers
 *   - tables wider than the US Letter printable body
 *   - chunking that drops characters
 *   - a page-group split that separates a field label from its value/source/time
 */
import { describe, expect, it } from 'vitest';
import { Packer } from 'docx';
import { unzipSync } from 'fflate';
import type { RenderedCell } from './grounding';
import type { EvidenceRef } from './types';
import {
  APPENDIX_FIELD_COL_WIDTHS,
  APPENDIX_FIELD_HEADERS,
  APPENDIX_PAGE_TABLE_BUDGET_TWIP,
  APPENDIX_SAFE_CONTENT_CHARS,
  APPENDIX_SAFE_ROW_HEIGHT_TWIP,
  APPENDIX_TABLE_WIDTH_DXA,
  buildAppendixDoc,
  chunkEvidenceText,
  estimateTableChunkHeightTwip,
  expandRenderedField,
  groupRowsToPageTables,
  isEffortsToLocateLabel,
  type AppendixInput,
} from './appendix';

const FIELD_HEADER_TEXT = APPENDIX_FIELD_HEADERS.join('');

function xmlFromDoc(buf: Uint8Array): string {
  return new TextDecoder().decode(unzipSync(buf)['word/document.xml']);
}

function decode(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function tables(xml: string): string[] {
  return xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
}

function rows(tableXml: string): string[] {
  return tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
}

function cells(rowXml: string): string[] {
  return rowXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
}

function text(x: string): string {
  return (x.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
    .map((t) => t.replace(/<[^>]+>/g, ''))
    .join('');
}

function cellTexts(rowXml: string): string[] {
  return cells(rowXml).map(text);
}

function fieldTables(xml: string): string[] {
  return tables(xml).filter((t) => {
    const header = rows(t).find((row) => text(row).replace(/\s/g, '') === FIELD_HEADER_TEXT.replace(/\s/g, ''));
    return Boolean(header);
  });
}

function captionAndHeader(tableXml: string): { caption: string; header: string[] } {
  const all = rows(tableXml);
  return {
    caption: text(all[0] ?? ''),
    header: cellTexts(all[1] ?? ''),
  };
}

function bodyRows(tableXml: string): string[] {
  return rows(tableXml).slice(2);
}

function cell(label: string, textValue: string, retrievedAt = '2026-09-06T10:00:46.798Z'): RenderedCell {
  const ref: EvidenceRef = {
    source: 'fixture source',
    retrievedAt,
    query: { label },
  };
  return {
    label,
    text: textValue,
    state: 'value',
    evidence: [ref],
  };
}

function input(cells: RenderedCell[], extras: Partial<AppendixInput> = {}): AppendixInput {
  return {
    requirementTitle: 'Fixture requirement',
    solicitationNumber: 'DHA_JOMIS_JMP_20260813',
    generatedAt: '2026-09-06T10:00:07.675Z',
    runId: 'liFDkpTQBTWa4_xbKOkPkw',
    cells,
    calls: extras.calls ?? [],
    limitations: extras.limitations ?? ['fixture limitation'],
    ...extras,
  };
}

async function render(cells: RenderedCell[], extras: Partial<AppendixInput> = {}) {
  const buf = await Packer.toBuffer(buildAppendixDoc(input(cells, extras)));
  return { buf, xml: xmlFromDoc(new Uint8Array(buf)) };
}

describe('appendix layout helpers', () => {
  it('chunkEvidenceText is lossless and never exceeds the budget', () => {
    const raw = `${'alpha '.repeat(80)}TOKEN_WITHOUT_SPACES_${'x'.repeat(200)} tail`;
    const chunks = chunkEvidenceText(raw, 40);
    expect(chunks.join('')).toBe(raw);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(40);
  });

  it('expandRenderedField keeps Field/State/Source/Retrieved on every continuation', () => {
    const long = `START ${'evidence-body '.repeat(80)} END`;
    const rows = expandRenderedField(cell('§9 Award 20 recipient', long));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((r) => r.value).join('')).toBe(long);
    for (const [i, row] of rows.entries()) {
      expect(row.label.startsWith('§9 Award 20 recipient')).toBe(true);
      if (i > 0) expect(row.label).toContain('(continued)');
      expect(row.state).toBe('Sourced value');
      expect(row.source).toBe('fixture source');
      expect(row.retrievedAt).toBe('2026-09-06T10:00:46.798Z');
      expect(row.value.length).toBeLessThanOrEqual(APPENDIX_SAFE_CONTENT_CHARS);
    }
  });

  it('page-group boundaries never split a field label from its value/source/time', () => {
    const rows = [
      ...expandRenderedField(cell('§9 Award 1 contract number', `A1 ${'n'.repeat(APPENDIX_SAFE_CONTENT_CHARS + 40)}`)),
      ...expandRenderedField(cell('§9 Award 1 recipient', 'SHORT')),
    ];
    const groups = groupRowsToPageTables(rows, () => 400, 400, 900);
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      for (const row of group) {
        expect(row.label).toBeTruthy();
        expect(row.state).toBeTruthy();
        expect(row.source).toBeTruthy();
        expect(row.retrievedAt).toBeTruthy();
        expect(row.value.length).toBeGreaterThan(0);
      }
    }
    const awardRows = groups.flat().filter((r) => r.label.startsWith('§9 Award 1 contract number'));
    expect(awardRows.map((r) => r.value).join('')).toContain('A1');
  });
});

describe('appendix OOXML pagination', () => {
  it('does not store §11 Efforts in a page-taller table row', async () => {
    const efforts = `assess_market_depth payload ${'matching UEIs '.repeat(60)} bounded sample returned=50`;
    const { xml } = await render([
      cell('§9 Award 1 contract number', '47QFCA24F0009'),
      cell('§11 Efforts to locate sources', efforts),
      cell('§9 Award 20 recipient', 'GENERAL DYNAMICS INFORMATION TECHNOLOGY, INC.'),
    ]);
    expect(isEffortsToLocateLabel('§11 Efforts to locate sources')).toBe(true);
    expect(decode(xml)).toContain(efforts);

    for (const table of fieldTables(xml)) {
      for (const row of bodyRows(table)) {
        const [field, , value] = cellTexts(row);
        expect(field).not.toMatch(/efforts to locate sources/i);
        expect(value).not.toContain('assess_market_depth payload');
      }
    }
    const outsideTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
    expect(text(outsideTables)).toContain('§11 Efforts to locate sources');
  });

  it('no generated evidence row exceeds the declared safe content budget', async () => {
    const long = `START ${'body '.repeat(200)} END`;
    const { xml } = await render([
      cell('§9 Award 20 amount', long),
      cell('§5 Primary NAICS', '541512'),
    ]);
    for (const table of fieldTables(xml)) {
      for (const row of bodyRows(table)) {
        const value = cellTexts(row)[2] ?? '';
        expect(value.length, value.slice(0, 40)).toBeLessThanOrEqual(APPENDIX_SAFE_CONTENT_CHARS);
        expect(value.length).toBeGreaterThan(0);
      }
    }
    expect(APPENDIX_SAFE_ROW_HEIGHT_TWIP).toBeGreaterThan(APPENDIX_SAFE_CONTENT_CHARS);
  });

  it('continuation tables repeat all five headers', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 80; i++) {
      cells.push(cell(`§11 Supplier ${i + 1} UEI`, `UEI${String(i).padStart(4, '0')}`));
    }
    const { xml } = await render(cells);
    const ft = fieldTables(xml);
    expect(ft.length).toBeGreaterThan(1);
    for (const table of ft) {
      const { caption, header } = captionAndHeader(table);
      expect(caption).toMatch(/Rendered fields group/);
      expect(header).toEqual([...APPENDIX_FIELD_HEADERS]);
      expect(rows(table)[0]).toContain('<w:tblHeader/>');
      expect(rows(table)[1]).toContain('<w:tblHeader/>');
      expect(rows(table)[0]).toContain('w:gridSpan');
    }
  });

  it('all tables remain inside US Letter printable width', async () => {
    const { xml } = await render([
      cell('§5 Primary NAICS', '541512'),
      cell('§11 Efforts to locate sources', 'short efforts'),
    ], {
      calls: [{
        tool: 'assess_market_depth',
        args: { naics: '541512', limit: 50 },
        ok: true,
        evidence: { source: 'Mindy MCP assess_market_depth', retrievedAt: '2026-09-06T10:00:46.798Z', query: { naics: '541512' } },
      }],
    });
    const pg = /<w:pgSz\b[^>]*>/.exec(xml)?.[0] ?? '';
    expect(pg).toContain('12240');
    expect(pg).toContain('15840');
    for (const [i, table] of tables(xml).entries()) {
      const tblW = /<w:tblW [^>]*w:w="(\d+)"/.exec(table);
      expect(Number(tblW?.[1]), `table ${i} width`).toBe(APPENDIX_TABLE_WIDTH_DXA);
      const grid = /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.exec(table);
      expect(grid, `table ${i} missing tblGrid`).toBeTruthy();
      const gridWidths = [...grid![0].matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
      expect(gridWidths.reduce((a, b) => a + b, 0), `table ${i} grid`).toBe(APPENDIX_TABLE_WIDTH_DXA);
      for (const [ri, row] of rows(table).entries()) {
        const tc = [...row.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"/g)].map((m) => Number(m[1]));
        expect(tc.reduce((a, b) => a + b, 0), `table ${i} row ${ri}`).toBe(APPENDIX_TABLE_WIDTH_DXA);
      }
    }
    expect(APPENDIX_FIELD_COL_WIDTHS.reduce((a, b) => a + b, 0)).toBe(APPENDIX_TABLE_WIDTH_DXA);
  });

  it('does not lose evidence values during chunking', async () => {
    const long = `BEGIN_${'chunk-me '.repeat(90)}_END_MARKER`;
    const { xml } = await render([cell('§9 Award 20 recipient', long)]);
    expect(decode(xml)).toContain('BEGIN_');
    expect(decode(xml)).toContain('_END_MARKER');
    const pieces: string[] = [];
    for (const table of fieldTables(xml)) {
      for (const row of bodyRows(table)) {
        const [field, , value] = cellTexts(row);
        if (field.startsWith('§9 Award 20 recipient')) pieces.push(value);
      }
    }
    expect(pieces.join('')).toBe(long);
  });

  it('never emits a field row that has a value without its label/source/time', async () => {
    const long = `Award20 ${'x'.repeat(APPENDIX_SAFE_CONTENT_CHARS + 80)}`;
    const { xml } = await render([
      cell('§9 Award 20 contract number', long, '2026-09-06T10:00:11.000Z'),
      cell('§9 Award 20 recipient', 'GENERAL DYNAMICS INFORMATION TECHNOLOGY, INC.', '2026-09-06T10:00:11.000Z'),
    ]);
    for (const table of fieldTables(xml)) {
      for (const row of bodyRows(table)) {
        const [field, state, value, source, retrieved] = cellTexts(row);
        expect(field.length).toBeGreaterThan(0);
        expect(state.length).toBeGreaterThan(0);
        expect(value.length).toBeGreaterThan(0);
        expect(source.length).toBeGreaterThan(0);
        expect(retrieved.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses cantSplit on every body row so a pack cannot split across pages', async () => {
    const { xml } = await render([
      cell('§5 Primary NAICS', '541512'),
      cell('§11 Efforts to locate sources', `long ${'effort '.repeat(100)}`),
    ]);
    for (const table of fieldTables(xml)) {
      for (const row of bodyRows(table)) {
        expect(row).toContain('<w:cantSplit/>');
        const value = cellTexts(row)[2] ?? '';
        expect(value.length).toBeLessThanOrEqual(APPENDIX_SAFE_CONTENT_CHARS);
      }
    }
  });

  it('preserves run identity and retrieval timestamps', async () => {
    const { xml } = await render(
      [cell('§5 Primary NAICS', '541512', '2026-09-06T10:00:46.798Z')],
    );
    expect(decode(xml)).toContain('liFDkpTQBTWa4_xbKOkPkw');
    expect(decode(xml)).toContain('2026-09-06T10:00:07.675Z');
    expect(decode(xml)).toContain('2026-09-06T10:00:46.798Z');
  });

  it('starts every field table after a document-level page-break paragraph', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 80; i++) {
      cells.push(cell(`§11 Supplier ${i + 1} UEI`, `UEI${String(i).padStart(4, '0')}`));
    }
    const { xml } = await render(cells);
    const ft = fieldTables(xml);
    expect(ft.length).toBeGreaterThan(1);
    for (const table of ft) {
      const at = xml.indexOf(table);
      expect(at).toBeGreaterThan(0);
      const before = xml.slice(Math.max(0, at - 400), at);
      expect(before).toMatch(/<w:br\b[^>]*w:type="page"/);
      expect(rows(table)[0]).not.toMatch(/<w:pageBreakBefore\/>/);
      expect(captionAndHeader(table).caption.length).toBeGreaterThan(0);
    }
  });

  it('keeps every field-table chunk inside the conservative page-height budget', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 80; i++) {
      cells.push(cell(
        `§11 Supplier ${i + 1} canonical name and resolution notes`,
        `${'evidence-body '.repeat(12)}UEI${String(i).padStart(4, '0')}`,
      ));
    }
    const { xml } = await render(cells);
    const ft = fieldTables(xml);
    expect(ft.length).toBeGreaterThan(1);
    for (const table of ft) {
      const { caption } = captionAndHeader(table);
      const body = bodyRows(table).map((row) => cellTexts(row));
      const height = estimateTableChunkHeightTwip(
        caption,
        APPENDIX_FIELD_HEADERS,
        APPENDIX_FIELD_COL_WIDTHS,
        body,
      );
      expect(height, caption).toBeLessThanOrEqual(APPENDIX_PAGE_TABLE_BUDGET_TWIP);
      expect(caption).toMatch(/Rendered fields group/);
      expect(captionAndHeader(table).header).toEqual([...APPENDIX_FIELD_HEADERS]);
    }
  });

  it('never emits a caption paragraph outside its table', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 40; i++) {
      cells.push(cell(`§11 Supplier ${i + 1} UEI`, `UEI${String(i).padStart(4, '0')}`));
    }
    const { xml } = await render(cells);
    const outside = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
    expect(text(outside)).not.toMatch(/Rendered fields group/);
    for (const table of fieldTables(xml)) {
      expect(text(rows(table)[0] ?? '')).toMatch(/Rendered fields group/);
      expect(rows(table)[0]).toContain('<w:tblHeader/>');
      expect(rows(table)[1]).toContain('<w:tblHeader/>');
    }
  });

  it('keeps the Queries heading and introduction with the following table', async () => {
    const { xml } = await render(
      [cell('§5 Primary NAICS', '541512')],
      {
        calls: [{
          tool: 'assess_market_depth',
          args: { naics: '541512', limit: 50 },
          ok: true,
          evidence: { source: 'Mindy MCP assess_market_depth', retrievedAt: '2026-09-06T10:00:46.798Z', query: { naics: '541512' } },
        }],
      },
    );
    const headingAt = xml.indexOf('2. Queries executed');
    expect(headingAt).toBeGreaterThan(0);
    const afterHeading = xml.slice(headingAt);
    const tableAt = afterHeading.indexOf('<w:tbl>');
    expect(tableAt).toBeGreaterThan(0);
    const between = afterHeading.slice(0, tableAt);
    expect(between).not.toMatch(/<w:pageBreakBefore\/>/);
    expect(between).not.toMatch(/<w:br\b[^>]*w:type="page"/);
    expect(between).toContain('Every Mindy tool call');
    expect(between).toContain('<w:keepNext');
    const firstQueryTable = afterHeading.slice(tableAt);
    const captionRow = (firstQueryTable.match(/<w:tr\b[\s\S]*?<\/w:tr>/) ?? [])[0] ?? '';
    expect(captionRow).toContain('Queries executed');
    expect(captionRow).not.toMatch(/<w:pageBreakBefore\/>/);
  });

  it('gives every page-pack caption, column header, and at least one body row', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 80; i++) {
      cells.push(cell(`§11 Supplier ${i + 1} UEI`, `UEI${String(i).padStart(4, '0')}`));
    }
    const { xml } = await render(cells);
    const ft = fieldTables(xml);
    expect(ft.length).toBeGreaterThan(1);
    for (const table of ft) {
      expect(rows(table).length).toBeGreaterThanOrEqual(3);
      const { caption, header } = captionAndHeader(table);
      expect(caption).toMatch(/^Rendered fields group \d+( \(\d+ of \d+\))?$/);
      expect(header).toEqual([...APPENDIX_FIELD_HEADERS]);
      expect(bodyRows(table).length).toBeGreaterThan(0);
      expect(rows(table)[0]).toContain('<w:tblHeader/>');
      expect(rows(table)[1]).toContain('<w:tblHeader/>');
    }
  });

  it('separates page-pack tables so LibreOffice cannot merge them', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 80; i++) {
      cells.push(cell(`§11 Supplier ${i + 1} UEI`, `UEI${String(i).padStart(4, '0')}`));
    }
    const { xml } = await render(cells, {
      calls: [{
        tool: 'assess_market_depth',
        args: { naics: '541512' },
        ok: true,
        evidence: { source: 'Mindy MCP assess_market_depth', retrievedAt: '2026-09-06T10:00:46.798Z', query: {} },
      }],
    });
    expect(xml).not.toMatch(/<\/w:tbl>\s*<w:tbl>/);
    const ft = fieldTables(xml);
    for (let i = 1; i < ft.length; i++) {
      const between = xml.slice(xml.indexOf(ft[i - 1]!) + ft[i - 1]!.length, xml.indexOf(ft[i]!));
      expect(between, `gap before pack ${i + 1}`).toMatch(/<w:br\b[^>]*w:type="page"/);
      expect(between).toMatch(/<w:p[\s>]/);
    }
  });

  it('numbers captions monotonically from the actual page packs', async () => {
    const cells: RenderedCell[] = [];
    for (let i = 0; i < 40; i++) {
      cells.push(cell(`§11 Supplier ${i + 1} UEI`, `UEI${String(i).padStart(4, '0')}`));
    }
    cells.push(cell('§11 Efforts to locate sources', `efforts ${'payload '.repeat(40)}`));
    for (let i = 0; i < 20; i++) {
      cells.push(cell(`§12 Family ${i + 1} name`, `FIRM ${i}`));
    }
    const { xml } = await render(cells);
    const captions = fieldTables(xml).map((table) => captionAndHeader(table).caption);
    const grouped = new Map<number, { parts: number[]; total: number }>();
    for (const caption of captions) {
      const numbered = /^Rendered fields group (\d+) \((\d+) of (\d+)\)$/.exec(caption);
      const single = /^Rendered fields group (\d+)$/.exec(caption);
      expect(numbered || single, caption).toBeTruthy();
      const group = Number((numbered ?? single)![1]);
      const part = numbered ? Number(numbered[2]) : 1;
      const total = numbered ? Number(numbered[3]) : 1;
      const entry = grouped.get(group) ?? { parts: [], total };
      entry.parts.push(part);
      entry.total = total;
      grouped.set(group, entry);
      expect(part).toBeGreaterThan(0);
      expect(part).toBeLessThanOrEqual(total);
    }
    expect(grouped.size).toBeGreaterThanOrEqual(2);
    for (const [group, { parts, total }] of grouped) {
      expect(parts.length, `group ${group} pack count`).toBe(total);
      const sorted = [...parts].sort((a, b) => a - b);
      expect(sorted, `group ${group}`).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      expect(new Set(parts).size).toBe(parts.length);
    }
  });
});
