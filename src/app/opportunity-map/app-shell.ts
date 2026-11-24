/**
 * `?shell=app` — the map rendered INSIDE the signed-in app (/app?panel=map, Option A, 2026-11-16).
 *
 * The app keeps its own top bar + sidebar and shows this page in a same-origin iframe. In this mode
 * the map hides ONLY its site top bar (.zhead) and its icon rail (.zrail). Everything else — filter
 * bar, list, drawers, saved-search, sign-in state, boot/fetch behaviour — is the standalone map,
 * unchanged. The standalone `/opportunity-map` (signed-out visitors, SEO, every existing link) never
 * sees any of this: it is injected only when the request carries `shell=app`.
 *
 * ⚠️ This is NOT `?embed=` (the /today hero's static, filter-less map with its own boot rules).
 * `shell` never touches OPPS, BOOT_VIEW_JS, VIEWPORT_JS or the fetch rounds, so the Maps P0/P1 rule
 * "one boot round, no duplicate fetch" holds by construction. Return continuity is unaffected too:
 * `shell` is not in the stand-down list, so a bare shell map restores the remembered market exactly
 * like a bare standalone map.
 *
 * The parent (/app) is the only reader of the messages below and checks origin + source.
 * Address translation lives in src/lib/app/map-shell.ts.
 */
import {
  IN_APP_PATH_RE,
  MAP_SHELL_NAV_MESSAGE,
  MAP_SHELL_SELECTED_OPP_MESSAGE,
  MAP_SHELL_URL_MESSAGE,
  MAP_VIEW_PARAM,
  SHELL_PARAM,
  SHELL_VALUE,
} from '@/lib/app/map-shell';

export function isAppShellRequest(url: URL): boolean {
  return url.searchParams.get(SHELL_PARAM) === SHELL_VALUE;
}

/**
 * The main map. Hides .zhead/.zrail and re-grids .app without their row/column, so there is no blank
 * gap where they were. --zh-h is pinned to 0 (ZHEAD_HEIGHT_JS would measure 0 anyway once .zhead is
 * display:none, but the drawer's fallback is 52px until that script runs). Drawers lose the 64px
 * rail offset. Phone layout mirrors the map's own ≤640px single-column grid minus the header row.
 */
export const MAP_APP_SHELL_CSS = '<style id="mp-app-shell">'
  + ':root{--zh-h:0px!important}'
  + '.zhead,.zrail{display:none!important}'
  + '.app{grid-template-columns:minmax(0,1fr) 400px!important;grid-template-rows:auto auto minmax(0,1fr)!important;'
  + 'grid-template-areas:"ztop ztop" "znote znote" "zmap zcards"!important}'
  + '.app.collapsed{grid-template-columns:minmax(0,1fr) 0px!important}'
  + '.oppbd,.oppdrawer{left:0!important}'
  // The filter bar. Inside the app the map is ~250px narrower (the app sidebar), and the
  // standalone bar is one nowrap row of flex:none pills, so its tail ("Save search", "Clear all")
  // ran off the right edge. Here it WRAPS instead — never a scroller: overflow on .ztop/.fbar/
  // .fscroll clips every dropdown (route.ts PERMANENT RULE). The search keeps the left of row 1;
  // the pills take the rest and flow onto a second row only when they must. Desktop only — the
  // phone layout (≤640px) already wraps with its own rules, untouched here.
  + '@media(min-width:641px){'
  +   '.ztop{flex-wrap:wrap!important;row-gap:8px!important;padding:10px 14px!important}'
  +   '.zsearch{flex:1 1 200px!important;max-width:320px!important}'
  +   '.ztop .fbar{flex:1 1 560px!important;min-width:0!important}'
  +   '.ztop .fbar .fscroll{flex-wrap:wrap!important;row-gap:8px!important;column-gap:6px!important;overflow:visible!important}'
  + '}'
  + '@media(max-width:640px){'
  +   '.app,.app.collapsed{grid-template-columns:1fr!important;grid-template-rows:auto auto minmax(0,1fr)!important;'
  +     'grid-template-areas:"ztop" "znote" "zcards"!important}'
  + '}'
  + '</style>';

