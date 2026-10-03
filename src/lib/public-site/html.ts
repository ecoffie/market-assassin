/**
 * The public shell for raw-HTML route handlers — the string twin of <PublicShell>.
 *
 * /gov, /institute, /research, /pilot, /bid and the Observatory report are route handlers that
 * emit a complete document, so they cannot render React components. They compose these strings
 * instead and get the same canvas, header, footer, fonts and `mp-*` stylesheet as every React
 * public page. Header and footer content comes from chrome.ts, which PublicHeader / PublicFooter
 * also read, so the two renderings cannot drift.
 *
 * Usage:
 *   `<head>…${mpRawHeadHtml()}<style>page rules</style></head><body>`
 *   + mpRawBodyOpen() + pageHtml + mpRawBodyClose() + `</body>`
 */
import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from '@/app/opportunity-map/account-menu';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import { SITE_LINK_GROUPS } from '@/lib/seo/site-links';
import { MP_FOOTER_TAGLINE, MP_HEADER_ACCOUNT_LINKS, MP_HEADER_PRODUCT_LINKS, MP_LOGO_SRC, type MpChromeLink } from './chrome';
import { MP_RAW_SITE_CSS, MP_ROOT_PAINT_CSS } from './css';
import { mpFontPreloadLinksHtml } from './fonts';

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const links = (list: readonly MpChromeLink[]) => list.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('');

/** Font preloads plus the shared stylesheet. Put it in <head> BEFORE any page-specific <style>. */
export function mpRawHeadHtml(): string {
  return `${mpFontPreloadLinksHtml({ includeInter: true })}<style>${MP_ROOT_PAINT_CSS}${MP_RAW_SITE_CSS}</style>`;
}

/** The homepage header, as markup. */
export function mpRawHeaderHtml(): string {
  return `<header class="mp-head" data-mp-chrome=""><nav class="mp-head-left" aria-label="Product">${links(MP_HEADER_PRODUCT_LINKS)}</nav>`
    + `<a href="${esc(MAPS_HOME_PATH)}" title="Mindy" class="mp-logo"><img src="${MP_LOGO_SRC}" alt=""><span>Mindy</span></a>`
    + `<nav class="mp-head-right" aria-label="Account">${links(MP_HEADER_ACCOUNT_LINKS)}${ACCOUNT_MENU_HTML}</nav></header>`;
}

/** The homepage footer, as markup (same groups as PublicFooter). */
export function mpRawFooterHtml(): string {
  const groups = SITE_LINK_GROUPS.map(
    (g) => `<div><h2>${esc(g.heading)}</h2><ul>${g.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join('')}</ul></div>`,
  ).join('');
  return `<footer class="mp-foot" data-mp-chrome=""><div class="mp-foot-g">${groups}</div><div class="mp-foot-b">${esc(MP_FOOTER_TAGLINE)}</div></footer>`;
}

type ContentElement = 'main' | 'div';

/** Opens the shell: canvas, skip link, header, then the content landmark. */
export function mpRawBodyOpen({ contentElement = 'main' }: { contentElement?: ContentElement } = {}): string {
  return `<div data-site="public" class="mp-site"><a href="#mp-main" class="mp-skip" data-mp-chrome="">Skip to content</a>`
    + `${mpRawHeaderHtml()}<${contentElement} id="mp-main" class="mp-main" tabindex="-1">`;
}

/** Closes the content landmark, adds the footer and the account-menu script. */
export function mpRawBodyClose({ contentElement = 'main' }: { contentElement?: ContentElement } = {}): string {
  return `</${contentElement}>${mpRawFooterHtml()}</div>${ACCOUNT_MENU_JS}`;
}
