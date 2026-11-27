/**
 * Ask Mindy on the Saved searches tab — the Watchlist page's side (ships OFF behind NEXT_PUBLIC_TAB_ASK).
 *
 * The Watchlist is a served HTML page shown inside /app in a same-origin iframe (MapShellPanel). The
 * Ask Mindy box lives in the app (React, canonical discovery parser); the page keeps its own list and its
 * own card renderer. This bridge adds exactly two things to the page, and ONLY when the feature is on
 * and the page is in the app shell:
 *   1. after each render it tells the app which saved searches it loaded (id, name, stored filters);
 *   2. it accepts "show only these ids" (or `null` = Clear) and re-renders with its OWN rowHtml — the
 *      same cards, sort and view; Clear restores the full list with no request.
 *
 * It works by replacing four exact anchors in the page. If any anchor is missing (the page changed) the
 * page is returned UNCHANGED — the feature fails off, never half-wired. A test pins every anchor.
 */
import { WATCHLIST_ASK_MESSAGE, WATCHLIST_SEARCHES_MESSAGE } from '@/lib/app/tab-ask-adapters/saved-searches';

const BRIDGE_STATE = [
  'var ASK_IDS=null, ASK_LOADED=false;',
  'function askKeep(arr){ if(!ASK_IDS)return arr; var keep={}; ASK_IDS.forEach(function(i){ keep[i]=1; }); return arr.filter(function(r){ return keep[String(r.id)]===1; }); }',
  'function askPostList(){ ASK_LOADED=true; if(!window.parent||window.parent===window)return; try{ window.parent.postMessage({type:' + JSON.stringify(WATCHLIST_SEARCHES_MESSAGE) + ',searches:SEARCHES.map(function(s){ return {id:String(s.id),name:s.name||"",filters:(s.filters&&typeof s.filters==="object")?s.filters:{}}; })}, location.origin); }catch(e){} }',
  'window.addEventListener("message",function(e){ if(e.origin!==location.origin||e.source!==window.parent)return; var d=e.data; if(!d||d.type!==' + JSON.stringify(WATCHLIST_ASK_MESSAGE) + ')return; ASK_IDS=Array.isArray(d.ids)?d.ids.map(String):null; if(ASK_LOADED)renderRows(); });',
].join(' ');

/** [anchor in the page, replacement]. Each anchor must occur exactly once. */
export const WATCHLIST_TAB_ASK_ANCHORS: ReadonlyArray<readonly [string, string]> = [
  ["var SORT='new', VIEW='list';", "var SORT='new', VIEW='list'; " + BRIDGE_STATE],
  ['function renderRows(){', 'function renderRows(){askPostList();'],
  [
    "var rowsHtml=sorted().map(rowHtml).join('');",
    "var askRows=askKeep(sorted()); var rowsHtml=askRows.map(rowHtml).join('');"
      + " if(ASK_IDS&&!askRows.length)rowsHtml='<div class=\"empty\"><h3>None of your saved searches match that question</h3><p>Clear it to see all of them.</p></div>';",
  ],
  [
    `'<div><h2>Your saved searches</h2><div class="ssub">Track the markets that matter to you.</div></div>'`,
    `'<div><h2>Your saved searches</h2><div class="ssub">'+(ASK_IDS?('Showing '+askRows.length+' of '+SEARCHES.length+' that match your question'):'Track the markets that matter to you.')+'</div></div>'`,
  ],
];

function countOf(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** The page with the bridge wired in, or the page UNCHANGED if any anchor is not found exactly once. */
export function applyWatchlistTabAsk(html: string): string {
  if (!WATCHLIST_TAB_ASK_ANCHORS.every(([a]) => countOf(html, a) === 1)) return html;
  let out = html;
  for (const [a, b] of WATCHLIST_TAB_ASK_ANCHORS) out = out.replace(a, () => b);
  return out;
}
