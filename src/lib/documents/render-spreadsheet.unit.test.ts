import { describe, it, expect } from 'vitest';
import { DOC_SCHEMA, type DocModel } from './model';
import {
  csvEscape,
  modelHasTables,
  renderCsv,
  renderXlsx,
  safeSheetName,
  sheetsFromDocModel,
  sheetsToCsv,
} from './render-spreadsheet';

function model(over: Partial<DocModel> = {}): DocModel {
  return {
    schema: DOC_SCHEMA,
    title: 'Agency Strategy',
    date: '2026-11-18',
    theme: 'mindy',
    sources: [{ id: 's1', kind: 'tool', label: 'Market scan' }],
    sections: [{
      id: 'a',
      heading: 'Buyers',
      blocks: [{
        type: 'table',
        id: 't1',
        claim: 'fact',
        cites: ['s1'],
        caption: 'Top agencies',
        columns: [
          { key: 'agency', label: 'Agency' },
          { key: 'dollars', label: 'Obligations', format: 'usd' },
        ],
        rows: [
          { agency: 'VA', dollars: 1_500_000 },
          { agency: 'DHS', dollars: 900_000 },
        ],
      }],
    }],
    ...over,
  } as DocModel;
}

describe('render-spreadsheet', () => {
  it('names sheets safely and uniquely', () => {
    const used = new Set<string>();
    expect(safeSheetName('Top agencies', used)).toBe('Top agencies');
    expect(safeSheetName('Top agencies', used)).toBe('Top agencies (2)');
    expect(safeSheetName('a/b*c?', used)).toBe('a b c');
  });

  it('builds a sheet from table blocks with formatted cells', () => {
    const sheets = sheetsFromDocModel(model());
    expect(modelHasTables(model())).toBe(true);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Top agencies');
    expect(sheets[0].headers).toEqual(['Agency', 'Obligations']);
    expect(sheets[0].rows[0][0]).toBe('VA');
    expect(sheets[0].rows[0][1]).toMatch(/\$/);
  });

  it('falls back to a Summary sheet when there are no tables', () => {
    const m = model({
      sections: [{
        id: 'a',
        heading: 'Approach',
        blocks: [{ type: 'paragraph', id: 'p1', text: 'Lead with VA facilities.', claim: 'recommendation' }],
      }],
    });
    expect(modelHasTables(m)).toBe(false);
    const sheets = sheetsFromDocModel(m);
    expect(sheets[0].name).toBe('Summary');
    expect(sheets[0].rows[0]).toEqual(['Approach', 'Lead with VA facilities.']);
  });

  it('escapes CSV and renders xlsx bytes', async () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('=CMD()')).toBe("'=CMD()");
    expect(csvEscape('+cmd')).toBe("'+cmd");
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvEscape('-5')).toBe('-5');
    expect(csvEscape('-$5')).toBe('-$5');
    expect(csvEscape('-$1.5M')).toBe('-$1.5M');
    expect(csvEscape('-1+1')).toBe("'-1+1");
    expect(csvEscape("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvEscape("-$1+cmd|' /C calc'!A0")).toBe("'-$1+cmd|' /C calc'!A0");
    expect(csvEscape('=HYPERLINK("http://x")')).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    const csv = sheetsToCsv(sheetsFromDocModel(model()));
    expect(csv).toMatch(/Agency,Obligations/);
    expect(csv).toMatch(/VA,/);
    const xlsx = await renderXlsx(model());
    expect(xlsx.length).toBeGreaterThan(100);
    // xlsx zip signature
    expect(xlsx[0]).toBe(0x50);
    expect(xlsx[1]).toBe(0x4b);
    const csvBuf = renderCsv(model());
    expect(csvBuf.toString('utf-8')).toMatch(/Agency/);
  });
});
