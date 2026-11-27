/**
 * Signed-in users could not reach the example prompts gallery or the 2027 Roadmap from inside the
 * app: both links lived only in the public site's top bar (src/lib/public-site/chrome.ts), so users
 * left the app by editing the URL. The shared account menu is the in-app way in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_MENU_HTML, accountMenuHtml } from './account-menu';

const items = (html: string) =>
  Array.from(html.matchAll(/<a href="([^"]+)"[^>]*role="menuitem"[^>]*>([\s\S]*?)<\/a>/g)).map((m) => ({
    href: m[1],
    text: m[2].replace(/<[^>]+>/g, '').trim(),
  }));

describe('account menu: example prompts + 2027 Roadmap', () => {
  for (const [name, html] of [
    ['default menu', ACCOUNT_MENU_HTML],
    ['signed-in /app menu', accountMenuHtml({ email: 'someone@example.com' })],
  ] as const) {
    it(`${name} links to the example prompts gallery with a clear label`, () => {
      const gallery = items(html).filter((i) => i.href === '/mcp/gallery');
      expect(gallery).toEqual([{ href: '/mcp/gallery', text: 'Example prompts for your AI' }]);
    });

    it(`${name} links to the 2027 Roadmap`, () => {
      expect(items(html)).toContainEqual({ href: '/roadmap', text: '2027 Roadmap' });
    });
  }

  it('the /app page renders this shared menu (call site)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/app/page.tsx'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\baccountMenuHtml\b[^}]*\} from '@\/app\/opportunity-map\/account-menu'/);
    expect(src).toMatch(/html=\{accountMenuHtml\(\{ email \}\)\}/);
  });
});
