/**
 * MAP FILTERS → WATCH FILTERS (P0b, 2026-11-14).
 *
 * The Map's Save button used to copy EVERY active map filter into the saved search. The server
 * accepts only the keys the alert engine can apply (ALLOWED_SAVED_SEARCH_FILTER_KEYS), so any of
 * 11 map-only keys refused the whole save. Measured: 7 signed-in users never got their watch.
 *
 * The server rule stays strict. The client now plans the payload in three groups:
 *
 *   translated — same meaning, different spelling. The map's OWN viewport request already sends
 *                setAside=merge(setAside, setAsideMulti) and noticeType=merge(noticeType,
 *                noticeMulti) (route.ts _buildOppUrl), and the viewport API and the alert cron
 *                share applyMapFilters. So the watch matches exactly what the map showed.
 *   excluded   — filters the alert engine cannot apply. Every one of them narrows something alerts
 *                never cover: Coming Back contracts (never emailed), the Buyers view, or DLA pins.
 *                Leaving them out does NOT change which emailed opportunities match — but they are
 *                still only left out after the customer confirms (never silently).
 *   everything else passes through untouched, so an unknown key is still refused by the server.
 *
 * map-watch-filter-parity.unit.test.ts fails the build if the Map gains a filter key that is in
 * none of: the server allowlist, MAP_TO_WATCH_TRANSLATED, MAP_ONLY_WATCH_EXCLUDED.
 */
export const MAP_TO_WATCH_TRANSLATED: Readonly<Record<string, string>> = {
  setAsideMulti: 'setAside',
  noticeMulti: 'noticeType',
};

/** Map-only filters the alert engine cannot apply, with the label the Filters panel shows. */
export const MAP_ONLY_WATCH_EXCLUDED: Readonly<Record<string, string>> = {
  valueRange: 'Contract value',
  sap: 'Buying style',
  likelihood: 'Recompete likelihood',
  leadMax: 'Expiring within',
  vehicle: 'Contract vehicle',
  parent: 'Parent contract',
  work: 'Work subject',
  office: 'Buying office',
  fsc: 'DLA Supply Class (FSC)',
};

/** Customer labels for watch filter keys, used when the server refuses one by name. */
export const WATCH_FILTER_LABELS: Readonly<Record<string, string>> = {
  q: 'Search words',
  naics: 'Industry (NAICS)',
  psc: 'Product or service code',
  agency: 'Agency',
  subAgency: 'Sub-agency',
  state: 'State',
  country: 'Country',
  setAside: 'Set-aside',
  noticeType: 'Notice type',
  strategy: 'Strategy',
  closingDays: 'Closing within',
  postedDays: 'Posted within',
  sapBuyer: 'Buyer type',
  status: 'Status',
  scope: 'Market scope',
  ...MAP_ONLY_WATCH_EXCLUDED,
};

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
 * The three ${JSON.stringify(...)} lines at the top are evaluated by TypeScript when this module
 * loads; the emitted script text contains neither backticks nor `${`.
 */
