/**
 * THE ONE Maps sign-in modal. Extracted from opportunity-map/route.ts 2026-08-23.
 *
 * WHY IT MOVED: the modal existed ONLY on the map. The eight Maps sub-routes — saved,
 * favorites, pursuits, reports, market, forecasts, vault, proposal — each rendered
 * `Please <a href="/app?next=…">sign in</a>`, so an anonymous or expired visitor to any of
 * them was hard-dumped into the LEGACY /app. One modal, injected everywhere, instead of
 * eight auth experiences.
 *
 * ⚠️ THIS DOES NOT CHANGE ANY ROUTE'S ACCESS CONTRACT. All eight are ENTRY-GATED today
 * (`if(!t||!em)` at load, replacing the body) because they show the visitor's OWN data —
 * their saved list, their pursuits, their vault. That stays exactly as it is. This swaps the
 * DESTINATION of the sign-in affordance from /app to the in-page modal; it does not make any
 * route more open, and it does not make any route more closed.
 *
 * CONTRACT:  window.openSignInModal(actionPhrase, onSuccess)
 *   actionPhrase — completes "Sign in to ___" ("see your pursuits", "open your Company Vault")
 *   onSuccess    — resume callback. Defaults to location.reload(), which is the right resume
 *                  for an entry-gated page: the page re-renders with the session present.
 *                  Action-level callers pass a real resume so no partial state is lost.
 *
 * Inject all three into a page: CSS in <head>, HTML + JS before </body>.
 */

