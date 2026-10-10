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
  // A FAILED save, in words the reader can act on — never a bare "Couldn't save". status = HTTP status
  // (0 = no response at all), d = the JSON body ({error, code}; null when the body was not JSON).
  // Returns {short} for the button and {detail} for the dialog. Every known service code is mapped.
  window.__saveSearchError=function(status,d){
    d=(d&&typeof d==='object')?d:{};
    var code=(typeof d.code==='string')?d.code:'', msg=(typeof d.error==='string')?d.error:'';
    if(status===0)return {short:'No connection',detail:'Couldn\u2019t reach Mindy, so nothing was saved. Check your connection and try again.'};
    if(status===401||status===403)return {short:'Sign in again',detail:'Your sign-in has expired, so nothing was saved. Sign in again, then click Save search.'};
    if(code==='unsupported_alert_scope')return {short:'Coming Back isn\u2019t emailed',detail:'Email alerts cover Open Now and Coming Soon. Coming Back contracts are not emailed \u2014 turn on Open Now or Coming Soon to save a watch, or open a Coming Back contract and use \u201cTrack this recompete\u201d.'};
    if(code==='no_deliverable_horizon')return {short:'Turn on Open Now or Coming Soon',detail:'Nothing selected on this map can be emailed. Turn on Open Now or Coming Soon, then save again. Coming Back contracts are not emailed.'};
    if(code==='profile_scope_unavailable')return {short:'Add NAICS to your profile',detail:'This search follows your profile\u2019s market, but your Mindy profile has no NAICS codes yet. Add at least one in Settings, then save again.'};
    if(code==='invalid_filters')return {short:'A filter can\u2019t be saved',detail:'One of the filters on this map can\u2019t be saved'+(msg?': '+msg:'.')+' Adjust it, then save again.'};
    if(code==='invalid_mode')return {short:'Switch to Opportunities',detail:'Save search works on the Opportunities map. Switch back to Opportunities, then save.'};
    if(code==='invalid_frequency')return {short:'Pick daily or weekly',detail:'Alerts can be daily or weekly. Choose one, then save again.'};
    if(code==='invalid_name'||(status===400&&/name.*required/i.test(msg)))return {short:'Name the search',detail:'Give this search a name, then save again.'};
    if(code==='scheduler_unavailable'||status===503)return {short:'Try again shortly',detail:'Saved searches are temporarily unavailable, so nothing was saved. Try again in a few minutes.'};
    return {short:'Couldn\u2019t save',detail:'Nothing was saved'+(msg?': '+msg:'.')+' Try again, or email support@getmindy.ai if it keeps happening.'};
  };
`;