export const WATCH_SCOPE_JS = `
  var __WATCH_TRANSLATED=${JSON.stringify(MAP_TO_WATCH_TRANSLATED)};
  var __WATCH_EXCLUDED=${JSON.stringify(MAP_ONLY_WATCH_EXCLUDED)};
  var __WATCH_LABELS=${JSON.stringify(WATCH_FILTER_LABELS)};
  // Plan the saved payload from the live map state. Returns {filters, excluded:[keys]}. Never drops a
  // filter on its own: excluded keys are returned so the caller can ask the customer first.
  window.__watchFilterPlan=function(filt,q){
    filt=(filt&&typeof filt==='object')?filt:{};
    var out={}, excluded=[];
    function has(v){ return !!v&&v!=='all'&&!(v&&typeof v==='object'&&typeof v.length==='number'&&v.length===0); }
    for(var k in filt){
      if(!Object.prototype.hasOwnProperty.call(filt,k))continue;
      var v=filt[k]; if(!has(v))continue;
      if(Object.prototype.hasOwnProperty.call(__WATCH_EXCLUDED,k)){ excluded.push(k); continue; }
      if(Object.prototype.hasOwnProperty.call(__WATCH_TRANSLATED,k)){
        var to=__WATCH_TRANSLATED[k], add=String(v).split(',').map(function(x){return x.trim();}).filter(Boolean);
        var cur=has(out[to])?String(out[to]).split(',').map(function(x){return x.trim();}).filter(Boolean):[];
        for(var i=0;i<add.length;i++){ if(cur.indexOf(add[i])<0)cur.push(add[i]); }
        if(cur.length)out[to]=cur.join(',');
        continue;
      }
      if(has(out[k])&&typeof out[k]==='string'&&typeof v==='string'){
        var a=out[k].split(','), b=v.split(','); for(var j=0;j<b.length;j++){ if(a.indexOf(b[j])<0)a.push(b[j]); } out[k]=a.join(',');
      } else out[k]=v;
    }
    if(q)out.q=q;
    return {filters:out, excluded:excluded};
  };
  window.__watchFilterLabel=function(k){ return Object.prototype.hasOwnProperty.call(__WATCH_LABELS,k)?__WATCH_LABELS[k]:'a filter'; };
  // The confirm shown before a watch is saved without map-only filters.
  window.__watchExcludedPrompt=function(keys){
    var names=[]; for(var i=0;i<keys.length;i++)names.push(window.__watchFilterLabel(keys[i]));
    return 'Email alerts can\u2019t use '+names.join(', ')+'. '
      +(keys.length>1?'These filters only narrow':'This filter only narrows')
      +' views alerts don\u2019t cover (Coming Back contracts, buyers, or DLA supply bids), so the watch will match the same opportunities without '
      +(keys.length>1?'them':'it')+'.\\n\\nSave the watch without '+(keys.length>1?'them':'it')+'? Your map stays as it is.';
  };
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
    // invalid_filters: the server's own message is written for AI agents ("ask the user to adjust"), so it is
    // NEVER shown here. The reason + refused key NAMES (additive fields) pick the customer copy.
    if(code==='invalid_filters'){
      var reason=(typeof d.reason==='string')?d.reason:'';
      var keys=Array.isArray(d.refused_keys)?d.refused_keys.filter(function(k){return typeof k==='string';}):[];
      var names=[]; for(var i=0;i<keys.length;i++){ var lb=window.__watchFilterLabel?window.__watchFilterLabel(keys[i]):'a filter'; if(names.indexOf(lb)<0)names.push(lb); }
      var named=names.length?names.join(', '):'One of the filters on this map';
      named=named.charAt(0).toUpperCase()+named.slice(1);
      if(reason==='no_narrowing')return {short:'Narrow the map first',detail:'This map shows the whole federal market, which is too broad to watch. Search for a word, place or agency, or pick an industry in Filters, then save again.'};
      if(reason==='unsupported_keys')return {short:'A filter can\u2019t be watched',detail:named+' can\u2019t be used in email alerts. Remove '+(names.length>1?'them':'it')+' in Filters, then save again.'};
      if(reason==='invalid_naics')return {short:'Check the industry code',detail:'One of the industry codes on this map isn\u2019t a recognized NAICS code. Check it in Filters, then save again.'};
      if(reason==='invalid_value'||reason==='invalid_strategy')return {short:'Check a filter',detail:named+' has a value Mindy can\u2019t save. Change it in Filters, then save again.'};
      return {short:'A filter can\u2019t be saved',detail:'One of the filters on this map can\u2019t be saved. Adjust your filters, then save again.'};
    }
    if(code==='invalid_mode')return {short:'Switch to Opportunities',detail:'Save search works on the Opportunities map. Switch back to Opportunities, then save.'};
    if(code==='invalid_frequency')return {short:'Pick daily or weekly',detail:'Alerts can be daily or weekly. Choose one, then save again.'};
    if(code==='invalid_name'||(status===400&&/name.*required/i.test(msg)))return {short:'Name the search',detail:'Give this search a name, then save again.'};
    if(code==='scheduler_unavailable'||status===503)return {short:'Try again shortly',detail:'Saved searches are temporarily unavailable, so nothing was saved. Try again in a few minutes.'};
    // Unexpected failure: a server message can be technical, so it is not shown. Telemetry has the code.
    return {short:'Couldn\u2019t save',detail:'Nothing was saved. Try again, or email admin@getmindy.ai if it keeps happening.'};
  };
  // What a failed save records: status, code, reason and refused key NAMES (validated, capped). Never values.
  window.__saveSearchFailEvent=function(status,d){
    d=(d&&typeof d==='object')?d:{};
    var keys=Array.isArray(d.refused_keys)?d.refused_keys:[], safe=[];
    for(var i=0;i<keys.length&&safe.length<10;i++){ if(typeof keys[i]==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(keys[i]))safe.push(keys[i]); }
    var reason=(typeof d.reason==='string'&&/^[a-z_]{1,40}$/.test(d.reason))?d.reason:'';
    return {status:status,code:(typeof d.code==='string'&&/^[a-z_]{1,40}$/.test(d.code))?d.code:'',reason:reason,refused_keys:safe.join(',')};
  };
`;
