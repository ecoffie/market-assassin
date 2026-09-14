import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';
import {
  accountAvatarInnerHtml,
  accountMenuAriaLabel,
} from '@/lib/mindy/account-avatar';

/**
 * Shared logged-in account chrome for the Opportunity Map surface (the map +
 * /opportunity-map/favorites + /opportunity-map/saved).
 *
 * Zillow-style: a profile avatar top-right (the user's Google photo when we have
 * it, initials otherwise) that opens an account dropdown — Opportunity Map ·
 * Settings · My Pursuits · Favorites · Updates · Sign out. Reused verbatim by all
 * three pages so the chrome is identical everywhere (GOS #9 — one build, dropped
 * in every surface) and the map's own route.ts edit stays a few lines.
 *
 * These are exported as plain HTML/CSS/JS STRINGS because the three consuming
 * pages emit their markup as strings:
 *  - the map (route.ts) builds inline string-concatenated HTML injected via repl()
 *  - favorites/saved are template-literal HTML in a route handler
 * so a React component can't be shared across them — a string module can.
 *
 * ⚠️ route.ts injects via repl() (literal replacer, never raw `$`). These strings
 * contain NO `$` and NO template-literal `${}` — they are static — so they are
 * safe to concatenate into either a repl() target or a template literal.
 *
 * Auth: the avatar's photo/name/email come from GET /api/app/me, which authenticates
 * via the existing MI 2FA token (x-mi-auth-token) — the SAME localStorage token
 * (mi_beta_auth_token) the map/favorites/saved already read. HMAC tokens are
 * payload.sig (email in split(".")[0]); treating them as JWTs painted "?".
 * A logged-OUT user (no token) shows "Log In", never a broken image.
 */

// ── CSS ─────────────────────────────────────────────────────────────────────
// Scoped under .mindy-acct so it can't collide with a host page's classes. The
// avatar itself reuses the existing .zh-acct sizing on the map/favorites; this
// block adds the photo, the dropdown, and the "signed in as" header.
export const ACCOUNT_MENU_CSS =
  '.mindy-acct{position:relative;display:inline-flex}'
  + '.mindy-acct-btn{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--line,#e6eaef);color:var(--sub,#6b7787);background:#fff;cursor:pointer;overflow:hidden;padding:0}'
  + '.mindy-acct-btn:hover{border-color:#c7d2e0}'
  // Logged-out: a labelled pill, not a 34px circle. Overrides the circle's fixed width/radius so
  // the word "Log In" is the affordance — an anonymous visitor should never have to hover an
  // unlabelled glyph to find sign-in.
  + '.mindy-acct-btn.mindy-acct-signin{width:auto;height:34px;border-radius:8px;padding:0 14px;font:700 13.5px Inter,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#1e3a8a,#7c3aed);border-color:transparent;white-space:nowrap}'
  + '.mindy-acct-btn.mindy-acct-signin:hover{filter:brightness(1.07);border-color:transparent}'
  + '.mindy-acct-btn img{width:100%;height:100%;object-fit:cover;display:block}'
  + '.mindy-acct-btn .mindy-acct-ini{font:700 13px Inter,system-ui,sans-serif;color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a8a,#7c3aed)}'
  + '.mindy-acct-menu{position:absolute;top:calc(100% + 8px);right:0;width:238px;background:#fff;border:1px solid var(--line,#e6eaef);border-radius:12px;box-shadow:0 18px 44px rgba(16,24,40,.18);z-index:1300;overflow:hidden;display:none}'
  + '.mindy-acct-menu.open{display:block}'
  + '.mindy-acct-hd{padding:13px 15px;border-bottom:1px solid var(--hair,#f0f3f7)}'
  + '.mindy-acct-hd .nm{font:700 14px Inter,system-ui,sans-serif;color:var(--ink,#111c26);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mindy-acct-hd .em{font:500 12.5px Inter,system-ui,sans-serif;color:var(--sub,#6b7787);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}'
  + '.mindy-acct-menu a{display:flex;align-items:center;gap:10px;padding:10px 15px;font:600 13.5px Inter,system-ui,sans-serif;color:var(--ink,#111c26);text-decoration:none;cursor:pointer;background:none;border:0;width:100%;text-align:left}'
  + '.mindy-acct-menu a:hover{background:var(--wash,#f7f9fb)}'
  + '.mindy-acct-menu a svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}'
  + '.mindy-acct-menu .sep{height:1px;background:var(--hair,#f0f3f7);margin:4px 0}'
  + '.mindy-acct-menu a.out{color:#e5484d}'
  + '.mindy-acct-menu a.out:hover{background:#fff5f5}';

