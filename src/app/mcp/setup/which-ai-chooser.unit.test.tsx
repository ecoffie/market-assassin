import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import McpSetupPage from './page';
import { AI_CHOOSER, AI_CHOOSER_CSS, AI_SECTIONS_CLASS } from './setup-copy';

/**
 * Customers on calls use different assistants (Copilot, Gemini, Claude, ChatGPT). A rep demoed
 * in Claude to a Copilot user who could not follow along: /mcp/setup showed every assistant's
 * steps in one long page instead of asking "Which AI do you use?" first.
 */
const html = renderToStaticMarkup(<McpSetupPage />);
const doc = new JSDOM(html).window.document;

describe('/mcp/setup asks "Which AI do you use?" first', () => {
  it('renders the chooser before any assistant section', () => {
    const nav = doc.getElementById('which-ai');
    expect(nav).not.toBeNull();
    expect(nav!.textContent).toContain('Which AI do you use?');
    const claude = doc.getElementById('claude')!;
    // DOCUMENT_POSITION_FOLLOWING: the Claude section comes after the chooser.
    expect(nav!.compareDocumentPosition(claude) & 4).toBe(4);
  });

  it('links each option to its section, and every target exists with data-ai', () => {
    const links = [...doc.querySelectorAll('#which-ai a')].map((a) => [a.textContent, a.getAttribute('href')]);
    for (const id of ['claude', 'chatgpt', 'other']) {
      expect(links.some(([, href]) => href === `#${id}`)).toBe(true);
      const section = doc.getElementById(id);
      expect(section?.tagName).toBe('SECTION');
      expect(section?.getAttribute('data-ai')).toBe(id);
      expect(section?.parentElement?.classList.contains(AI_SECTIONS_CLASS)).toBe(true);
    }
    expect(links.map(([t]) => t).join(' ')).toMatch(/Claude.*ChatGPT.*Copilot, Cursor or other/);
    expect(links.some(([t, href]) => t === AI_CHOOSER.showAll && href === '#which-ai')).toBe(true);
  });

  it('keeps the existing #other link in the intro and the #ask section outside the toggle', () => {
    expect(doc.querySelector('a[href="#other"]')).not.toBeNull();
    const ask = doc.getElementById('ask')!;
    expect(ask.hasAttribute('data-ai')).toBe(false);
    expect(ask.parentElement?.classList.contains(AI_SECTIONS_CLASS)).toBe(false);
  });

  it('ships the CSS that hides only the non-targeted assistant sections', () => {
    expect(doc.querySelector('style')?.textContent).toBe(AI_CHOOSER_CSS);
    // Nothing is hidden by default: the hide rule only applies once a section is :target,
    // so without JS (or without :has support) all sections stay visible.
    expect(AI_CHOOSER_CSS).toBe(
      '.setup-ai-sections:has(> section[data-ai]:target) > section[data-ai]:not(:target){display:none}',
    );
    expect(html).not.toMatch(/data-ai="[a-z]+"[^>]*(hidden|display:\s*none)/);
  });

  it('makes no price or credit claims in the chooser', () => {
    const text = doc.getElementById('which-ai')!.textContent ?? '';
    expect(text).not.toMatch(/\$|credit|price|free/i);
  });
});
