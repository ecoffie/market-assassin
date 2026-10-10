/**
 * What a signed-in "Save search" on the Opportunity Map can actually WATCH.
 *
 * The map boots with every horizon on (open + recompete + forecast), and the
 * saved-search service rejects any recompete request with
 * `unsupported_alert_scope`, because the saved-search-alerts cron has no
 * recompete corpus. So the default map could never be saved: a signed-in click
 * sent `horizons.recompete=true`, got a 400, and the button said "Couldn't save".
 *
 * The service rule is right and stays: Mindy never silently emails a corpus the
 * user did not ask for, and never pretends to email one it cannot. The fix is
 * on the client, and it is a DISCLOSED narrowing, not a silent one:
 *
 *   full    — nothing to narrow; save exactly what is on screen.
 *   partial — recompete is on alongside open and/or forecast. Ask the user to
 *             save a watch for the deliverable horizons only, saying plainly
 *             that recompetes are not emailed. Saved with recompete=false.
 *   none    — only recompete is on (or the legacy recompete dataset). Nothing
 *             can be emailed, so nothing is saved; the user is told why.
 *
 * The map's own horizon toggles are never touched — only the saved payload.
 *
 * Plain ES5 in a string because it is inlined into the map's client script
 * (a TS template literal: no backticks, no `${`). Tests evaluate the same string.
 */
export const WATCH_SCOPE_JS = `
  window.__watchScopePlan=function(mode,h){
    h=(h&&typeof h==='object')?h:{};
    var comingBack=(mode==='recompete')||h.recompete===true;
    var open=(mode!=='recompete')&&h.open!==false;
    var forecast=h.forecast===true;
    if(mode==='recompete'||(!open&&!forecast)){
      return {kind:'none',comingBack:comingBack,horizons:null};
    }
    return {kind:comingBack?'partial':'full',comingBack:comingBack,
            horizons:{open:open,recompete:false,forecast:forecast}};
  };
`;