/**
 * The filter bar's height now depends on width (it may wrap), and Leaflet only re-measures on a
 * WINDOW resize. When the bar's height changes, the map pane changes height without a window
 * resize, so tell Leaflet. Presentation only: invalidateSize() never fetches, and a same-centre,
 * same-zoom moveend is a layout move (layout-move.ts) that fetches only newly exposed area.
 */
export const MAP_APP_SHELL_RESIZE_JS = '<script>(function(){'
  + 'function go(){var t=document.querySelector(".ztop");if(!t||!window.ResizeObserver)return;var last=-1;'
  + 'new ResizeObserver(function(){var h=t.offsetHeight;if(h===last)return;var first=last<0;last=h;if(first)return;'
  + 'try{if(window.map)setTimeout(function(){try{map.invalidateSize();}catch(e){}},60);}catch(e){}}).observe(t);}'
  + 'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();'
  + '})();</script>';

/** Watchlist / Saved sub-pages: same two elements hidden; their content column loses the rail margin. */
export const SUBPAGE_APP_SHELL_CSS = '<style id="mp-app-shell">'
  + '.zhead,.zrail{display:none!important}'
  + '.main{margin-left:0!important}'
  + '</style>';

/**
 * In the frame:
 *  1. Mirror the page's URL to the parent whenever the map rewrites it (it writes only via
 *     replaceState, from user actions), so /app's address carries the same view for reload/share.
 *  2. Hand same-origin link clicks to the parent instead of following them in the frame — the parent
 *     shows a map page (incl. Pursuits, Proposal, Reports, Vault, Forecasts, Market) in the frame and
 *     switches to the matching app tab for /app and /pricing, so a map action never leaves /app and the
 *     app never ends up nested inside itself. Any other same-origin page opens in a new tab. External
 *     links, new-tab clicks, `#` anchors and links whose own handler already called preventDefault
 *     behave exactly as before.
 *  3. window.open() of a map page or an app tab is routed the same way instead of opening a tab.
 * The parent also checks every frame load, which covers `location.href = …` navigations.
 */
export const APP_SHELL_JS = '<script>(function(){'
  + 'if(window.parent===window)return;'
  + 'var O=location.origin,IN=' + IN_APP_PATH_RE.toString() + ';'
  + 'function post(m){try{window.parent.postMessage(m,O);}catch(e){}}'
  + 'function url(){post({type:"' + MAP_SHELL_URL_MESSAGE + '",path:location.pathname,search:location.search});}'
  + 'var H=window.history,rs=H.replaceState,ps=H.pushState;'
  + 'H.replaceState=function(){var r=rs.apply(H,arguments);url();return r;};'
  + 'H.pushState=function(){var r=ps.apply(H,arguments);url();return r;};'
  + 'window.addEventListener("popstate",url);'
  + 'url();'
  // Selected SAM listing → parent (Ask Mindy chip). Wraps any prior __onSelectedOpp; close clears.
  + 'function postOpp(){var s=window.__selectedOpp;'
  +   'if(s&&typeof s.id==="string"&&/^[0-9a-f]{32}$/.test(s.id)){'
  +     'post({type:"' + MAP_SHELL_SELECTED_OPP_MESSAGE + '",id:s.id,title:String(s.title||""),deadline:String(s.deadline||"")});'
  +   '}else{post({type:"' + MAP_SHELL_SELECTED_OPP_MESSAGE + '",id:null,title:"",deadline:""});}}'
  + 'var _prevOnSel=window.__onSelectedOpp;'
  + 'window.__onSelectedOpp=function(){try{if(typeof _prevOnSel==="function")_prevOnSel();}catch(e){}postOpp();};'
  + 'postOpp();'
  + 'document.addEventListener("click",function(e){'
  +   'if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;'
  +   'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;'
  +   'if(a.hasAttribute("download"))return;'
  +   'var raw=a.getAttribute("href")||"";if(!raw||raw.charAt(0)==="#"||/^(javascript|mailto|tel):/i.test(raw))return;'
  +   'var u;try{u=new URL(raw,location.href);}catch(x){return;}'
  +   'if(u.origin!==O)return;'
  // A target="_blank" link to a map page or app tab ALSO stays in the app; any other new-tab link is untouched.
  +   'if(a.target&&a.target!=="_self"&&!IN.test(u.pathname))return;'
  +   'e.preventDefault();'
  +   'if(!IN.test(u.pathname)){try{window.open(u.href,"_blank","noopener");}catch(x){}return;}'
  +   'post({type:"' + MAP_SHELL_NAV_MESSAGE + '",path:u.pathname,search:u.search,hash:u.hash});'
  + '});'
  // Scripted new tabs (Generate proposal, Draft capture strategy, Pursuits after a save) open their
  // map page or app tab IN the app instead. Other URLs (a hosted report, SAM.gov) still open a tab.
  + 'var wo=window.open;'
  + 'window.open=function(href){'
  +   'try{var u=new URL(String(href||""),location.href);'
  +     'if(u.origin===O&&IN.test(u.pathname)){post({type:"' + MAP_SHELL_NAV_MESSAGE + '",path:u.pathname,search:u.search,hash:u.hash});return null;}'
  +   '}catch(x){}'
  +   'return wo.apply(window,arguments);'
  + '};'
  + '})();</script>';

