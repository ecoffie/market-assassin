/**
 * The site top bar: the Nov 28 event banner plus the homepage nav (logo · Mindy in your AI ·
 * Learn ··· Sign in · Contact sales · Plans & Pricing · Sign up free). One string, rendered by
 * the homepage, every React public page (PublicHeader) and every raw-HTML public page (html.ts),
 * so they cannot drift. The Maps product keeps its own bar.
 *
 * The shared account menu sits in the right cluster but stays hidden for signed-out visitors:
 * they see the static links (no flash before the account script runs). Once the script paints
 * an avatar (initials or picture), CSS swaps the signed-out links for the avatar menu.
 */
import { ACCOUNT_MENU_HTML } from '@/app/opportunity-map/account-menu';
import { LAZY_CONTRACTORS_BLUEPRINT as LCB, lazyBlueprintIsOver } from '@/lib/events/lazy-contractors-blueprint';
import { MP_HEADER_ACCOUNT_LINKS, MP_HEADER_PRODUCT_LINKS, MP_HEADER_SIGNUP_LINK, MP_LOGO_SRC, type MpChromeLink } from './chrome';

const SITE_HOME_PATH = '/';

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sign in + Contact sales are signed-out only; Contact sales + Plans & Pricing drop on small screens. */
function rightLink(l: MpChromeLink, i: number): string {
  const cls = [i < 2 ? 'mp-anon' : '', i > 0 ? 'mp-hide-sm' : ''].filter(Boolean).join(' ');
  return `<a class="${cls}" href="${esc(l.href)}">${esc(l.label)}</a>`;
}

/** The event banner, or '' once the event is over. */
export function siteEventBannerHtml(now: Date = new Date()): string {
  if (lazyBlueprintIsOver(now)) return '';
  return `<div class="mp-evb-band" id="mp-evb"><div class="mp-evb">`
    + `<p class="mp-evb-t"><span class="mp-evb-l">Join <b>${esc(LCB.title)}</b> live on <b>${esc(LCB.shortDate)}</b> — show up and get $50 in free Mindy credits</span>`
    + `<span class="mp-evb-s">Join <b>${esc(LCB.title)}</b>, free and live on <b>${esc(LCB.shortDate)}</b></span></p>`
    + `<a class="mp-evb-c" href="${esc(LCB.path)}">Register free</a>`
    + `<button type="button" class="mp-evb-x" aria-label="Close banner" onclick="document.getElementById('mp-evb').hidden=true">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`;
}

/** The whole top bar (banner + nav). The account script is shipped separately by each shell. */
export function siteTopHtml(): string {
  const left = MP_HEADER_PRODUCT_LINKS.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('');
  const right = MP_HEADER_ACCOUNT_LINKS.map(rightLink).join('');
  return `<div class="mp-top" data-mp-chrome="">${siteEventBannerHtml()}`
    + `<header class="mp-head"><a href="${SITE_HOME_PATH}" title="Mindy" class="mp-logo"><img src="${MP_LOGO_SRC}" alt=""><span>Mindy</span></a>`
    + `<nav class="mp-head-left" aria-label="Product">${left}</nav>`
    + `<nav class="mp-head-right" aria-label="Account">${right}`
    + `<a class="mp-anon mp-su" href="${esc(MP_HEADER_SIGNUP_LINK.href)}">${esc(MP_HEADER_SIGNUP_LINK.label)}</a>`
    + `${ACCOUNT_MENU_HTML}`
    + `<button type="button" class="mp-burger" aria-label="Menu" aria-expanded="false" aria-controls="mp-menu" onclick="${MENU_TOGGLE}">`
    + `<svg class="mp-burger-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`
    + `<svg class="mp-burger-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
    + `</nav></header>${siteMenuHtml()}</div>`;
}

/** Toggles the phone menu (html.mp-menu-open). Inline so raw-HTML pages need no extra script. */
const MENU_TOGGLE = "var o=document.documentElement.classList.toggle('mp-menu-open');this.setAttribute('aria-expanded',o?'true':'false');";

const CHEVRON = '<svg class="mp-menu-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

/** The phone menu panel (Zoom-style): search, the main links, then Contact sales, Sign in, Sign up free. */
function siteMenuHtml(): string {
  const items: MpChromeLink[] = [
    { href: '/opportunity-map', label: 'Opportunity Map' },
    ...MP_HEADER_PRODUCT_LINKS,
    { href: '/pricing', label: 'Plans & Pricing' },
    { href: '/bid', label: 'Bid with confidence' },
  ];
  const [signIn, sales] = MP_HEADER_ACCOUNT_LINKS;
  return `<div class="mp-menu" id="mp-menu">`
    + `<form class="mp-menu-search" action="/opportunity-map" method="get" role="search">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`
    + `<input type="search" name="q" placeholder="Search opportunities…" aria-label="Search opportunities" autocomplete="off"></form>`
    + `<nav class="mp-menu-links" aria-label="Menu">`
    + items.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}${CHEVRON}</a>`).join('')
    + `</nav><div class="mp-menu-foot">`
    + `<a class="mp-menu-sales" href="${esc(sales.href)}">${esc(sales.label)}</a>`
    + `<a class="mp-menu-signin mp-anon" href="${esc(signIn.href)}">${esc(signIn.label)}</a>`
    + `<a class="mp-menu-su mp-anon" href="${esc(MP_HEADER_SIGNUP_LINK.href)}">${esc(MP_HEADER_SIGNUP_LINK.label)}</a>`
    + `</div></div>`;
}

