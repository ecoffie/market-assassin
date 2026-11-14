/**
 * The script served at GET /event-popup.js (src/app/event-popup.js/route.ts) — the one-time pop-up for the Nov 28 live event, on every page.
 *
 * One script, loaded by the root layout (all React pages) and by the shared account menu HTML
 * (the map family and the raw-HTML public pages), so every page shows the same pop-up.
 *
 * Rules (Eric 2026-11-06: "a pop up for the event on the 28th on every page just once"):
 *  - once per browsing session (Eric 2026-11-13: "only once per user session"): a session cookie
 *    `mindy_lcb_popup_s` (no expiry, so it lasts until the browser closes and is shared by every tab),
 *    set when it is SHOWN (closing or not). It was once per browser (localStorage) before.
 *  - never on the event page itself, the sign-up/sign-in flows or /admin
 *  - after a 2.5 s pause, so it never covers the first paint
 *  - never while the visitor is typing (a focused text field): it waits until they leave the field.
 *    It used to open mid-typing and focus "Register free", so pressing Enter to send an Ask Mindy
 *    question navigated to the event page and the question was lost (found 2026-11-14).
 *  - the excluded pages are re-checked when it opens (client-side navigation can happen while it
 *    waits), and a focused field removed without a blur is caught by a 2 s check.
 *  - when it opens, focus goes to the dialog, not the link: a stray Enter does nothing; Escape
 *    closes; Tab reaches "Register free".
 *  - gone after the event: this route returns an empty script once lazyBlueprintIsOver()
 * Event facts come from src/lib/events/lazy-contractors-blueprint.ts.
 */
import { LAZY_CONTRACTORS_BLUEPRINT as LCB, lazyBlueprintIsOver } from '@/lib/events/lazy-contractors-blueprint';

function js(s: string): string {
  return JSON.stringify(s).replace(/</g, '\\u003c');
}

export function eventPopupScript(now: Date = new Date()): string {
  if (lazyBlueprintIsOver(now)) return '/* event over */';
  const KEY = 'mindy_lcb_popup_s';
  const css = [
    '.lcbp-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,40,.55);display:flex;align-items:center;justify-content:center;padding:16px;animation:lcbpIn .2s ease-out}',
    '@keyframes lcbpIn{from{opacity:0}to{opacity:1}}',
    '.lcbp:focus{outline:none}',
    '.lcbp{position:relative;width:min(460px,100%);background:#fff;border-radius:24px;box-shadow:0 30px 80px rgba(10,14,40,.35);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#12100e}',
    '.lcbp-top{background:#1b3a6b;color:#fff;padding:26px 28px 22px}',
    '.lcbp-k{font:700 12px/1 Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#c9d6e8}',
    '.lcbp-t{margin:10px 0 0;font:400 30px/1.15 "Libre Baskerville",Georgia,serif;color:#fff}',
    '.lcbp-d{margin-top:10px;font:600 15px/1.4 Inter,system-ui,sans-serif;color:#e3eaf4}',
    '.lcbp-b{padding:22px 28px 26px}',
    '.lcbp-b p{margin:0;font:400 16px/1.55 Inter,system-ui,sans-serif;color:#3f4650}',
    '.lcbp-b p b{color:#12100e}',
    '.lcbp-go{display:flex;justify-content:center;margin-top:20px;padding:14px 20px;border-radius:999px;background:#1b3a6b;color:#fff!important;font:700 16px Inter,system-ui,sans-serif;text-decoration:none}',
    '.lcbp-go:hover{background:#14294a}',
    '.lcbp-no{display:block;width:100%;margin-top:10px;padding:8px;border:0;background:none;color:#5b6470;font:500 14px Inter,system-ui,sans-serif;cursor:pointer}',
    '.lcbp-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:20px;line-height:1;cursor:pointer}',
    '@media (prefers-reduced-motion:reduce){.lcbp-ov{animation:none}}',
  ].join('');
  const html =
    '<div class="lcbp" role="dialog" aria-modal="true" aria-labelledby="lcbpT" tabindex="-1">'
    + '<button type="button" class="lcbp-x" aria-label="Close" data-lcbp-close>&times;</button>'
    + '<div class="lcbp-top"><div class="lcbp-k">Free live event · ' + LCB.shortDate + '</div>'
    + '<h2 class="lcbp-t" id="lcbpT">' + LCB.title.replace(/'/g, '&#39;') + '</h2>'
    + '<div class="lcbp-d">' + LCB.dateLabel + ' · ' + LCB.timeLabel + ' · Online</div></div>'
    + '<div class="lcbp-b"><p>Learn how to find and win federal contracts with Mindy doing the heavy lifting. '
    + '<b>Show up live and get 1,000 free Mindy credits.</b></p>'
    + '<a class="lcbp-go" href="' + LCB.path + '?utm_source=site_popup&amp;utm_medium=popup" data-lcbp-close>Register free</a>'
    + '<button type="button" class="lcbp-no" data-lcbp-close>Maybe later</button></div></div>';
  return '(function(){try{'
    + 'if(window.__lcbPop)return;window.__lcbPop=1;'
    + 'var K=' + js(KEY) + ';function seen(){return document.cookie.split("; ").some(function(c){return c.indexOf(K+"=")===0;});}if(seen())return;'
    + 'function excluded(){var p=location.pathname;'
    + 'return p.indexOf(' + js(LCB.path) + ')===0||/^\\/(admin|app\\/signup|signup|signin|app\\/sign-in|oauth|setup-password|reset-password|forgot-password|auth)/.test(p)||/[?&]embed=/.test(location.search);}'
    + 'if(excluded())return;'
    + 'function typing(){var a=document.activeElement;if(!a)return false;if(a.isContentEditable||a.tagName==="TEXTAREA"||a.tagName==="SELECT")return true;'
    + 'return a.tagName==="INPUT"&&!/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(a.type||"");}'
    + 'function whenIdle(){if(!typing()){show();return;}var done=false;var h=function(){if(done)return;done=true;document.removeEventListener("focusout",h,true);clearInterval(iv);setTimeout(whenIdle,400);};'
    + 'var iv=setInterval(function(){if(!typing())h();},2000);document.addEventListener("focusout",h,true);}'
    + 'function show(){if(excluded())return;try{if(seen())return;document.cookie=K+"=1; path=/; SameSite=Lax";if(!seen())return;}catch(e){return;}'
    + 'var st=document.createElement("style");st.textContent=' + js(css) + ';document.head.appendChild(st);'
    + 'var ov=document.createElement("div");ov.className="lcbp-ov";ov.innerHTML=' + js(html) + ';'
    + 'function close(){ov.remove();document.removeEventListener("keydown",onKey);}'
    + 'function onKey(e){if(e.key==="Escape")close();}'
    + 'ov.addEventListener("click",function(e){if(e.target===ov||(e.target.closest&&e.target.closest("[data-lcbp-close]")))close();});'
    + 'document.addEventListener("keydown",onKey);document.body.appendChild(ov);'
    + 'var dlg=ov.querySelector(".lcbp");if(dlg)dlg.focus();'
    + '}'
    + 'setTimeout(whenIdle,2500);'
    + '}catch(e){}})();';
}