/** Inject shell CSS (head) + JS (end of body) into a finished page. Function replacers: the strings carry `$`. */
export function applyAppShell(html: string, css: string): string {
  return html
    .replace('</head>', () => css + '</head>')
    .replace(/<\/body>(?![\s\S]*<\/body>)/, () => APP_SHELL_JS + '</body>');
}

/**
 * A SIGNED-IN customer who opens the standalone map (an old `/opportunity-map` bookmark, an alert
 * link) is sent to the same view inside the app (`/app?panel=map&…`), the signed-in product since
 * 2026-11-16. Before this, that bookmark kept showing the map with its own top bar and icon rail and
 * no app sidebar, so it read as an older version (call 2026-11-23: the rep had to tell a paying
 * customer to change the URL to /app). Signed-out visitors, crawlers, `?embed=` and `?shell=app`
 * (the app's own frame) are never redirected.
 *
 * The script is the SAME bytes for every standalone request (FROZEN Share Truth: the served page may
 * not vary with `src`/`sh`). It builds the /app address in the browser exactly as appUrlForMapUrl
 * does (map params kept verbatim, minus shell/embed/panel/mview — parity is unit-tested), and only
 * when it is the top window holding a live (decodable, unexpired) MI token — the same check the
 * map's own __tokenExpired makes. It reads the token; it never writes or clears it.
 */
export const SIGNED_IN_APP_REDIRECT_JS = '<script id="mp-app-redirect">(function(){try{'
  + 'if(window.top!==window.self)return;'
  + 'var t=localStorage.getItem("mi_beta_auth_token");if(!t)return;'
  + 'var s=String(t).split(".")[0].replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";'
  + 'var p=JSON.parse(atob(s));if(!p||typeof p!=="object")return;'
  + 'if(p.exp&&Number(p.exp)<Date.now())return;'
  + 'var drop={"' + SHELL_PARAM + '":1,embed:1,panel:1,' + MAP_VIEW_PARAM + ':1};'
  + 'var q=String(location.search||"").replace(/^\\?/,"").split("&").filter(function(x){'
  +   'if(!x)return false;var k=x.split("=")[0];try{k=decodeURIComponent(k.replace(/\\+/g," "));}catch(e){}'
  +   'return !drop.hasOwnProperty(k);});'
  + 'location.replace("/app?panel=map"+(q.length?"&"+q.join("&"):"")+(location.hash||""));'
  + '}catch(e){}})();</script>';

/** True when this map request is the standalone page (not the app's frame, not the static hero). */
export function isStandaloneMapRequest(url: URL): boolean {
  return !url.searchParams.has('embed') && !isAppShellRequest(url);
}

/** Put the redirect first in <head>, so a signed-in visitor leaves before the map boots. Unchanged page for shell/embed. */
export function applySignedInAppRedirect(html: string, url: URL): string {
  if (!isStandaloneMapRequest(url)) return html;
  return html.replace(/<head(\s[^>]*)?>/, (m) => m + SIGNED_IN_APP_REDIRECT_JS);
}

