import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import McpSetupPage from './page';
import { stepBodyParts } from './setup-copy';

/**
 * The setup guide tells a new person to "Start a 14-day free trial of Pro or Team first at
 * getmindy.ai/pricing". That address was plain text, and the page's only pricing link went to
 * /mcp/pricing (credit plans), so the trial they were told to start had no clickable way in.
 */
describe('setup guide trial link', () => {
  it('parses [label](href) into a link part and keeps *bold* parts', () => {
    expect(stepBodyParts('Go to [getmindy.ai/pricing](/pricing) and click *Start*.')).toEqual([
      { kind: 'text', text: 'Go to ' },
      { kind: 'link', text: 'getmindy.ai/pricing', href: '/pricing' },
      { kind: 'text', text: ' and click ' },
      { kind: 'bold', text: 'Start' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('renders getmindy.ai/pricing as a clickable link to /pricing in both trial steps', () => {
    const html = renderToStaticMarkup(<McpSetupPage />);
    const links = html.match(/<a [^>]*href="\/pricing"[^>]*>getmindy\.ai\/pricing<\/a>/g) ?? [];
    // Claude step 5 and ChatGPT step 4.
    expect(links).toHaveLength(2);
    // No raw markup leaks into the visible copy.
    expect(html).not.toContain('](/pricing)');
    expect(html).not.toContain('[getmindy.ai/pricing]');
  });

  it('keeps the trial sentence unchanged apart from the link', () => {
    const text = renderToStaticMarkup(<McpSetupPage />).replace(/<[^>]+>/g, '');
    expect(text).toContain(
      'New to Mindy? Start a 14-day free trial of Pro or Team first at getmindy.ai/pricing (no charge for 14 days).',
    );
  });
});
