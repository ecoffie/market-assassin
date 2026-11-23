/**
 * StateBlock (Design & Output, 2026-11-22): the five Opportunity Map sub-pages share ONE signed-out state —
 * a heading, one sentence and one Sign in button — instead of five bare sentences with an inline link
 * (one of them in the browser's default blue).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_BLOCK_CSS, signedOutStateHtml } from './state-block';
import { PRODUCT_TOKENS } from './tokens';
import { MP_COLORS } from '@/lib/public-site/tokens';

describe('signedOutStateHtml', () => {
  it('renders a heading, one sentence and a Sign in button that opens the existing sign-in flow', () => {
    const html = signedOutStateHtml({ title: 'Sign in to see your pursuits', body: 'Track what you are going after.' });
    expect(html).toContain('<h2>Sign in to see your pursuits</h2>');
    expect(html).toContain('<p>Track what you are going after.</p>');
    expect(html).toMatch(/<button type="button" class="mstate-act" onclick="return window.__mapsSignIn\(\)">Sign in<\/button>/);
    expect(html).toContain('role="status"');
  });

  it('escapes its text', () => {
    const html = signedOutStateHtml({ title: '<b>x</b>', body: 'a & "b"', action: 'Go <now>' });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a &amp; &quot;b&quot;');
    expect(html).toContain('Go &lt;now&gt;');
  });

  it('survives being embedded as a JS string in a page script', () => {
    const js = `el.innerHTML=${JSON.stringify(signedOutStateHtml({ title: "Sign in to see what's new", body: 'x' }))};`;
    expect(() => new Function('el', js)).not.toThrow();
    expect(js).not.toContain('</script');
  });
});

describe('STATE_BLOCK_CSS', () => {
  it('uses the navy primary action from the shared tokens, with a 44px tap target and a visible focus ring', () => {
    expect(PRODUCT_TOKENS.action).toBe(MP_COLORS.navy);
    expect(STATE_BLOCK_CSS).toContain(`background:${MP_COLORS.navy}`);
    expect(STATE_BLOCK_CSS).toContain('min-height:44px');
    expect(STATE_BLOCK_CSS).toMatch(/\.mstate-act:focus-visible\{outline:2px solid/);
  });
});

describe('Opportunity Map sub-pages use it', () => {
  const ROUTES = ['saved', 'reports', 'pursuits', 'favorites', 'vault'];
  it.each(ROUTES)('%s: signed-out state comes from signedOutStateHtml, styles are included, no bare sign-in sentence', (r) => {
    const src = readFileSync(join(process.cwd(), 'src/app/opportunity-map', r, 'route.ts'), 'utf8');
    expect(src).toContain('signedOutStateHtml({');
    expect(src).toContain('<style>${STATE_BLOCK_CSS}</style>');
    expect(src).not.toMatch(/class="signin"[^']*>Please <a/);
  });
});
