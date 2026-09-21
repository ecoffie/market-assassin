/**
 * Map-native Settings drawer (Homepage Readiness #34).
 *
 * The map's account menu used to send "Settings" to /app?panel=settings — a full leave into the
 * legacy React app (the "legacy escape hatch" that makes the map→homepage migration feel
 * unfinished). This drawer keeps the EVERYDAY, homepage-critical preferences on the map:
 *   • Alert frequency (daily / weekdays / weekends / weekly / paused)
 *   • Industry — NAICS codes
 *   • Keywords
 *   • Target agencies
 * Reuses the SAME APIs as /app: GET /api/alerts/preferences (read) + POST /api/app/profile (write,
 * the canonical persist path — respects normalizeNAICSForPersist, so it can't fan a prefix into a
 * whole family). Heavy / rare account-administration (Billing, Security, SMS, Team, Change email)
 * stays as explicit links to /app — deliberately NOT rebuilt here (Eric: keep those on the legacy
 * settings surface for now).
 *
 * Same string-module pattern as account-menu.ts: exported CSS/HTML/JS STRINGS with NO `$` and NO
 * template-literal `${}`, injected by the route via repl() (literal replacer). MI-token auth
 * (x-mi-auth-token) — the same mi_beta_auth_token every map fetch already uses.
 */

// ── CSS ─────────────────────────────────────────────────────────────────────
export const SETTINGS_DRAWER_CSS =
    '.mset-ov{position:fixed;inset:0;background:rgba(8,15,26,.42);z-index:3300;display:none;justify-content:flex-end}'
  + '.mset-ov.show{display:flex}'
  + '.mset{width:100%;max-width:440px;height:100%;background:#fff;box-shadow:-16px 0 48px -16px rgba(8,15,26,.4);display:flex;flex-direction:column;animation:msetin .22s cubic-bezier(.2,.9,.3,1)}'
  + '@keyframes msetin{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}'
  + '.mset-hd{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #eef1f5;flex:none}'
  + '.mset-hd h2{margin:0;font:800 18px Inter,system-ui,sans-serif;color:#101828;letter-spacing:-.01em}'
  + '.mset-x{width:32px;height:32px;border:0;background:transparent;color:#8894a2;font-size:22px;line-height:1;border-radius:8px;cursor:pointer}'
  + '.mset-x:hover{background:#f6f8fb}'
  + '.mset-bd{flex:1;overflow-y:auto;padding:8px 22px 22px}'
  + '.mset-sec{padding:18px 0;border-bottom:1px solid #f0f3f7}'
  + '.mset-sec:last-child{border-bottom:0}'
  + '.mset-sec h3{margin:0 0 3px;font:700 13.5px Inter,system-ui,sans-serif;color:#101828}'
  + '.mset-sec .hint{margin:0 0 12px;font:500 12.5px Inter,system-ui,sans-serif;color:#8894a2;line-height:1.45}'
  + '.mset-freq{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
  + '.mset-freq button{padding:11px 10px;border:1.5px solid #e3e8ee;background:#fff;border-radius:10px;font:600 13px Inter,system-ui,sans-serif;color:#3a4a58;cursor:pointer;text-align:left;transition:border-color .12s,background .12s}'
  + '.mset-freq button:hover{border-color:#c4cfda}'
  + '.mset-freq button.on{border-color:#2563eb;background:#eff5ff;color:#1d4ed8}'
  + '.mset-chips{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 10px}'
  + '.mset-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:#f2f5f9;border:1px solid #e3e8ee;border-radius:999px;font:600 12.5px Inter,system-ui,sans-serif;color:#243}'
  + '.mset-chip button{border:0;background:none;color:#8894a2;cursor:pointer;font-size:15px;line-height:1;padding:0;display:flex}'
  + '.mset-chip button:hover{color:#e5484d}'
  + '.mset-chip.empty{color:#8894a2;background:transparent;border:0;padding:2px 0;font-weight:500}'
  + '.mset-add{display:flex;gap:8px}'
  + '.mset-add input{flex:1;height:42px;border:1.5px solid #e3e8ee;border-radius:10px;padding:0 12px;font:500 14px Inter,system-ui,sans-serif;color:#1a2530;outline:none}'
  + '.mset-add input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.13)}'
  + '.mset-add button{flex:none;height:42px;padding:0 15px;border:0;border-radius:10px;background:#101828;color:#fff;font:700 13px Inter,system-ui,sans-serif;cursor:pointer}'
  + '.mset-add button:hover{filter:brightness(1.15)}'
  + '.mset-more{padding:16px 0 4px}'
  + '.mset-more .lbl{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#98a2b3;margin:0 0 8px}'
  + '.mset-more a{display:flex;align-items:center;justify-content:space-between;padding:11px 0;font:600 13.5px Inter,system-ui,sans-serif;color:#344054;text-decoration:none;border-top:1px solid #f0f3f7}'
  + '.mset-more a:hover{color:#101828}'
  + '.mset-more a .ext{color:#98a2b3;font:600 11px Inter,system-ui,sans-serif}'
  + '.mset-ft{flex:none;padding:14px 22px;border-top:1px solid #eef1f5;display:flex;align-items:center;gap:12px}'
  + '.mset-save{flex:1;height:46px;border:0;border-radius:11px;background:#2563eb;color:#fff;font:800 14.5px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 10px -3px rgba(37,99,235,.5)}'
  + '.mset-save:hover{filter:brightness(1.07)}.mset-save:disabled{opacity:.6;cursor:default}'
  + '.mset-status{font:600 12.5px Inter,system-ui,sans-serif;color:#0a8f57;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mset-status.err{color:#e5484d}'
  + '.mset-empty{padding:40px 22px;text-align:center;color:#8894a2;font:500 14px Inter,system-ui,sans-serif}'
  + '@media(max-width:520px){.mset{max-width:100%}}';

