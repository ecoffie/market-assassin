/**
 * Document engine: model validation (incl. FACTS MUST CITE), shared formatting, both renderers,
 * the never-silent PDF degrade, extraction, and the module boundary.
 *
 * Hermetic: no network, no database, no browser. Chromium is stubbed; the real-browser render is
 * exercised by scripts/documents/render-fixture.ts and on the preview deployment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const pdfState = vi.hoisted(() => ({ result: { pdf: null as Buffer | null, error: 'no browser' as string | null }, calls: [] as Array<{ html: string; opts: Record<string, unknown> }> }));
vi.mock('@/lib/pdf/launch-browser', () => ({
  htmlToPdf: async (html: string, opts: Record<string, unknown>) => { pdfState.calls.push({ html, opts }); return pdfState.result; },
}));

import { SAMPLE_REPORT } from './__fixtures__/sample-report';
import { DOC_SCHEMA, type DocModel } from './model';
import { validateDocModel, demoteUncitedFacts } from './validate';
import { citationIndex, citeMarker, formatCell, parseInline, NOT_AVAILABLE, fileBaseName } from './format';
import { renderHtml } from './render-html';
import { renderDocx } from './render-docx';
import { renderPdf, pdfOptions } from './render-pdf';
import { renderDocument } from './index';
import { chartToSvg } from './charts';
import { inferKind, extractByKind, extractDocx } from './extract';

const clone = (): DocModel => JSON.parse(JSON.stringify(SAMPLE_REPORT));
const tiny = (over: Partial<DocModel> = {}): DocModel => ({
  schema: DOC_SCHEMA,
  title: 'Tiny',
  date: '2026-11-17',
  sources: [{ id: 's1', kind: 'web', label: 'Source one', url: 'https://example.com/a' }],
  sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'Hello', claim: 'fact', cites: ['s1'] }] }],
  ...over,
});
const issuesOf = (m: unknown) => { const r = validateDocModel(m); return r.ok ? [] : r.issues.map((i) => i.message); };

beforeEach(() => { pdfState.calls = []; pdfState.result = { pdf: null, error: 'no browser' }; });

describe('validateDocModel', () => {
  it('accepts the fixture report', () => {
    expect(issuesOf(SAMPLE_REPORT)).toEqual([]);
  });

  it('FACTS MUST CITE: an uncited fact is rejected', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'Spend was $5M.', claim: 'fact' }] }] });
    expect(issuesOf(m).join(' ')).toMatch(/a fact must cite at least one source/);
  });

  it('FACTS MUST CITE: a fact citing only an unknown source is rejected', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'fact', cites: ['nope'] }] }] });
    const msgs = issuesOf(m).join(' ');
    expect(msgs).toMatch(/unknown source\(s\) nope/);
    expect(msgs).toMatch(/a fact must cite/);
  });

  it('FACTS MUST CITE: applies to each bullet, table, chart and callout', () => {
    const m = tiny({
      sections: [{
        id: 'a', heading: 'A', blocks: [
          { type: 'bullets', id: 'b', items: [{ text: 'ok', claim: 'fact', cites: ['s1'] }, { text: 'bad', claim: 'fact' }] },
          { type: 'table', id: 't', claim: 'fact', columns: [{ key: 'k', label: 'K' }], rows: [{ k: 1 }] },
          { type: 'chart', id: 'c', kind: 'bar', claim: 'fact', series: [{ name: 'n', points: [{ x: 'a', y: 1 }] }] },
          { type: 'callout', id: 'co', tone: 'note', text: 't', claim: 'fact' },
        ],
      }],
    });
    const msgs = issuesOf(m);
    expect(msgs.filter((x) => /a fact must cite/.test(x))).toHaveLength(4);
    expect(msgs.join(' ')).toMatch(/b\[1\]/);
  });

  it('assumptions, recommendations, unverified and context need no citation', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Likely', claim: 'assumption' },
      { type: 'paragraph', id: 'p2', text: 'Do this', claim: 'recommendation' },
      { type: 'paragraph', id: 'p3', text: 'Untraced', claim: 'unverified' },
      { type: 'paragraph', id: 'p4', text: 'This section covers buyers.', claim: 'context' },
    ] }] });
    expect(issuesOf(m)).toEqual([]);
  });

  it('M1: an UNLABELED block or bullet item is rejected (it used to skip facts-must-cite)', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Spend was $5M.' },
      { type: 'bullets', id: 'b', items: [{ text: 'ok', claim: 'fact', cites: ['s1'] }, { text: 'Awarded to Acme.' }] },
      { type: 'table', id: 't', columns: [{ key: 'k', label: 'K' }], rows: [{ k: 1 }] },
    ] }] });
    const msgs = issuesOf(m).filter((x) => /a claim label is required/.test(x));
    expect(msgs).toHaveLength(3);
    expect(msgs.join(' ')).toMatch(/b\[1\]/);
  });

  it('M2: there is no "estimate" label', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'estimate' as never }] }] });
    expect(issuesOf(m).join(' ')).toMatch(/unknown claim "estimate".*no estimate label/);
  });

  it('context may not carry a number, a table or a chart (a figure is a claim)', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p', text: 'The market is $2B.', claim: 'context' },
      { type: 'table', id: 't', claim: 'context', columns: [{ key: 'k', label: 'K' }], rows: [] },
    ] }] });
    expect(issuesOf(m).filter((x) => /context may not contain/.test(x))).toHaveLength(2);
  });

  it('rejects structural problems', () => {
    expect(issuesOf({})).not.toEqual([]);
    expect(issuesOf(tiny({ schema: 'other' as never })).join(' ')).toMatch(/mindy\.doc\/1/);
    expect(issuesOf(tiny({ date: '11/17/2026' })).join(' ')).toMatch(/YYYY-MM-DD/);
    expect(issuesOf(tiny({ sections: [] })).join(' ')).toMatch(/at least one section/);
    const dup = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'a', text: 'x', claim: 'context' }] }] });
    expect(issuesOf(dup).join(' ')).toMatch(/duplicate id "a"/);
    const badType = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'script', id: 'x' } as never] }] });
    expect(issuesOf(badType).join(' ')).toMatch(/unknown block type/);
  });

  it('table values must be declared, finite or null; missing is null, never NaN', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'table', id: 't', columns: [{ key: 'k', label: 'K' }], rows: [{ k: Number.NaN }, { other: 'x' }] }] }] });
    const msgs = issuesOf(m).join(' ');
    expect(msgs).toMatch(/finite number or null/);
    expect(msgs).toMatch(/not a declared column/);
  });

  it('a pie chart has exactly one series and no negative values', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'chart', id: 'c', kind: 'pie', series: [{ name: 'a', points: [{ x: 'x', y: -1 }] }, { name: 'b', points: [{ x: 'x', y: 1 }] }] }] }] });
    const msgs = issuesOf(m).join(' ');
    expect(msgs).toMatch(/exactly one series/);
    expect(msgs).toMatch(/cannot be negative/);
  });

  it('source urls must be http(s)', () => {
    expect(issuesOf(tiny({ sources: [{ id: 's1', kind: 'web', label: 'x', url: 'javascript:alert(1)' }] })).join(' ')).toMatch(/http\(s\) URL/);
  });

  it('demoteUncitedFacts: non-critical → "unverified" (text kept); never relabels as estimate or assumption', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Uncited', claim: 'fact' },
      { type: 'bullets', id: 'b', items: [{ text: 'cited', claim: 'fact', cites: ['s1'] }, { text: 'bad', claim: 'fact', cites: ['zzz'] }] },
    ] }] });
    const { model, unverified, omitted } = demoteUncitedFacts(m);
    expect(unverified).toEqual(['p1', 'b[1]']);
    expect(omitted).toEqual([]);
    expect(issuesOf(model)).toEqual(['cites unknown source(s) zzz at b[1]']);
    const p1 = model.sections[0].blocks[0];
    expect(p1.type === 'paragraph' && p1.claim).toBe('unverified');
    expect(p1.type === 'paragraph' && p1.text).toBe('Uncited');
    expect(JSON.stringify(model)).not.toMatch(/estimate|assumption/);
  });

  it('demoteUncitedFacts: a decision-critical uncited statement is OMITTED, not labeled', () => {
    const m = tiny({ sections: [{ id: 'a', heading: 'A', blocks: [
      { type: 'paragraph', id: 'p1', text: 'Proposals are due 12 Dec.', claim: 'fact', critical: true },
      { type: 'paragraph', id: 'p2', text: 'Cited and critical', claim: 'fact', critical: true, cites: ['s1'] },
      { type: 'bullets', id: 'b', items: [{ text: 'Ceiling is $40M', claim: 'fact', critical: true }] },
      { type: 'paragraph', id: 'p3', text: 'Unlabeled, uncited' },
    ] }] });
    const { model, unverified, omitted } = demoteUncitedFacts(m);
    expect(omitted).toEqual(['p1', 'b[0]']);
    expect(unverified).toEqual(['p3']);
    const ids = model.sections[0].blocks.map((b) => b.id);
    expect(ids).toEqual(['p2', 'p3']); // all-omitted bullets block removed
    expect(JSON.stringify(model)).not.toMatch(/12 Dec|\$40M/);
    expect(issuesOf(model)).toEqual([]);
  });
});

describe('format helpers', () => {
  it('a missing value is "Not available", never 0', () => {
    expect(formatCell(null, 'usd')).toBe(NOT_AVAILABLE);
    expect(formatCell('', 'int')).toBe(NOT_AVAILABLE);
    expect(formatCell(0, 'usd')).toBe('$0');
  });
  it('formats money, integers and percentages', () => {
    expect(formatCell(412_500_000, 'usd')).toBe('$412.5M');
    expect(formatCell(1_930_000_000, 'usd')).toBe('$1.93B');
    expect(formatCell(12_345, 'int')).toBe('12,345');
    expect(formatCell(0.214, 'pct')).toBe('21.4%');
  });
  it('parses only **bold** and _italic_', () => {
    expect(parseInline('a **b** _c_ snake_case')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' snake_case' }]);
  });
  it('numbers sources by first citation; uncited sources follow', () => {
    const { ordered, numberOf } = citationIndex(SAMPLE_REPORT);
    expect(ordered.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(citeMarker(['s3', 's1', 's1'], numberOf)).toBe('[1, 3]');
    expect(citeMarker(['missing'], numberOf)).toBe('');
  });
  it('file names are filesystem-safe', () => {
    expect(fileBaseName('A/B: "report" <2026>')).toBe('A-B-report-2026');
    expect(fileBaseName('///')).toBe('Mindy-document');
  });
});

describe('render-html', () => {
  it('escapes every model string; a model is data, never markup', () => {
    const m = tiny({ title: '<script>alert(1)</script>', sections: [{ id: 'a', heading: '<img src=x onerror=1>', blocks: [{ type: 'paragraph', id: 'p', text: '**<b>x</b>**', claim: 'assumption' }] }] });
    const html = renderHtml(m);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('makes no network requests: no external scripts, stylesheets, fonts or images', () => {
    const html = renderHtml(SAMPLE_REPORT);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it('shows labels, citations, Not available and a numbered Sources section', () => {
    const html = renderHtml(SAMPLE_REPORT);
    expect(html).toContain('class="label assumption">ASSUMPTION</span>');
    expect(html).not.toMatch(/Estimate/);
    expect(html).toContain('class="label recommendation">Recommendation</span>');
    expect(html).toContain('<sup class="cite">[1]</sup>');
    expect(html).toContain(NOT_AVAILABLE);
    expect(html).toMatch(/<h2>Sources<\/h2><ol><li>Example award data extract/);
    expect(html).toContain('<h2>Contents</h2>');
    expect((html.match(/<svg /g) || []).length).toBe(4);
  });
});

describe('charts', () => {
  it('draws bar, line and pie as standalone SVG with escaped labels', () => {
    for (const kind of ['bar', 'line', 'pie'] as const) {
      const svg = chartToSvg({ type: 'chart', id: 'c', kind, caption: 'A & <B>', series: [{ name: 'S', points: [{ x: 'x<1>', y: 3 }, { x: 'y', y: 5 }] }] });
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toContain('<1>');
      expect(svg).toContain('aria-label="A &amp; &lt;B&gt;"');
    }
  });
});

describe('chart axis titles', () => {
  const chart = (kind: 'bar' | 'line') => ({ type: 'chart' as const, id: 'c', kind, claim: 'fact' as const, cites: ['s1'], xLabel: 'Department', yLabel: 'Obligations ($M)', series: [{ name: 'FY26', points: [{ x: 'VA', y: 3 }, { x: 'Army', y: 2 }] }] });
  it('bar and line SVGs render both axis titles', () => {
    for (const k of ['bar', 'line'] as const) {
      const svg = chartToSvg(chart(k));
      expect(svg, k).toContain('>Department</text>');
      expect(svg, k).toContain('>Obligations ($M)</text>');
    }
  });
  it('DOCX chart data table uses the axis titles as column headers', async () => {
    const files = unzipSync(new Uint8Array(await renderDocx(tiny({ sections: [{ id: 'a', heading: 'A', blocks: [chart('bar')] }] }))));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('Department');
    expect(doc).toContain('FY26 (Obligations ($M))');
  });
});

describe('unverified statements', () => {
  const m = () => tiny({ sections: [{ id: 'a', heading: 'Buyers', blocks: [
    { type: 'paragraph', id: 'p1', text: 'VA buys the most.', claim: 'unverified' },
    { type: 'paragraph', id: 'p2', text: 'Cited.', claim: 'fact', cites: ['s1'] },
  ] }] });
  it('HTML: labeled inline and listed in an "Unverified statements" section before Sources', () => {
    const html = renderHtml(m());
    expect(html).toContain('class="label unverified">Unverified — no source</span>');
    expect(html).toMatch(/<h2>Unverified statements<\/h2>[\s\S]*Buyers:<\/span> VA buys the most\.[\s\S]*<h2>Sources<\/h2>/);
  });
  it('HTML: no section when nothing is unverified', () => {
    expect(renderHtml(tiny())).not.toContain('Unverified statements');
  });
  it('DOCX: labeled inline and listed', async () => {
    const files = unzipSync(new Uint8Array(await renderDocx(m())));
    const doc = strFromU8(files['word/document.xml']);
    expect(doc).toContain('UNVERIFIED — NO SOURCE');
    expect(doc).toContain('Unverified statements');
    expect(doc).toContain('Buyers: ');
  });
});

describe('render-docx', () => {
  it('styles.xml has NO duplicate styleIds (Title/Heading1-3 customize the built-ins)', async () => {
    const files = unzipSync(new Uint8Array(await renderDocx(SAMPLE_REPORT)));
    const xml = strFromU8(files['word/styles.xml']);
    const ids = [...xml.matchAll(/w:styleId="([^"]+)"/g)].map((x) => x[1]);
    expect(ids.length - new Set(ids).size).toBe(0);
    const h1 = xml.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(h1).toContain('1E3A8A');
  });

  it('produces a valid DOCX with styles, header/footer page numbers, repeating table headers and citations', async () => {
    const buf = await renderDocx(SAMPLE_REPORT);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const files = unzipSync(new Uint8Array(buf));
    const doc = strFromU8(files['word/document.xml']);
    const footer = Object.keys(files).filter((k) => /^word\/footer\d*\.xml$/.test(k)).map((k) => strFromU8(files[k])).join('');
    const header = Object.keys(files).filter((k) => /^word\/header\d*\.xml$/.test(k)).map((k) => strFromU8(files[k])).join('');
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
    expect(header).toContain('Prepared with Mindy');
    expect(doc).toContain('w:tblHeader');
    expect(doc).toContain('w:val="Heading1"');
    expect(doc).toContain('ASSUMPTION');
    expect(doc).not.toContain('ESTIMATE');
    expect(doc).toContain('RECOMMENDATION');
    expect(doc).toContain(NOT_AVAILABLE);
    expect(doc).toContain('Chart data.');
  });

  it('round-trips through the shared extractor (same pipeline as uploads)', async () => {
    const buf = await renderDocx(SAMPLE_REPORT);
    const { text } = await extractDocx(buf);
    expect(text).toContain('Federal Janitorial Services Market');
    expect(text).toContain('Sources');
    expect(text).toContain('[1]');
    expect(text).toContain('Department of Veterans Affairs');
  });
});

describe('render-pdf', () => {
  it('asks Chromium for Letter with a header and a "Page X of Y" footer', () => {
    const o = pdfOptions(SAMPLE_REPORT);
    expect(o.format).toBe('Letter');
    expect(o.displayHeaderFooter).toBe(true);
    expect(String(o.footerTemplate)).toContain('class="pageNumber"');
    expect(String(o.footerTemplate)).toContain('class="totalPages"');
    expect(String(pdfOptions(tiny({ title: '<b>' })).headerTemplate)).toContain('&lt;b&gt;');
  });

  it('returns the PDF when the browser renders', async () => {
    pdfState.result = { pdf: Buffer.from('%PDF-1.7 test'), error: null };
    const r = await renderPdf(SAMPLE_REPORT);
    expect(r.pdf?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.error).toBeNull();
    expect(pdfState.calls[0].html).toContain('<h2>Executive summary</h2>');
  });

  it('never silent: no browser → null PDF, the reason, and the printable HTML', async () => {
    pdfState.result = { pdf: null, error: 'Error: Could not find Chrome' };
    const r = await renderPdf(SAMPLE_REPORT);
    expect(r.pdf).toBeNull();
    expect(r.error).toBe('Error: Could not find Chrome');
    expect(r.html).toContain('<!doctype html>');
  });
});

describe('renderDocument', () => {
  it('refuses an invalid model with its issues', async () => {
    const r = await renderDocument({ schema: DOC_SCHEMA }, 'pdf');
    expect(r.ok).toBe(false);
    expect(pdfState.calls).toHaveLength(0);
  });

  it('DOCX: bytes, mime and a safe filename', async () => {
    const r = await renderDocument(SAMPLE_REPORT, 'docx');
    expect(r.ok && r.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(r.ok && r.filename).toBe('Federal-Janitorial-Services-Market-Research-Report-Fixture.docx');
  });

  it('PDF degrade is explicit: format html + degraded reason', async () => {
    pdfState.result = { pdf: null, error: 'boom' };
    const r = await renderDocument(clone(), 'pdf');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.format).toBe('html');
    expect(r.degraded).toEqual({ requested: 'pdf', reason: 'boom' });
    expect(r.mime).toMatch(/^text\/html/);
  });
});

describe('extract (moved from proposal/upload, unchanged)', () => {
  it('infers kind from MIME or extension', () => {
    expect(inferKind('a.PDF', '')).toBe('pdf');
    expect(inferKind('x', 'application/pdf')).toBe('pdf');
    expect(inferKind('a.docx', '')).toBe('docx');
    expect(inferKind('a.xls', '')).toBe('xlsx');
    expect(inferKind('a.xlsx', '')).toBe('xlsx');
    expect(inferKind('a.txt', '')).toBe('txt');
    expect(inferKind('a.csv', 'text/csv')).toBeNull();
    expect(inferKind('a.exe', 'application/octet-stream')).toBeNull();
  });
  it('reads text files as UTF-8', async () => {
    expect((await extractByKind('txt', Buffer.from('héllo'))).text).toBe('héllo');
  });
});

describe('module boundary', () => {
  it('the engine imports no Proposal AI, gov-buyer or MRR business logic', () => {
    const dir = __dirname;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.endsWith('.unit.test.ts')) files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // Static `from`, side-effect `import '…'`, dynamic `import('…')` and `require('…')` alike.
      const forbidden = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:@\/lib\/|\.\.\/)(proposal|gov-buyer|mrr)\//;
      expect(src, f).not.toMatch(forbidden);
    }
  });

  it('the boundary pattern catches side-effect, dynamic and require imports (self-test)', () => {
    const forbidden = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:@\/lib\/|\.\.\/)(proposal|gov-buyer|mrr)\//;
    for (const bad of [
      "import x from '@/lib/proposal/v2';",
      "import '@/lib/proposal/side-effect';",
      "const m = await import('@/lib/mrr/assemble');",
      "const g = require('../gov-buyer/x');",
    ]) expect(bad).toMatch(forbidden);
    expect("import { x } from '@/lib/pdf/launch-browser';").not.toMatch(forbidden);
  });

  it('transitively write-free: no engine module (or the PDF launcher) writes to a database, bucket or KV', () => {
    const files: string[] = [join(process.cwd(), 'src/lib/pdf/launch-browser.ts')];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.includes('.test.')) files.push(p);
      }
    };
    walk(__dirname);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/supabase|@vercel\/kv|\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.storage\b|writeFile|appendFile/);
    }
  });
});