// ── HTML ────────────────────────────────────────────────────────────────────
// The avatar button + the dropdown. Rendered in the top-right of every page.
// The button starts as a generic person icon (or a known identity when the
// caller already has one); account-menu.js swaps in the photo or initials once
// /api/app/me resolves (and shows "Log In" if logged out).
function escText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function accountMenuHtml(identity?: { email?: string | null; name?: string | null; picture?: string | null }): string {
  const email = (identity?.email || '').trim();
  const name = (identity?.name || '').trim();
  const label = accountMenuAriaLabel(name, email);
  const title = name || email || 'Account';
  const inner = accountAvatarInnerHtml(identity);
  const hdDisplay = email ? 'block' : 'none';
  const hdName = name || email;
  const hdEmail = name ? email : '';
  return (
  '<div class="mindy-acct" id="mindyAcct">'
  + '<button class="mindy-acct-btn" id="mindyAcctBtn" title="' + escText(title) + '" aria-label="' + escText(label) + '" aria-haspopup="true" aria-expanded="false">'
  + inner
  + '</button>'
  + '<div class="mindy-acct-menu" id="mindyAcctMenu" role="menu">'
  + '<div class="mindy-acct-hd" id="mindyAcctHd" style="display:' + hdDisplay + '"><div class="nm" id="mindyAcctNm">' + escText(hdName) + '</div><div class="em" id="mindyAcctEm">' + escText(hdEmail) + '</div></div>'
  + '<a href="/opportunity-map" role="menuitem"><svg viewBox="0 0 24 24"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/></svg>Opportunity Map</a>'
  + '<a href="/opportunity-map/favorites" role="menuitem"><svg viewBox="0 0 24 24"><path d="M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z"/></svg>Favorites</a>'
  + '<a href="/opportunity-map/saved" role="menuitem"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>Updates</a>'
  + '<a href="/opportunity-map/pursuits" role="menuitem"><svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>My Pursuits</a>'
  // Proposals is USAGE-GATED (hidden by default). account-menu.js reveals it when the
  // signed-in user isPro OR has drafts (via /api/app/proposal/drafts?probe=1) and fills
  // the draft-count badge. Free users who never drafted never see a dead Pro link — they
  // discover Proposals on an opportunity's "Draft proposal" button instead.
  + '<a href="/opportunity-map/pursuits" role="menuitem" id="mindyAcctProp" style="display:none;justify-content:space-between"><span style="display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>Proposals</span><span id="mindyAcctPropCt" style="display:none;font:700 10px/1 ui-monospace,Menlo,monospace;color:#0a8f57;background:#e8f6ee;padding:3px 7px;border-radius:6px"></span></a>'
  // Company Vault → the MAP-NATIVE page (Eric 2026-08-13). This menu is injected on every map
  // surface, so pointing it at /app?panel=vault threw the user out of the map to reach a page the
  // map now owns. Icon matches the shield every rail uses, so one destination has ONE identity
  // (it was a padlock here and a shield in the rails — same page, two symbols).
  + '<a href="/opportunity-map/vault" role="menuitem"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-3 8.5-7 10-4-1.5-7-5.6-7-10V6z"/><path d="M9.2 12.2l1.9 1.9 3.7-3.9"/></svg>Company Vault</a>'
  + '<div class="sep"></div>'
  // Settings opens the map-native essentials drawer (window.openSettingsDrawer) — no page leave —
  // and falls back to /app only where the drawer isn't present (favorites/saved don't inject it).
  + '<a href="/app?panel=settings" id="mindyAcctSettings" role="menuitem"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>Settings</a>'
  + '<a href="/mcp/about" role="menuitem"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 16v-4M12 8h.01"/></svg>Use Mindy in your AI</a>'
  + '<a href="/mcp/account" role="menuitem"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>Credits &amp; Usage</a>'
  + '<a class="out" id="mindyAcctOut" role="menuitem"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>Sign out</a>'
  + '</div></div>'
  );
}