export const LOGIN_MODAL_CSS =
    '.lgm-ov{position:fixed;inset:0;background:rgba(8,15,26,.5);z-index:3200;display:none;align-items:center;justify-content:center;padding:24px}'
  + '.lgm-ov.show{display:flex}'
  + '.lgm{width:100%;max-width:392px;background:#fff;border-radius:14px;position:relative;box-shadow:0 24px 60px -14px rgba(8,15,26,.42),0 0 0 1px rgba(8,15,26,.05);animation:lgmpop .2s cubic-bezier(.2,.9,.3,1.2)}'
  + '@keyframes lgmpop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}'
  + '.lgm-x{position:absolute;top:12px;right:13px;width:32px;height:32px;border:0;background:transparent;color:#8894a2;font-size:21px;line-height:1;border-radius:8px;cursor:pointer}'
  + '.lgm-x:hover{background:#f6f8fb}'
  + '.lgm-in{padding:30px 30px 26px}'
  + '.lgm-brand{display:flex;align-items:center;gap:8px;font:800 19px Inter,system-ui,sans-serif;color:#0b1220;margin-bottom:20px}'
  + '.lgm-brand b{width:24px;height:19px;border-radius:4px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:inline-block}'
  + '.lgm h2{font:800 21px Inter,system-ui,sans-serif;letter-spacing:-.02em;margin:0 0 4px;color:#1a2530}'
  + '.lgm-fly{margin:0 0 20px;color:#6b7787;font:500 13.5px/1.5 Inter,system-ui,sans-serif}.lgm-fly b{color:#1a2530;font-weight:700}'
  // ── PLAYERS UNLOCK PANEL — the FIRST PAYWALL MOMENT. Aspirational, not restrictive: it shows
  // what is behind the wall (blurred, so the value is SEEN not described) rather than refusing.
  + '.pu-h{margin:0 0 6px;font:800 21px/1.25 Inter,system-ui,sans-serif;color:#0f1e2e;letter-spacing:-.01em}'
  + '.pu-sub{margin:0 0 16px;color:#6b7787;font:500 13.5px/1.5 Inter,system-ui,sans-serif}'
  + '.pu-wrap{position:relative;border:1px solid #e4e9ee;border-radius:12px;overflow:hidden;margin:0 0 18px;background:#fbfcfd}'
  + '.pu-list{padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:9px 14px}'
  + '@media(max-width:520px){.pu-list{grid-template-columns:1fr}}'
  + '.pu-row{display:flex;align-items:center;gap:9px;font:600 13px/1.3 Inter,system-ui,sans-serif;color:#1a2530}'
  + '.pu-row svg{flex:0 0 15px;color:#0a8f57}'
  // The blurred strip: a REAL preview of the record shape, unreadable on purpose.
  + '.pu-blur{padding:12px 16px 14px;border-top:1px solid #eef1f4;filter:blur(4.5px);user-select:none;pointer-events:none;opacity:.75}'
  + '.pu-brow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px}'
  + '.pu-bk{font:600 11px/1 Inter,system-ui,sans-serif;color:#8b98a8;text-transform:uppercase;letter-spacing:.05em}'
  + '.pu-bv{height:9px;border-radius:5px;background:linear-gradient(90deg,#c8d2dc,#e2e8ee);flex:1;max-width:190px}'
  + '.pu-oauth{display:flex;flex-direction:column;gap:8px;margin:0 0 14px}'
  + '.pu-btn{display:flex;align-items:center;justify-content:center;gap:9px;padding:11px 14px;border:1px solid #d8dee6;border-radius:10px;background:#fff;color:#1a2530;font:600 14px/1 Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer}'
  + '.pu-btn:hover{background:#f6f8fa;border-color:#c3ccd6}'
  + '.pu-or{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:#98a4b2;font:600 11px/1 Inter,system-ui,sans-serif}'
  + '.pu-or:before,.pu-or:after{content:"";flex:1;height:1px;background:#e6ebf0}'
  + '.pu-foot{margin:14px 0 0;color:#8b98a8;font:500 12.5px/1.5 Inter,system-ui,sans-serif;text-align:center}'
  + '.lgm label{display:block;font:700 12.5px Inter,system-ui,sans-serif;color:#3a4a58;margin:0 0 7px 1px}'
  + '.lgm input{width:100%;height:48px;border:1.5px solid #e3e8ee;border-radius:11px;padding:0 14px;font:500 15px Inter,system-ui,sans-serif;color:#1a2530;outline:none;transition:border-color .12s,box-shadow .12s}'
  + '.lgm input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.14)}'
  + '.lgm-cta{width:100%;height:48px;margin-top:16px;border:0;border-radius:11px;background:#2563eb;color:#fff;font:800 15px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 10px -3px rgba(37,99,235,.5);transition:filter .12s}'
  + '.lgm-cta:hover{filter:brightness(1.07)}.lgm-cta:disabled{opacity:.6;cursor:default}'
  + '.lgm-create{margin:16px 0 0;font:500 13.5px Inter,system-ui,sans-serif;color:#6b7787}.lgm-create a{color:#2563eb;font-weight:700;text-decoration:none;cursor:pointer}'
  + '.lgm-div{display:flex;align-items:center;gap:12px;margin:22px 0;color:#9aa7b4;font:700 11px Inter,system-ui,sans-serif;letter-spacing:.08em}'
  + '.lgm-div::before,.lgm-div::after{content:"";flex:1;height:1px;background:#e3e8ee}'
  + '.lgm-oauth{display:flex;flex-direction:column;gap:10px}'
  + '.lgm-oauth button{display:flex;align-items:center;justify-content:center;gap:11px;height:47px;border:1.5px solid #e3e8ee;background:#fff;border-radius:11px;font:700 14.5px Inter,system-ui,sans-serif;color:#243;cursor:pointer;transition:border-color .12s,background .12s}'
  + '.lgm-oauth button:hover{border-color:#c4cfda;background:#f6f8fb}.lgm-oauth svg{width:19px;height:19px;flex:none}'
  + '.lgm-fine{margin:20px 0 0;text-align:center;color:#9aa7b4;font:500 11.5px/1.5 Inter,system-ui,sans-serif}.lgm-fine a{color:#7b8794;text-decoration:underline}'
  + '.lgm-back{display:flex;align-items:center;gap:8px;margin:0 0 16px;color:#6b7787;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}.lgm-back svg{width:15px;height:15px}'
  + '.lgm-chip{font:600 13px Inter,system-ui,sans-serif;color:#1a2530}'
  + '.lgm-forgot{display:block;margin:12px 1px 0;font:700 12.5px Inter,system-ui,sans-serif;color:#2563eb;text-decoration:none;cursor:pointer}'
  + '.lgm-err{margin:12px 0 0;color:#c0392b;font:600 13px Inter,system-ui,sans-serif}'
  + '.lgm-step2{display:none}'
  + '.lgm-ok{width:52px;height:52px;margin:2px auto 14px;border-radius:50%;background:#eafaf1;color:#15a34a;display:flex;align-items:center;justify-content:center}.lgm-ok svg{width:26px;height:26px}';

