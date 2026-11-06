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
    + `<span class="mp-evb-s"><b>Free live event ${esc(LCB.shortDate)}</b> · get $50 in credits</span></p>`
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
    + `${ACCOUNT_MENU_HTML}</nav></header></div>`;
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
  // Phones: the banner is one short line and scrolls away; only the nav row stays pinned
  // (display:contents lifts .mp-head out of .mp-top so its sticky range is the whole page).
  '@media(max-width:620px){.mp-top{display:contents}.mp-head{position:sticky;top:0;z-index:40;height:56px}'
    + '.mp-evb-band{padding:6px max(10px,env(safe-area-inset-right,0px)) 6px max(10px,env(safe-area-inset-left,0px))}'
    + '.mp-evb{flex-wrap:nowrap;justify-content:space-between;gap:10px;padding:6px 36px 6px 12px;text-align:left}'
    + '.mp-evb-l{display:none}.mp-evb-s{display:inline}.mp-evb-t{font-size:13.5px;line-height:1.3}'
    + '.mp-evb-c{padding:6px 12px;font-size:13px}.mp-evb-x{right:2px;width:30px;height:30px}'
    + '.mp-logo span{font-size:18px}.mp-logo img{width:26px;height:26px}.mp-head .mp-su{padding:9px 14px;font-size:14px}}',
  '@media (prefers-reduced-motion: reduce){.mp-evb{transition:none}}',
].join('');