export const ACCOUNT_MENU_HTML = accountMenuHtml();

// ── JS ──────────────────────────────────────────────────────────────────────
// Reads the MI token (same as the host pages), resolves the avatar via
// /api/app/me, toggles the dropdown, and wires sign-out. Guards every access so
// a logged-out visitor or a failed fetch degrades gracefully (never a broken avatar).
export const ACCOUNT_MENU_JS = '<script>'
  + '(function(){'
  + 'function tok(){try{return localStorage.getItem("mi_beta_auth_token");}catch(e){return null;}}'
  // HMAC tokens are payload.sig (2 parts) — email is in [0]. The old decoder treated them as
  // JWTs and read [1] (the signature), so every signed-in Maps user got email="" → purple "?".
  // Gold master: verifyTwoFactorSessionToken in two-factor-session.ts.
  + 'function b64json(s){s=(s||"").replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return JSON.parse(atob(s));}'
  + 'function tokEmail(){try{var raw=tok()||"";var parts=raw.split(".");var j=null;if(parts.length>=2){try{j=b64json(parts[0]);}catch(e0){j=null;}if(!(j&&j.email)&&parts.length>=3){try{j=b64json(parts[1]);}catch(e1){j=null;}}if(j&&j.email)return String(j.email).toLowerCase();}}catch(e){}try{var b=localStorage.getItem("mi_beta_email")||localStorage.getItem("briefings_access_email");return b?b.toLowerCase().trim():"";}catch(e2){return "";}}'
  + 'var wrap=document.getElementById("mindyAcct");if(!wrap)return;'
  + 'var btn=document.getElementById("mindyAcctBtn"),menu=document.getElementById("mindyAcctMenu");'
  + 'var t=tok(),em=tokEmail();'
  + 'function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}'
  + 'function initials(name,email){var n=(name||"").trim();if(n){var w=n.split(/\\s+/).filter(Boolean);if(w.length>=2)return (w[0][0]+w[1][0]).toUpperCase();return w[0][0].toUpperCase();}var local=((email||"").trim().split("@")[0]||"");var p=local.split(/[._-]+/).filter(Boolean);var a=p[0]?p[0][0]:local[0];if(!a)return "";var b=p[1]?p[1][0]:"";return (a+b).toUpperCase();}'
  + 'function ariaWho(name,email){var who=(name||"").trim()||((email||"").trim().split("@")[0]||"");return who?("Account menu, "+who):"Account menu";}'
  + 'function paintSignedOut(){var out=document.getElementById("mindyAcctOut");if(out)out.style.display="none";btn.classList.add("mindy-acct-signin");btn.innerHTML="Log In";btn.setAttribute("title","Log in");btn.setAttribute("aria-label","Log in");btn.onclick=function(e){e.stopPropagation();if(typeof window.openSignInModal==="function"){window.openSignInModal("Log in to Mindy",function(){location.reload();});return;}location.href="/app?next="+encodeURIComponent(location.pathname+location.search);};}'
  + 'function paintInitial(name,email){var ini=initials(name,email);if(!ini)return;btn.classList.remove("mindy-acct-signin");btn.innerHTML="<span class=\\"mindy-acct-ini\\">"+esc(ini)+"</span>";btn.setAttribute("title",name||email||"Account");btn.setAttribute("aria-label",ariaWho(name,email));}'
  + 'function renderAvatar(name,picture){paintInitial(name,em);if(!picture)return;var img=new Image();img.referrerPolicy="no-referrer";img.alt="";img.onload=function(){btn.innerHTML="";btn.appendChild(img);};img.onerror=function(){paintInitial(name,em);};img.src=picture;}'
  + 'function renderHeader(name){var hd=document.getElementById("mindyAcctHd");if(!hd)return;var nmEl=document.getElementById("mindyAcctNm"),emEl=document.getElementById("mindyAcctEm");if(name){nmEl.textContent=name;emEl.textContent=em;}else{nmEl.textContent=em;emEl.textContent="";}hd.style.display="block";}'
  // Logged OUT: labelled "Log In", no dropdown, no /me fetch. Gate on the TOKEN, not the
  // decoded email (Eric 2026-08-04: treating missing email as signed-out logged real users out).
  + 'if(!t){paintSignedOut();return;}'
  + 'if(em){paintInitial("",em);renderHeader("");}'
  + 'var meHdrs={"x-mi-auth-token":t};if(em)meHdrs["x-user-email"]=em;'
  + 'fetch("/api/app/me"+(em?("?email="+encodeURIComponent(em)):""),{credentials:"same-origin",headers:meHdrs}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(!d||!d.email)return;em=d.email;renderAvatar(d.name||"",d.picture||"");renderHeader(d.name||"");}).catch(function(){});'
  // Usage-gated Proposals entry: reveal it only when the signed-in user isPro OR has
  // drafted before (approved display rule). One cheap probe (exact count + Pro resolve).
  // Fails silent — the entry just stays hidden, never a broken/dead link.
  + 'fetch("/api/app/proposal/drafts?probe=1&email="+encodeURIComponent(em),{headers:{"x-mi-auth-token":t,"x-user-email":em}}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(!d)return;var show=d.isPro||d.hasDrafts===true;if(!show)return;var a=document.getElementById("mindyAcctProp");if(!a)return;a.style.display="flex";var n=Number(d.draftCount||0);if(n>0){var ct=document.getElementById("mindyAcctPropCt");if(ct){ct.textContent=n+(n===1?" draft":" drafts");ct.style.display="inline-block";}}}).catch(function(){});'
  // Settings → open the map-native drawer in place (no page leave) when it's present on this page.
  // Favorites/saved don't inject it, so their link keeps the /app fallback href.
  + 'var setLink=document.getElementById("mindyAcctSettings");if(setLink)setLink.addEventListener("click",function(e){if(typeof window.openSettingsDrawer==="function"){e.preventDefault();setOpen(false);window.openSettingsDrawer();}});'
  // Dropdown open/close + click-away + Esc.
  + 'function setOpen(o){menu.classList.toggle("open",o);btn.setAttribute("aria-expanded",o?"true":"false");}'
  + 'btn.onclick=function(e){e.stopPropagation();setOpen(!menu.classList.contains("open"));};'
  + 'document.addEventListener("click",function(e){if(!wrap.contains(e.target))setOpen(false);});'
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape")setOpen(false);});'
  // Sign out: clear the same MI localStorage keys /app clears, then hand off to
  // /app which finishes the Supabase session sign-out and shows the sign-in form.
  + 'var MAPS_HOME="' + MAPS_HOME_PATH + '";var out=document.getElementById("mindyAcctOut");if(out)out.onclick=function(){try{["mi_beta_auth_token","mi_beta_2fa_token","mi_beta_email","mi_beta_authenticated_at","mi_beta_2fa_verified_at","briefings_access_email"].forEach(function(k){localStorage.removeItem(k);});}catch(e){}fetch("/api/auth/maps-signout",{method:"POST",credentials:"same-origin"}).catch(function(){}).then(function(){location.href=MAPS_HOME;});};'
  + '})();'
  + '</script>';
