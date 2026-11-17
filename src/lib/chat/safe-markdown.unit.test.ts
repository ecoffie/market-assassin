import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderSafeMarkdown, SAFE_MARKDOWN_SCRIPT } from './safe-markdown';

const md = renderSafeMarkdown;

describe('renderSafeMarkdown: formatting', () => {
  it('the 2026-11-15 production answer renders instead of showing raw markdown', () => {
    const answer = '### Open opportunities\n\nHere are **two** open janitorial solicitations:\n\n- **USCG Sector Key West** — due Nov 20\n- Recruiting Station — due Nov 22\n\n[View the solicitation on SAM.gov](https://sam.gov/workspace/contract/opp/4b6c32fbb0b146d29d4315cc8c49a4e9/view)';
    const html = md(answer);
    expect(html).toContain('<div class="md-h md-h3">Open opportunities</div>');
    expect(html).toContain('<strong>two</strong>');
    expect(html).toContain('<ul><li><strong>USCG Sector Key West</strong> — due Nov 20</li><li>Recruiting Station — due Nov 22</li></ul>');
    expect(html).toContain('<a href="https://sam.gov/workspace/contract/opp/4b6c32fbb0b146d29d4315cc8c49a4e9/view" target="_blank" rel="noopener noreferrer">View the solicitation on SAM.gov</a>');
    expect(html).not.toMatch(/\*\*|###|\]\(/);
  });
  it('numbered lists, italics, code and paragraphs', () => {
    expect(md('1. First\n2) Second')).toBe('<ol><li>First</li><li>Second</li></ol>');
    expect(md('an *important* note and _this_ too')).toBe('<p>an <em>important</em> note and <em>this</em> too</p>');
    expect(md('use `NAICS 561720`')).toBe('<p>use <code>NAICS 561720</code></p>');
    expect(md('line one\nline two\n\nnew para')).toBe('<p>line one<br>line two</p><p>new para</p>');
    expect(md('• bullet')).toBe('<ul><li>bullet</li></ul>');
  });
  it('a bare URL becomes a link showing its host, with trailing punctuation kept outside', () => {
    expect(md('See https://www.sam.gov/opp/abc_def/view.')).toBe('<p>See <a href="https://www.sam.gov/opp/abc_def/view" target="_blank" rel="noopener noreferrer">sam.gov</a>.</p>');
  });
  it('underscores and asterisks inside URLs are not treated as emphasis', () => {
    const html = md('[doc](https://x.gov/a_b_c*d*) and https://y.gov/p_q_r');
    expect(html).toContain('href="https://x.gov/a_b_c*d*"');
    expect(html).toContain('href="https://y.gov/p_q_r"');
    expect(html).not.toContain('<em>');
  });
  it('an unclosed marker mid-stream stays as text (re-rendered when the rest arrives)', () => {
    expect(md('Here are **tw')).toBe('<p>Here are **tw</p>');
    expect(md('Here are **two**')).toBe('<p>Here are <strong>two</strong></p>');
  });
  it('empty and nullish input', () => {
    expect(md('')).toBe('');
    expect(md(null as unknown as string)).toBe('');
  });
});

describe('renderSafeMarkdown: XSS', () => {
  const dangerous = (html: string) => {
    const dom = new JSDOM(`<!doctype html><body><div id="b">${html}</div></body>`);
    const b = dom.window.document.getElementById('b')!;
    const bad: string[] = [];
    b.querySelectorAll('*').forEach((el) => {
      if (!['P', 'BR', 'STRONG', 'EM', 'CODE', 'UL', 'OL', 'LI', 'A', 'DIV', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'].includes(el.tagName)) bad.push(`tag ${el.tagName}`);
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) bad.push(`attr ${attr.name}`);
        if (attr.name === 'href' && !/^https?:\/\//i.test(attr.value)) bad.push(`href ${attr.value}`);
        if (!['href', 'target', 'rel', 'class'].includes(attr.name)) bad.push(`attr ${attr.name}`);
      }
    });
    return bad;
  };
  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['svg onload', '<svg onload=alert(1)>'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['javascript: link', '[click me](javascript:alert(1))'],
    ['JAVASCRIPT: link mixed case', '[x](JaVaScRiPt:alert(document.cookie))'],
    ['data: link', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
    ['vbscript: link', '[x](vbscript:msgbox(1))'],
    ['attribute injection via link URL', '[x](https://ok.gov/" onmouseover="alert(1))'],
    ['attribute injection via quote in URL', '[x](https://ok.gov/a"onclick="alert(1)")'],
    ['attribute injection via bare URL', 'https://ok.gov/"><script>alert(1)</script>'],
    ['link text with markup', '[<img src=x onerror=alert(1)>](https://ok.gov)'],
    ['markup inside bold', '**<b onclick=alert(1)>x</b>**'],
    ['markup in heading', '# <script>alert(1)</script>'],
    ['markup in list', '- <a href="javascript:alert(1)">x</a>'],
    ['entity smuggling', '[x](&#106;avascript:alert(1))'],
    ['placeholder smuggling', 'a\u00000\u0000b [x](https://ok.gov)'],
    ['backtick break-out', '`</code><script>alert(1)</script>`'],
    ['table cell script', '| a | b |\n|---|---|\n| <script>alert(1)</script> | <img src=x onerror=alert(1)> |'],
    ['table cell javascript: link', '| a |\n|---|\n| [x](javascript:alert(1)) |'],
    ['table header markup', '| <svg onload=alert(1)> | b |\n|---|---|\n| 1 | 2 |'],
    ['table cell attribute injection', '| [x](https://ok.gov/" onclick="alert(1)) |\n|---|\n| y |'],
    ['table closing-tag break-out', '| </td></tr></table><script>alert(1)</script> |\n|---|\n| y |'],
  ])('%s produces no executable markup', (_n, payload) => {
    const html = md(payload);
    expect(dangerous(html)).toEqual([]);
    // Raw tags or a dangerous href would be markup; the same words escaped as visible text are harmless.
    expect(html).not.toMatch(/<script|<img|<svg|<iframe|href="(?!https?:\/\/)/i);
  });
  it('escaped markup is still visible to the reader as text', () => {
    expect(md('<b>hi</b>')).toBe('<p>&lt;b&gt;hi&lt;/b&gt;</p>');
  });
});

describe('SAFE_MARKDOWN_SCRIPT (the browser copy the map page ships)', () => {
  it('defines window.__mindyMd that produces identical output', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const code = SAFE_MARKDOWN_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');
    dom.window.eval(code);
    const browserMd = (dom.window as unknown as { __mindyMd: (s: string) => string }).__mindyMd;
    for (const s of ['### H\n- **a** [x](https://sam.gov/x)', '<script>alert(1)</script>', '[x](javascript:alert(1))']) {
      expect(browserMd(s)).toBe(md(s));
    }
  });
});

describe('renderSafeMarkdown: GFM tables', () => {
  it('a recompete table renders with a header and body rows; cells keep inline formatting and links', () => {
    const t = 'Coming back:\n\n| Holder | Value | Ends | Notice |\n|---|---:|:---:|---|\n| **Acme Facility** | $1.2M | 2027-03-31 | [SAM](https://sam.gov/opp/1/view) |\n| Beta LLC | $400K | 2027-06-30 | \u2014 |\n\nafter';
    const html = md(t);
    expect(html).toBe('<p>Coming back:</p><div class="md-table"><table><thead><tr><th>Holder</th><th>Value</th><th>Ends</th><th>Notice</th></tr></thead><tbody>'
      + '<tr><td><strong>Acme Facility</strong></td><td>$1.2M</td><td>2027-03-31</td><td><a href="https://sam.gov/opp/1/view" target="_blank" rel="noopener noreferrer">SAM</a></td></tr>'
      + '<tr><td>Beta LLC</td><td>$400K</td><td>2027-06-30</td><td>\u2014</td></tr></tbody></table></div><p>after</p>');
  });
  it('rows without outer pipes, and short rows padded to the header width', () => {
    expect(md('A | B\n--- | ---\n1 | 2\n| 3 |')).toBe('<div class="md-table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td></td></tr></tbody></table></div>');
    // A line with no pipe at all ends the table (it is prose, not a row).
    expect(md('| A |\n|---|\n| 1 |\nplain line')).toBe('<div class="md-table"><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div><p>plain line</p>');
  });
  it('a header with no body rows still renders the header', () => {
    expect(md('| A | B |\n|---|---|')).toBe('<div class="md-table"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody></tbody></table></div>');
  });
  it('a line with a pipe but no separator row is prose, not a table', () => {
    expect(md('Open now | Coming back | Coming soon')).toBe('<p>Open now | Coming back | Coming soon</p>');
  });
  it('extra cells beyond the header are dropped (column count = header)', () => {
    expect(md('| A |\n|---|\n| 1 | 2 | 3 |')).toBe('<div class="md-table"><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>');
  });
  it('a table followed by a list keeps both', () => {
    const html = md('| A |\n|---|\n| 1 |\n\n- next');
    expect(html).toContain('</table></div><ul><li>next</li></ul>');
  });
  it('the browser copy renders tables identically', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    dom.window.eval(SAFE_MARKDOWN_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, ''));
    const browserMd = (dom.window as unknown as { __mindyMd: (s: string) => string }).__mindyMd;
    const t = '| Holder | Value |\n|---|---|\n| **Acme** | $1M |';
    expect(browserMd(t)).toBe(md(t));
  });
});