export const LOGIN_MODAL_HTML =
    '<div class="lgm-ov" id="lgmOv"><div class="lgm" role="dialog" aria-modal="true" aria-label="Sign in">'
  +   '<button class="lgm-x" id="lgmX" aria-label="Close">&times;</button>'
  +   '<div class="lgm-in">'
  +     '<div class="lgm-brand"><b></b>Mindy</div>'
        // STEP 1 — email-first
  +     '<div class="lgm-step1" id="lgmStep1">'
  +       '<div id="lgmUnlock"></div>'   // Players fills this; empty (and invisible) for every other gated action
  +       '<h2 id="lgmH1">Sign in</h2>'
  +       '<p class="lgm-fly" id="lgmFly"><b>Browsing is free.</b> Sign in to draft, save, and reach the players.</p>'
  +       '<label for="lgmEmail">Email</label>'
  +       '<input type="email" id="lgmEmail" placeholder="you@company.com" autocomplete="email">'
  +       '<div class="lgm-err" id="lgmErr1" style="display:none"></div>'
  +       '<button class="lgm-cta" id="lgmCont">Continue</button>'
  +       '<p class="lgm-create">New to Mindy? <a id="lgmCreate">Create a free account</a></p>'
  +       '<div class="lgm-div">OR</div>'
  +       '<div class="lgm-oauth">'
  +         '<button id="lgmGoogle"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"/></svg>Continue with Google</button>'
  +         '<button id="lgmMs"><svg viewBox="0 0 24 24"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>Continue with Microsoft</button>'
  +       '</div>'
  +       '<p class="lgm-fine">By continuing you accept Mindy&#39;s <a href="/terms" target="_blank">Terms</a> &amp; <a href="/privacy" target="_blank">Privacy</a>.</p>'
  +     '</div>'
        // STEP 2 — password
  +     '<div class="lgm-step2" id="lgmStep2">'
  +       '<div class="lgm-back" id="lgmBack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>Back</div>'
  +       '<h2 id="lgmS2Title">Welcome back</h2>'
  +       '<p class="lgm-fly">Signing in as <span class="lgm-chip" id="lgmEmailChip"></span></p>'
  +       '<label for="lgmPass">Password</label>'
  +       '<input type="password" id="lgmPass" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password">'
  +       '<a class="lgm-forgot" id="lgmForgot">Forgot password?</a>'
  +       '<div class="lgm-err" id="lgmErr2" style="display:none"></div>'
  +       '<button class="lgm-cta" id="lgmSignin">Sign in</button>'
  +       '<p class="lgm-create" style="text-align:center;margin-top:18px" id="lgmSetupRow">No password yet? <a id="lgmSetup">Set up my account</a></p>'
  +     '</div>'
        // STEP 3 — create a free account (name + email; password is set via the emailed setup link)
  +     '<div class="lgm-step3" id="lgmStep3" style="display:none">'
  +       '<div class="lgm-back" id="lgmBack3"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>Back</div>'
  +       '<h2>Create your free account</h2>'
  +       '<p class="lgm-fly"><b>Free forever.</b> Daily opportunities, market research, and saved searches &mdash; no card required.</p>'
  +       '<label for="lgmSuName">Name</label>'
  +       '<input type="text" id="lgmSuName" placeholder="Jane Contractor" autocomplete="name">'
  +       '<label for="lgmSuEmail" style="margin-top:14px">Work email</label>'
  +       '<input type="email" id="lgmSuEmail" placeholder="you@company.com" autocomplete="email">'
  +       '<div class="lgm-err" id="lgmErr3" style="display:none"></div>'
  +       '<button class="lgm-cta" id="lgmSuBtn">Continue</button>'
  +       '<p class="lgm-create" style="text-align:center;margin-top:16px">Already have an account? <a id="lgmToSignin">Sign in</a></p>'
  +     '</div>'
        // STEP 4 — signup success. Outcome-first ("your work is saved"), NOT a chore ("go do this").
        // Explains WHY (verify email, ~30s), lets them keep browsing, and the pending action is queued
        // to complete automatically when they return via the setup link.
  +     '<div class="lgm-step4" id="lgmStep4" style="display:none;text-align:center">'
  +       '<div class="lgm-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>'
  +       '<h2 id="lgmOkTitle">Your account has been created</h2>'
  +       '<p class="lgm-fly" id="lgmOkMsg" style="text-align:center">One last step &mdash; we verify your email before saving your opportunities. It takes about 30&nbsp;seconds. We&#39;ve emailed you a secure setup link.</p>'
  +       '<p class="lgm-fly" id="lgmOkResume" style="text-align:center;color:#1a2530"><b>Your work is safe.</b> When you finish setup, what you saved will already be waiting for you here.</p>'
  +       '<button class="lgm-cta" id="lgmOkDone">Continue browsing</button>'
  +       '<p class="lgm-create" style="text-align:center;margin-top:14px">Didn&#39;t get it? <a id="lgmResend">Resend email</a></p>'
  +     '</div>'
  +   '</div>'
  +   '</div>'
  + '</div>';

