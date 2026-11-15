/**
 * /app Ask Mindy panel: assistant answers render through the shared SAFE markdown renderer; user text and
 * errors stay plain text (2026-11-15: raw **, ###, - and [text](url) showed literally on both surfaces).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../authHeaders', () => ({ authedFetch: vi.fn() }));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import { renderMessageContent } from './MindyChatPanel';

const html = (content: string, md: boolean) => renderToStaticMarkup(<>{renderMessageContent(content, md)}</>);

describe('MindyChatPanel renderMessageContent', () => {
  it('an assistant answer renders headings, bold, bullets and a link showing its text', () => {
    const out = html('### Results\n\n- **USCG Key West** due Nov 20\n\n[View on SAM.gov](https://sam.gov/opp/abc/view)', true);
    expect(out).toContain('<div class="md-h md-h3">Results</div>');
    expect(out).toContain('<ul><li><strong>USCG Key West</strong> due Nov 20</li></ul>');
    expect(out).toContain('<a href="https://sam.gov/opp/abc/view" target="_blank" rel="noopener noreferrer">View on SAM.gov</a>');
    expect(out).not.toMatch(/\*\*|###|\]\(/);
    expect(out).toMatch(/overflow-wrap:anywhere/);
  });
  it('model markup and javascript: links are escaped, never executable', () => {
    const out = html('<script>alert(1)</script><img src=x onerror=alert(1)> [x](javascript:alert(1))', true);
    expect(out).not.toMatch(/<script|<img|href="javascript/i);
    expect(out).toContain('&lt;script&gt;');
  });
  it('user messages and errors stay plain text (no markdown, no HTML)', () => {
    const out = html('**not bold** <b>x</b>', false);
    expect(out).toContain('**not bold** &lt;b&gt;x&lt;/b&gt;');
    expect(out).not.toContain('<strong>');
  });
  it('the old [→ X] markers are still stripped', () => {
    expect(html('Done [→ Pipeline] now', true)).toContain('<p>Done now</p>');
  });
});
