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
      if (!['P', 'BR', 'STRONG', 'EM', 'CODE', 'UL', 'OL', 'LI', 'A', 'DIV'].includes(el.tagName)) bad.push(`tag ${el.tagName}`);
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