export const LOGIN_MODAL_JS = `<script>(function(){
  var ov=document.getElementById('lgmOv');
  if(!ov) return;
  var s1=document.getElementById('lgmStep1'), s2=document.getElementById('lgmStep2');
  var s3=document.getElementById('lgmStep3'), s4=document.getElementById('lgmStep4');
  var emailIn=document.getElementById('lgmEmail'), passIn=document.getElementById('lgmPass');
  var suName=document.getElementById('lgmSuName'), suEmail=document.getElementById('lgmSuEmail'), suBtn=document.getElementById('lgmSuBtn');
  var fly=document.getElementById('lgmFly'), chip=document.getElementById('lgmEmailChip');
  var err1=document.getElementById('lgmErr1'), err2=document.getElementById('lgmErr2'), err3=document.getElementById('lgmErr3');
  var cont=document.getElementById('lgmCont'), signin=document.getElementById('lgmSignin');
  var setupRow=document.getElementById('lgmSetupRow');
  var _resume=null;      // in-memory callback to re-run the gated action after an in-page sign-in
  var _phrase='';        // the action phrase ("save this to your pursuits") — persisted with the queued intent
  var _signedUpEmail=''; // email used in the signup step (for Resend)

  function showErr(el,msg){ if(!el)return; el.textContent=msg||''; el.style.display=msg?'block':'none'; }
  // 4 steps: 1 email · 2 password · 3 create-account · 4 signup-success.
  function step(n){
    if(s1)s1.style.display=n===1?'block':'none';
    if(s2)s2.style.display=n===2?'block':'none';
    if(s3)s3.style.display=n===3?'block':'none';
    if(s4)s4.style.display=n===4?'block':'none';
  }
  function close(){ ov.classList.remove('show'); showErr(err1,''); showErr(err2,''); showErr(err3,''); }
  function open(){ ov.classList.add('show'); step(1); setTimeout(function(){ emailIn&&emailIn.focus(); },60); }

  // Preserve the caller's intent + a resume callback. next= keeps OAuth's return landing here.
  window.openSignInModal=function(phrase,onSuccess){
    _phrase = phrase||'';
    _resume = (typeof onSuccess==='function') ? onSuccess : function(){ location.reload(); };
    if(fly) fly.innerHTML='<b>Browsing is free.</b> Sign in to '+(phrase||'draft, save, and reach the players')+'.';
    open();
  };

  cont && cont.addEventListener('click', function(){
    var em=(emailIn.value||'').trim().toLowerCase();
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){ showErr(err1,'Enter a valid email.'); return; }
    showErr(err1,''); chip.textContent=em; if(setupRow)setupRow.style.display='none';
    step(2); setTimeout(function(){ passIn&&passIn.focus(); },60);
  });
  emailIn && emailIn.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); cont.click(); } });

  function doLogin(){
    var em=(emailIn.value||'').trim().toLowerCase(), pw=passIn.value||'';
    if(!pw){ showErr(err2,'Enter your password.'); return; }
    showErr(err2,''); signin.disabled=true; var was=signin.textContent; signin.textContent='Signing in\\u2026';
    fetch('/api/auth/mindy-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})})
      .then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(d){
        signin.disabled=false; signin.textContent=was;
        if(!d||!d.success){
          // No account yet → point to the setup path (email-only beta users have no password).
          if(d&&d.needsAccountSetup&&setupRow) setupRow.style.display='block';
          showErr(err2,(d&&d.error)||'Could not sign in. Check your password.');
          return;
        }
        // Paid-MFA: server verified the password but wants a 2FA code (already emailed). The modal
        // doesn't do the code step yet — hand off to /app which owns that flow, preserving return.
        if(d.mfaRequired){ location.href='/app?next='+encodeURIComponent(location.pathname+location.search)+'&email='+encodeURIComponent(em); return; }
        try{ localStorage.setItem('mi_beta_auth_token',d.sessionToken); if(d.authenticatedAt)localStorage.setItem('mi_beta_authenticated_at',d.authenticatedAt); }catch(e){}
        close();
        var cb=_resume; _resume=null; if(cb) try{ cb(); }catch(e){}
      })
      .catch(function(){ signin.disabled=false; signin.textContent=was; showErr(err2,'Network error — try again.'); });
  }
  signin && signin.addEventListener('click', doLogin);
  passIn && passIn.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); doLogin(); } });

  // OAuth + setup + create + forgot all hand off to /app (OAuth can't complete inside the modal —
  // it redirects to the provider), preserving a same-page return so the user lands back here.
  function toApp(extra){ var n=encodeURIComponent(location.pathname+location.search); location.href='/app?next='+n+(extra||''); }
  var g=document.getElementById('lgmGoogle'); g&&g.addEventListener('click',function(){ toApp('&oauth=google'); });
  var ms=document.getElementById('lgmMs'); ms&&ms.addEventListener('click',function(){ toApp('&oauth=microsoft'); });
  // "Create a free account" now stays IN the modal (Step 3) — no page leave. Prefill the email if typed.
  var cr=document.getElementById('lgmCreate'); cr&&cr.addEventListener('click',function(){
    if(suEmail && emailIn && emailIn.value) suEmail.value=emailIn.value;
    step(3); setTimeout(function(){ var f=(suName&&!suName.value)?suName:suEmail; f&&f.focus(); },60);
  });
  var su=document.getElementById('lgmSetup'); su&&su.addEventListener('click',function(){ toApp('&setup=1&email='+encodeURIComponent((emailIn.value||'').trim().toLowerCase())); });
  var fg=document.getElementById('lgmForgot'); fg&&fg.addEventListener('click',function(){ toApp('&forgot=1&email='+encodeURIComponent((emailIn.value||'').trim().toLowerCase())); });

  // ── Step 3: create a free account (email-first; password set via the emailed setup link).
  // The pending action (Save/Pursuit) is QUEUED to localStorage BEFORE the email round-trip, so it
  // completes automatically when the user returns via the setup link — the intent is never lost.
  function queueIntent(em){
    try{
      var q=[]; try{ q=JSON.parse(localStorage.getItem('mindy_pending_intents')||'[]')||[]; }catch(e){}
      if(!Array.isArray(q))q=[];
      q.push({ path:location.pathname+location.search, phrase:_phrase||'', email:em, ts:Date.now() });
      var cut=Date.now()-864e5; q=q.filter(function(x){return x&&x.ts&&x.ts>cut;}).slice(-10); // last 10, 24h
      localStorage.setItem('mindy_pending_intents', JSON.stringify(q));
    }catch(e){}
  }
  function doSignup(){
    var em=(suEmail.value||'').trim().toLowerCase();
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){ showErr(err3,'Enter a valid work email.'); return; }
    showErr(err3,''); suBtn.disabled=true; var was=suBtn.textContent; suBtn.textContent='Creating\\u2026';
    var payload={ email:em, name:(suName&&suName.value||'').trim() };
    try{ var a=localStorage.getItem('gca_attribution'); if(a)payload.attribution=JSON.parse(a); }catch(e){}
    fetch('/api/auth/mindy-signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(d){
        suBtn.disabled=false; suBtn.textContent=was;
        if(!d||!d.success){ showErr(err3,(d&&d.error)||'Could not create your account. Try again.'); return; }
        _signedUpEmail=em;
        queueIntent(em);                                        // intent now safe across the email round-trip
        try{ localStorage.setItem('briefings_access_email',em); }catch(e){} // return-boot knows who they are
        var resPhrase=document.getElementById('lgmOkResume');
        if(resPhrase) resPhrase.innerHTML='<b>Your work is safe.</b> When you finish setup, what you saved will already be waiting for you here.';
        step(4);
      })
      .catch(function(){ suBtn.disabled=false; suBtn.textContent=was; showErr(err3,'Network error \\u2014 try again.'); });
  }
  suBtn && suBtn.addEventListener('click', doSignup);
  suEmail && suEmail.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); doSignup(); } });
  suName && suName.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); suEmail&&suEmail.focus(); } });
  var toSi=document.getElementById('lgmToSignin'); toSi&&toSi.addEventListener('click',function(){ step(1); setTimeout(function(){ emailIn&&emailIn.focus(); },60); });
  var b3=document.getElementById('lgmBack3'); b3&&b3.addEventListener('click',function(){ step(1); });

  // ── Step 4: success. "Continue browsing" just closes (session stays unlocked — more saves keep
  // queueing). "Resend" re-hits signup for the same email.
  var okDone=document.getElementById('lgmOkDone'); okDone&&okDone.addEventListener('click',close);
  var resend=document.getElementById('lgmResend'); resend&&resend.addEventListener('click',function(){
    if(!_signedUpEmail)return; resend.textContent='Sending\\u2026';
    fetch('/api/auth/mindy-signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:_signedUpEmail})})
      .then(function(){ resend.textContent='Sent \\u2713'; setTimeout(function(){ resend.textContent='Resend email'; },2500); })
      .catch(function(){ resend.textContent='Resend email'; });
  });

  document.getElementById('lgmX')&&document.getElementById('lgmX').addEventListener('click',close);
  document.getElementById('lgmBack')&&document.getElementById('lgmBack').addEventListener('click',function(){ step(1); });
  ov.addEventListener('click',function(e){ if(e.target===ov) close(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&ov.classList.contains('show')) close(); });

  // ── Return from the setup link: the user is now SIGNED IN and back on the map. If we queued an
  // intent for them during signup, greet them so the loop closes with a payoff, not silence. We show
  // the reassurance (their intent was remembered) and re-open the sign-in flow's resume path where we
  // safely can; we do NOT fabricate a completed save we can't verify — the banner points them at it.
  function isSignedIn(){ try{ var t=localStorage.getItem('mi_beta_auth_token')||''; return t.split('.').length>=2; }catch(e){ return false; } }
  function drainPendingIntents(){
    if(!isSignedIn()) return;
    var q=[]; try{ q=JSON.parse(localStorage.getItem('mindy_pending_intents')||'[]')||[]; }catch(e){}
    if(!Array.isArray(q)||!q.length) return;
    var mine=q.filter(function(x){ return x && x.path && x.path.indexOf('/opportunity-map')===0; });
    if(!mine.length) return;
    try{ localStorage.removeItem('mindy_pending_intents'); }catch(e){}
    // Delightful, honest welcome-back — NOT a claim we auto-saved. Uses the existing toast if present.
    var msg='Welcome back — pick up right where you left off. What you were saving is ready to go.';
    try{ if(typeof window.__toast==='function'){ window.__toast(msg); return; } }catch(e){}
    var t=document.createElement('div');
    t.textContent=msg;
    t.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:3400;background:#0b1220;color:#fff;padding:12px 18px;border-radius:11px;font:600 13.5px Inter,system-ui,sans-serif;box-shadow:0 10px 30px -8px rgba(8,15,26,.5);max-width:92vw';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.transition='opacity .4s'; t.style.opacity='0'; setTimeout(function(){ t.remove(); },420); }, 6000);
  }
  try{ drainPendingIntents(); }catch(e){}
})();</script>`;