/** Rules for the top bar. Tokens only (the public design lint scans this file). */
export const SITE_NAV_CSS = [
  '.mp-top{position:sticky;top:0;z-index:40;font-family:var(--mp-font-sans)}',
  '.mp-head{height:64px;display:flex;align-items:center;gap:28px;background:var(--mp-surface);border-bottom:1px solid var(--mp-hair);'
    + 'padding:0 max(28px,env(safe-area-inset-right,0px)) 0 max(28px,env(safe-area-inset-left,0px))}',
  '.mp-head a{color:var(--mp-ink);text-decoration:none;white-space:nowrap}',
  '.mp-logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:20px;flex:none}',
  '.mp-logo img{width:28px;height:28px;display:block}',
  '.mp-logo span{font:700 20px var(--mp-font-sans);color:var(--mp-ink);letter-spacing:-.02em}',
  '.mp-head-left{display:flex;gap:24px;font-weight:600;font-size:15px}',
  '.mp-head-right{margin-left:auto;display:flex;align-items:center;gap:22px;font-weight:600;font-size:15px}',
  '.mp-head-left a:hover,.mp-head-right>a:hover{color:var(--mp-navy)}',
  '.mp-head a[aria-current="page"]{color:var(--mp-navy)}',
  '.mp-head .mp-su{background:var(--mp-navy);color:var(--mp-surface);padding:10px 18px;border-radius:10px}',
  '.mp-head .mp-su:hover{background:var(--mp-navy-hover);color:var(--mp-surface)}',
  // Account menu: hidden until it shows a signed-in avatar; then the signed-out links go.
  '.mp-head .mindy-anon-link{display:none!important}',
  '.mp-head-right .mindy-acct{display:none}',
  '.mp-head-right:has(.mindy-acct-ini,.mindy-acct-btn img) .mindy-acct{display:block}',
  '.mp-head-right:has(.mindy-acct-ini,.mindy-acct-btn img) .mp-anon{display:none}',
  '@media(max-width:980px){.mp-head-left,.mp-head .mp-hide-sm{display:none}}',
  '@media(max-width:620px){.mp-head{gap:14px;padding:0 max(12px,env(safe-area-inset-right,0px)) 0 max(12px,env(safe-area-inset-left,0px))}.mp-head-right{gap:14px}}',
  // Event banner
  '.mp-evb-band{background:var(--mp-navy-wash);border-bottom:1px solid var(--mp-hair);'
    + 'padding:8px max(28px,env(safe-area-inset-right,0px)) 8px max(28px,env(safe-area-inset-left,0px))}',
  '.mp-evb-band[hidden]{display:none}',
  '.mp-evb{position:relative;display:flex;align-items:center;justify-content:center;gap:12px 22px;flex-wrap:wrap;margin:0;padding:7px 56px;'
    + 'border-radius:12px;background:rgba(27,58,107,.08);border:1px solid rgba(27,58,107,.14);text-align:center;cursor:pointer;transition:background .15s,border-color .15s}',
  '.mp-evb:hover{background:rgba(27,58,107,.13);border-color:rgba(27,58,107,.24)}',
  '.mp-evb-t{margin:0;font:400 16px/1.4 var(--mp-font-sans);color:var(--mp-ink);min-width:0}',
  '.mp-evb-t b{font-weight:700}',
  '.mp-evb-c{flex:0 0 auto;padding:7px 18px;border-radius:999px;background:var(--mp-navy);color:var(--mp-surface);font:700 15px var(--mp-font-sans);text-decoration:none}',
  '.mp-evb-c:hover{background:var(--mp-navy-hover)}',
  '.mp-evb-c::after{content:"";position:absolute;inset:0;border-radius:12px;z-index:1}',
  '.mp-evb-x{position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:2;width:32px;height:32px;border:0;border-radius:50%;'
    + 'background:none;color:var(--mp-ink);cursor:pointer;display:grid;place-items:center}',
  '.mp-evb-x:hover{background:rgba(27,58,107,.1)}',
  '.mp-evb-x svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
  '.mp-evb-s{display:none}',
  // Phones (Zoom-style): the nav row comes first and stays pinned; the banner is a centred card
  // UNDER it that scrolls away. display:contents lifts both out of .mp-top so they become items of
  // the .mp-site flex column, where `order` puts the nav (-2) above the banner (-1) and the page.
  '@media(max-width:620px){.mp-top{display:contents}.mp-site>.mp-skip{order:-3}'
    + '.mp-head{order:-2;position:sticky;top:0;z-index:40;height:60px}'
    + '.mp-evb-band{order:-1;border-bottom:0;padding:10px max(14px,env(safe-area-inset-right,0px)) 6px max(14px,env(safe-area-inset-left,0px))}'
    + '.mp-evb{flex-direction:column;gap:12px;padding:16px 44px 16px;border-radius:16px;text-align:center}'
    + '.mp-evb-l{display:none}.mp-evb-s{display:inline}.mp-evb-t{font-size:15.5px;line-height:1.45}'
    + '.mp-evb-c{padding:9px 20px;font-size:15px}.mp-evb-x{right:6px;top:14px;transform:none;width:32px;height:32px}'
    + '.mp-logo span{font-size:20px}.mp-logo img{width:28px;height:28px}.mp-head .mp-su{padding:9px 14px;font-size:14px}}',
  // Phone menu (☰). Hidden above 620px.
  '.mp-burger,.mp-menu{display:none}',
  '@media(max-width:620px){'
    + '.mp-head .mp-anon:not(.mp-su){display:none}'
    + '.mp-burger{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin-right:-8px;border:0;background:none;color:var(--mp-ink);cursor:pointer;border-radius:10px;flex:none}'
    + '.mp-burger svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}'
    + '.mp-burger-close{display:none}html.mp-menu-open .mp-burger-open{display:none}html.mp-menu-open .mp-burger-close{display:block}'
    + 'html.mp-menu-open{overflow:hidden}'
    + 'html.mp-menu-open .mp-menu{display:flex}'
    + '.mp-menu{position:fixed;left:0;right:0;top:60px;bottom:0;z-index:60;flex-direction:column;overflow-y:auto;background:var(--mp-surface);'
    + 'border-top:1px solid var(--mp-hair);padding:16px max(16px,env(safe-area-inset-right,0px)) calc(20px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}'
    + '.mp-menu-search{display:flex;align-items:center;gap:10px;height:52px;padding:0 16px;border-radius:14px;background:var(--mp-navy-wash);margin:0 0 14px}'
    + '.mp-menu-search svg{width:20px;height:20px;flex:none;fill:none;stroke:var(--mp-ink);stroke-width:2.2;stroke-linecap:round}'
    + '.mp-menu-search input{flex:1;min-width:0;border:0;outline:0;background:none;font:400 17px var(--mp-font-sans);color:var(--mp-ink)}'
    + '.mp-menu-links{display:flex;flex-direction:column}'
    + '.mp-menu-links a{display:flex;align-items:center;justify-content:space-between;min-height:56px;padding:0 8px;font:600 19px var(--mp-font-sans);color:var(--mp-ink);text-decoration:none}'
    + '.mp-menu-chev{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}'
    + '.mp-menu-foot{margin-top:auto;padding-top:28px;display:flex;flex-direction:column;gap:10px}'
    + '.mp-menu-sales,.mp-menu-signin{padding:10px 8px;font:600 17px var(--mp-font-sans);color:var(--mp-ink);text-decoration:none}'
    + '.mp-menu-su{display:flex;align-items:center;justify-content:center;height:52px;margin-top:6px;border-radius:12px;background:var(--mp-navy);color:var(--mp-surface);font:700 17px var(--mp-font-sans);text-decoration:none}'
    + 'html:has(.mindy-acct-ini,.mindy-acct-btn img) .mp-menu .mp-anon{display:none}'
    + '}',
  '@media (prefers-reduced-motion: reduce){.mp-evb{transition:none}}',
].join('');