// ── HTML ────────────────────────────────────────────────────────────────────
// Frequency buttons mirror the 5 alert_frequency values (daily/weekdays/weekends/weekly/paused).
export const SETTINGS_DRAWER_HTML =
    '<div class="mset-ov" id="msetOv"><div class="mset" role="dialog" aria-modal="true" aria-label="Settings">'
  +   '<div class="mset-hd"><h2>Settings</h2><button class="mset-x" id="msetX" aria-label="Close">&times;</button></div>'
  +   '<div class="mset-bd" id="msetBd">'
  +     '<div class="mset-sec">'
  +       '<h3>Alert frequency</h3>'
  +       '<p class="hint">How often Mindy emails you new matching opportunities.</p>'
  +       '<div class="mset-freq" id="msetFreq">'
  +         '<button data-f="daily">Every day</button>'
  +         '<button data-f="weekdays">Weekdays only</button>'
  +         '<button data-f="mwf">Mon / Wed / Fri</button>'
  +         '<button data-f="tth">Tue / Thu</button>'
  +         '<button data-f="weekends">Weekends only</button>'
  +         '<button data-f="weekly">Weekly digest</button>'
  +         '<button data-f="paused">Paused</button>'
  +       '</div>'
  +     '</div>'
  +     '<div class="mset-sec">'
  +       '<h3>Industry &mdash; NAICS codes</h3>'
  +       '<p class="hint">The codes that define your market. Add 6-digit codes; we match opportunities against them.</p>'
  +       '<div class="mset-chips" id="msetNaics"></div>'
  +       '<div class="mset-add"><input type="text" id="msetNaicsIn" placeholder="e.g. 541512" inputmode="numeric" maxlength="6"><button id="msetNaicsAdd">Add</button></div>'
  +     '</div>'
  +     '<div class="mset-sec">'
  +       '<h3>Keywords</h3>'
  +       '<p class="hint">Catch opportunities the codes miss. A keyword matches the notice text.</p>'
  +       '<div class="mset-chips" id="msetKw"></div>'
  +       '<div class="mset-add"><input type="text" id="msetKwIn" placeholder="e.g. cybersecurity"><button id="msetKwAdd">Add</button></div>'
  +     '</div>'
  +     '<div class="mset-sec">'
  +       '<h3>Target agencies</h3>'
  +       '<p class="hint">Agencies you want to focus on. Leave empty to see all.</p>'
  +       '<div class="mset-chips" id="msetAg"></div>'
  +       '<div class="mset-add"><input type="text" id="msetAgIn" placeholder="e.g. Department of the Navy"><button id="msetAgAdd">Add</button></div>'
  +     '</div>'
  +     '<div class="mset-more">'
  +       '<p class="lbl">Account &amp; billing</p>'
  +       '<a href="/app?panel=settings&section=billing" target="_blank" rel="noopener">Billing &amp; plan<span class="ext">Open &#8599;</span></a>'
  +       '<a href="/app?panel=settings&section=security" target="_blank" rel="noopener">Security &amp; password<span class="ext">Open &#8599;</span></a>'
  +       '<a href="/app?panel=settings&section=notifications" target="_blank" rel="noopener">Text (SMS) alerts<span class="ext">Open &#8599;</span></a>'
  +       '<a href="/app?panel=settings&section=team" target="_blank" rel="noopener">Team &amp; workspace<span class="ext">Open &#8599;</span></a>'
  +     '</div>'
  +   '</div>'
  +   '<div class="mset-ft"><button class="mset-save" id="msetSave">Save changes</button><span class="mset-status" id="msetStatus"></span></div>'
  + '</div></div>';