describe('renderSafeMarkdown: lists keep their numbering (2026-11-16 "1., 1., 1." bug)', () => {
  it('indented sub-bullets nest inside the numbered item instead of restarting the list', () => {
    const html = md('1. **Alpha**\n   - due Nov 20\n   - Navy\n2. **Beta**\n   - due Nov 22\n3. Gamma');
    expect(html).toBe('<ol><li><strong>Alpha</strong><ul><li>due Nov 20</li><li>Navy</li></ul></li><li><strong>Beta</strong><ul><li>due Nov 22</li></ul></li><li>Gamma</li></ol>');
    expect(html.match(/<ol/g)).toHaveLength(1);
  });
  it('blank lines between numbered items keep one list', () => {
    expect(md('1. One\n\n2. Two\n\n\n3. Three')).toBe('<ol><li>One</li><li>Two</li><li>Three</li></ol>');
  });
  it('blank lines between bullets keep one list', () => {
    expect(md('- a\n\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });
  it('a list that resumes after a paragraph keeps its number', () => {
    expect(md('1. One\n\nSome text\n\n2. Two')).toBe('<ol><li>One</li></ol><p>Some text</p><ol start="2"><li>Two</li></ol>');
  });
  it('a blank line then a paragraph still ends the list', () => {
    expect(md('1. One\n\nAfter')).toBe('<ol><li>One</li></ol><p>After</p>');
  });
  it('an unindented bullet after a numbered list starts a new list', () => {
    expect(md('1. One\n- loose')).toBe('<ol><li>One</li></ol><ul><li>loose</li></ul>');
  });
  it('an indented continuation line stays in its item', () => {
    expect(md('1. One\n   more about one\n2. Two')).toBe('<ol><li>One<br>more about one</li><li>Two</li></ol>');
  });
  it('nested items are still escaped', () => {
    expect(md('1. x\n   - <script>alert(1)</script>')).toBe('<ol><li>x<ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul></li></ol>');
  });
});
