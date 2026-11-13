import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ACCOUNT_MENU_CSS, ACCOUNT_MENU_JS } from '@/app/opportunity-map/account-menu';
import PublicFooter from '@/components/public-site/PublicFooter';
import { SITE_LINK_GROUPS } from '@/lib/seo/site-links';
import { MP_COMPONENTS_CSS, MP_RAW_SITE_CSS, MP_ROOT_PAINT_CSS, MP_SITE_CSS, MP_ACCOUNT_OVERRIDES_CSS } from './css';
import { MP_HEADER_ACCOUNT_LINKS, MP_HEADER_PRODUCT_LINKS, MP_HOW_IT_WORKS } from './chrome';
import { mpRawBodyClose, mpRawBodyOpen, mpRawFooterHtml, mpRawHeadHtml, mpRawHeaderHtml } from './html';

const doc = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const hrefs = (root: ParentNode) => [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));

describe('raw-HTML public shell', () => {
  it('renders the homepage top bar links, in order', () => {
    const d = doc(mpRawHeaderHtml());
    const header = d.querySelector('[data-mp-chrome] header.mp-head')!;
    expect(header).toBeTruthy();
    const expected = ['/', ...MP_HOW_IT_WORKS.map((l) => l.href), ...MP_HEADER_PRODUCT_LINKS.flatMap((l) => [l.href, ...(l.sub ?? []).map((i) => i.href)]), ...MP_HEADER_ACCOUNT_LINKS.map((l) => l.href), '/pricing'];
    expect(hrefs(header).slice(0, expected.length)).toEqual(expected);
    expect(header.querySelector('.mp-logo img')?.getAttribute('src')).toBe('/brand/mindy-logo-icon.png');
  });

  it('has no Plans & Pricing link: Start for free already goes to /pricing (2026-11-13)', () => {
    const d = doc(mpRawHeaderHtml());
    const labels = [...d.querySelectorAll('a')].map((a) => a.textContent?.trim());
    expect(labels).not.toContain('Plans & Pricing');
    const toPricing = [...d.querySelectorAll('header.mp-head a[href="/pricing"]')].map((a) => a.textContent?.trim());
    expect(toPricing).toEqual(['Start for free']);
  });

  it('has a "How it works" menu in place of Learn, one card per way Mindy works', () => {
    const header = doc(mpRawHeaderHtml()).querySelector('header.mp-head')!;
    expect(header.querySelector('.mp-hiw-btn')?.textContent).toBe('How it works');
    expect([...header.querySelectorAll('.mp-hiw-grid a')].map((a) => a.getAttribute('href'))).toEqual(MP_HOW_IT_WORKS.map((i) => i.href));
    expect([...header.querySelectorAll('a')].some((a) => a.textContent === 'Learn')).toBe(false);
  });

  it('puts a "See examples" link to the gallery under "Mindy in your AI", desktop and phone (2026-11-13)', () => {
    const d = doc(mpRawHeaderHtml());
    const sub = d.querySelector('header.mp-head .mp-sub')!;
    expect(sub.querySelector('.mp-hiw-btn')?.getAttribute('href')).toBe('/mcp/gallery');
    expect(sub.querySelector('.mp-hiw-btn')?.textContent).toBe('Mindy in your AI');
    const desk = [...sub.querySelectorAll('.mp-sub-list a')].map((a) => [a.querySelector('b')?.textContent, a.getAttribute('href')]);
    expect(desk).toContainEqual(['See examples', '/mcp/gallery']);
    const phone = [...d.querySelectorAll('#mp-menu .mp-menu-links a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(phone).toContainEqual(['See examples', '/mcp/gallery']);
    expect([...d.querySelectorAll('#mp-menu .mp-menu-h')].map((h) => h.textContent)).toContain('Mindy in your AI');
  });

  it('renders a footer identical to the React PublicFooter', () => {
    const raw = doc(mpRawFooterHtml()).querySelector('footer')!;
    const react = doc(renderToStaticMarkup(PublicFooter())).querySelector('footer')!;
    expect(hrefs(raw)).toEqual(hrefs(react));
    expect(raw.textContent).toBe(react.textContent);
    expect(hrefs(raw)).toEqual(SITE_LINK_GROUPS.flatMap((g) => g.links.map((l) => l.href)));
  });

  it('marks all chrome so the parity harness can exclude it', () => {
    const d = doc(mpRawBodyOpen() + '<p id="page">x</p>' + mpRawBodyClose());
    const site = d.querySelector('[data-site="public"].mp-site')!;
    expect(site).toBeTruthy();
    for (const el of site.children) {
      if (el.id === 'mp-main') continue;
      if (el.tagName === 'SCRIPT') continue;
      expect(el.hasAttribute('data-mp-chrome'), el.outerHTML.slice(0, 60)).toBe(true);
    }
    expect(d.querySelector('main#mp-main #page')).toBeTruthy();
  });

  it('can use a div landmark for pages that render their own <main>', () => {
    const d = doc(mpRawBodyOpen({ contentElement: 'div' }) + mpRawBodyClose({ contentElement: 'div' }));
    expect(d.querySelector('div#mp-main.mp-main')).toBeTruthy();
    expect(d.querySelector('main')).toBeNull();
  });

  it('ships the account script once, after the footer', () => {
    const close = mpRawBodyClose();
    expect(close.indexOf(ACCOUNT_MENU_JS)).toBeGreaterThan(close.indexOf('</footer>'));
    expect(close.split(ACCOUNT_MENU_JS).length).toBe(2);
  });

  it('uses the same component rules as React pages, plus the static Inter file', () => {
    const head = mpRawHeadHtml();
    expect(head).toContain(MP_ROOT_PAINT_CSS);
    expect(head).toContain(MP_RAW_SITE_CSS);
    expect(MP_SITE_CSS).toContain(MP_COMPONENTS_CSS);
    expect(MP_RAW_SITE_CSS).toContain(MP_COMPONENTS_CSS);
    expect(MP_RAW_SITE_CSS).toContain('font-family:"Inter"');
    expect(MP_RAW_SITE_CSS.indexOf(MP_ACCOUNT_OVERRIDES_CSS)).toBeGreaterThan(MP_RAW_SITE_CSS.indexOf(ACCOUNT_MENU_CSS));
    expect(head).not.toMatch(/googleapis|gstatic/);
    expect(head).toContain('rel="preload"');
  });

  it('drops the shared chrome when printed, on React and raw-HTML pages alike', () => {
    const rule = '@media print{.mp-site [data-mp-chrome]{display:none!important}';
    expect(MP_COMPONENTS_CSS).toContain(rule);
    expect(MP_SITE_CSS).toContain(rule);
    expect(MP_RAW_SITE_CSS).toContain(rule);
  });
});