// ── JS ──────────────────────────────────────────────────────────────────────
export const SETTINGS_DRAWER_JS = '<script>(function(){'
  + 'var ov=document.getElementById("msetOv");if(!ov)return;'
  + 'function tok(){try{return localStorage.getItem("mi_beta_auth_token");}catch(e){return null;}}'
  + 'function email(){try{var t=tok()||"";var s=t.split(".")[0].replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";var j=JSON.parse(atob(s));if(j&&j.email)return String(j.email).toLowerCase();}catch(e){}try{var b=localStorage.getItem("briefings_access_email");return b?b.toLowerCase().trim():"";}catch(e2){return "";}}'
  + 'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}'
  + 'var STATE={frequency:"daily",naics:[],keywords:[],agencies:[]};var loaded=false;'
  + 'var freqWrap=document.getElementById("msetFreq");'
  + 'var naicsWrap=document.getElementById("msetNaics"),kwWrap=document.getElementById("msetKw"),agWrap=document.getElementById("msetAg");'
  + 'var saveBtn=document.getElementById("msetSave"),statusEl=document.getElementById("msetStatus");'
  + 'function status(msg,isErr){statusEl.textContent=msg||"";statusEl.className="mset-status"+(isErr?" err":"");}'
  // Render one chip list (list of strings) into a container; kind is used for the remove handler.
  + 'function renderChips(wrap,arr,kind){if(!arr.length){wrap.innerHTML="<span class=\\"mset-chip empty\\">None yet</span>";return;}'
  +   'wrap.innerHTML=arr.map(function(v,i){return "<span class=\\"mset-chip\\">"+esc(v)+"<button data-k=\\""+kind+"\\" data-i=\\""+i+"\\" aria-label=\\"Remove\\">&times;</button></span>";}).join("");}'
  + 'function renderAll(){'
  +   'Array.prototype.forEach.call(freqWrap.querySelectorAll("button"),function(b){b.classList.toggle("on",b.getAttribute("data-f")===STATE.frequency);});'
  +   'renderChips(naicsWrap,STATE.naics,"naics");renderChips(kwWrap,STATE.keywords,"kw");renderChips(agWrap,STATE.agencies,"ag");}'
  + 'function arrFor(kind){return kind==="naics"?STATE.naics:kind==="kw"?STATE.keywords:STATE.agencies;}'
  // Remove chip (event-delegated so it works after re-render).
  + 'document.getElementById("msetBd").addEventListener("click",function(e){var b=e.target.closest("button[data-k]");if(!b)return;var a=arrFor(b.getAttribute("data-k"));a.splice(+b.getAttribute("data-i"),1);renderAll();});'
  // Frequency select.
  + 'freqWrap.addEventListener("click",function(e){var b=e.target.closest("button[data-f]");if(!b)return;STATE.frequency=b.getAttribute("data-f");renderAll();});'
  // Generic add-chip wiring: input + button, with de-dup + trim. NAICS also validates 6 digits.
  + 'function wireAdd(inId,btnId,kind,validate){var inp=document.getElementById(inId),btn=document.getElementById(btnId);function add(){var v=(inp.value||"").trim();if(!v)return;if(validate){var err=validate(v);if(err){status(err,true);return;}}var a=arrFor(kind);if(a.indexOf(v)<0)a.push(v);inp.value="";status("");renderAll();inp.focus();}btn.addEventListener("click",add);inp.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();add();}});}'
  + 'wireAdd("msetNaicsIn","msetNaicsAdd","naics",function(v){return /^[0-9]{2,6}$/.test(v)?"":"NAICS must be 2-6 digits.";});'
  + 'wireAdd("msetKwIn","msetKwAdd","kw",null);'
  + 'wireAdd("msetAgIn","msetAgAdd","ag",null);'
  // Load current settings from the SAME endpoint /app reads. Only fetch once per open session.
  + 'function load(){var em=email(),t=tok();if(!em||!t){document.getElementById("msetBd").innerHTML="<div class=\\"mset-empty\\">Sign in to manage your settings.</div>";saveBtn.style.display="none";return;}'
  +   'fetch("/api/alerts/preferences?email="+encodeURIComponent(em),{headers:{"x-mi-auth-token":t,"x-user-email":em}}).then(function(r){return r.ok?r.json():null;}).then(function(d){'
  // GET /api/alerts/preferences wraps the payload in `data` ({success, data:{naicsCodes,...}}).
  +     'var p=(d&&d.data)||d||{};'
  +     'STATE.frequency=p.frequency||p.alert_frequency||"daily";'
  +     'STATE.naics=(p.naicsCodes||p.naics_codes||[]).map(String);'
  +     'STATE.keywords=(p.keywords||[]).map(String);'
  +     'STATE.agencies=(p.targetAgencies||p.agencies||[]).map(String);'
  +     'loaded=true;renderAll();}).catch(function(){status("Could not load your settings.",true);});}'
  // Save via the canonical persist path (/api/app/profile). precise:true keeps 6-digit codes EXACT
  // (no prefix fan-out — the persist-vs-query rule). alertFrequency + targeting in one write.
  + 'saveBtn.addEventListener("click",function(){var em=email(),t=tok();if(!em||!t)return;'
  +   'saveBtn.disabled=true;var was=saveBtn.textContent;saveBtn.textContent="Saving\\u2026";status("");'
  +   'fetch("/api/app/profile",{method:"POST",headers:{"Content-Type":"application/json","x-mi-auth-token":t,"x-user-email":em},'
  +     'body:JSON.stringify({email:em,naicsCodes:STATE.naics,keywords:STATE.keywords,targetAgencies:STATE.agencies,alertFrequency:STATE.frequency,precise:true})})'
  +   '.then(function(r){return r.json().catch(function(){return {};});}).then(function(d){'
  +     'saveBtn.disabled=false;saveBtn.textContent=was;'
  +     'if(d&&(d.success||d.ok||!d.error)){status("\\u2713 Saved");setTimeout(function(){status("");},2600);}'
  +     'else{status((d&&d.error)||"Save failed \\u2014 try again.",true);}'
  +   '}).catch(function(){saveBtn.disabled=false;saveBtn.textContent=was;status("Network error \\u2014 try again.",true);});});'
  // Open/close. Public entry — the account menu calls window.openSettingsDrawer().
  + 'function open(){ov.classList.add("show");if(!loaded)load();}function close(){ov.classList.remove("show");}'
  + 'window.openSettingsDrawer=open;'
  + 'document.getElementById("msetX").addEventListener("click",close);'
  + 'ov.addEventListener("click",function(e){if(e.target===ov)close();});'
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape"&&ov.classList.contains("show"))close();});'
  + '})();</script>';
