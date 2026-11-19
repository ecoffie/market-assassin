/**
 * The script served at GET /help-widget.js (src/app/help-widget.js/route.ts): a small "Get help"
 * button on every page that opens a short form and posts to /api/support.
 *
 * Loaded by the root layout (all React pages) and the shared account menu HTML (the map family and
 * the raw-HTML public pages), the same way as /event-popup.js. It guards itself (window.__mindyHelp),
 * so loading it twice is harmless.
 *
 * Rules:
 *  - never on /admin, /support (that page IS the form), embeds (?embed=) or the OAuth screens
 *  - the email is prefilled from the signed-in Mindy email when the browser has one
 *  - it sends the page PATH only (no query string)
 *  - success is shown only when the server says it was delivered; otherwise the email fallback
 *  - Escape closes; focus moves into the panel on open and back to the button on close
 */
import { SUPPORT_INBOX_DEFAULT, SUPPORT_TOPICS } from './support-topics';

function js(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

export function helpWidgetScript(): string {
  const css = [
    '.mhw-btn{position:fixed;right:18px;bottom:18px;z-index:2147482000;display:flex;align-items:center;gap:8px;padding:11px 16px;border:0;border-radius:999px;background:#1b3a6b;color:#fff;font:600 15px/1 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(10,14,40,.28);cursor:pointer}',
    '.mhw-btn:hover{background:#14294a}',
    '.mhw-btn:focus-visible,.mhw-p button:focus-visible,.mhw-p a:focus-visible{outline:3px solid #8fb0e0;outline-offset:2px}',
    '.mhw-dot{width:18px;height:18px;border-radius:50%;background:#fff;color:#1b3a6b;display:grid;place-items:center;font:700 12px/1 Inter,system-ui,sans-serif}',
    '.mhw-p{position:fixed;right:18px;bottom:76px;z-index:2147482001;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;background:#fff;color:#12100e;border-radius:20px;box-shadow:0 24px 70px rgba(10,14,40,.35);font-family:Inter,system-ui,sans-serif}',
    '.mhw-p:focus{outline:none}',
    '.mhw-h{background:#1b3a6b;color:#fff;padding:18px 20px;border-radius:20px 20px 0 0;position:relative}',
    '.mhw-h h2{margin:0;font:600 18px/1.25 Inter,system-ui,sans-serif;color:#fff}',
    '.mhw-h p{margin:6px 0 0;font:400 14px/1.4 Inter,system-ui,sans-serif;color:#dbe4f1}',
    '.mhw-x{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:20px;line-height:1;cursor:pointer}',
    '.mhw-f{padding:16px 20px 18px}',
    '.mhw-f label{display:block;margin-top:12px;font:600 13px/1.3 Inter,system-ui,sans-serif;color:#12100e}',
    '.mhw-f label:first-child{margin-top:0}',
    '.mhw-f input,.mhw-f select,.mhw-f textarea{display:block;box-sizing:border-box;width:100%;margin-top:6px;padding:10px 12px;border:1.5px solid #d6dbe3;border-radius:12px;background:#fff;color:#12100e;font:400 16px/1.4 Inter,system-ui,sans-serif}',
    '.mhw-f textarea{min-height:110px;resize:vertical}',
    '.mhw-f .bad{border-color:#b42318}',
    '.mhw-f .opt{font-weight:400;color:#5b6470}',
    '.mhw-go{display:block;width:100%;margin-top:14px;padding:12px;border:0;border-radius:999px;background:#1b3a6b;color:#fff;font:700 15px Inter,system-ui,sans-serif;cursor:pointer}',
    '.mhw-go:disabled{opacity:.6;cursor:default}',
    '.mhw-err{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:#fdf1f0;color:#b42318;font:500 14px/1.4 Inter,system-ui,sans-serif}',
    '.mhw-note{margin:10px 0 0;text-align:center;font:400 12px/1.4 Inter,system-ui,sans-serif;color:#5b6470}',
    '.mhw-note a,.mhw-err a{color:#1b3a6b;font-weight:600}',
    '.mhw-ok{padding:26px 20px 24px;text-align:center}',
    '.mhw-ok b{display:block;font:600 18px/1.3 Inter,system-ui,sans-serif}',
    '.mhw-ok p{margin:8px 0 0;font:400 15px/1.5 Inter,system-ui,sans-serif;color:#3f4650}',
    '.mhw-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
    '@media (max-width:480px){.mhw-btn{right:12px;bottom:12px}.mhw-p{right:12px;left:12px;width:auto;bottom:68px}}',
    '@media print{.mhw-btn,.mhw-p{display:none!important}}',
  ].join('');

  const topics = SUPPORT_TOPICS.map((t) => '<option>' + t.replace(/&/g, '&amp;') + '</option>').join('');
  const mail = SUPPORT_INBOX_DEFAULT;
  const form =
    '<form class="mhw-f" novalidate>'
    + '<label>Your email<input name="email" type="email" autocomplete="email" required></label>'
    + '<label>Name <span class="opt">(optional)</span><input name="name" autocomplete="name"></label>'
    + '<label>What is it about?<select name="topic" required><option value="">Choose one</option>' + topics + '</select></label>'
    + '<label>How can we help?<textarea name="message" required placeholder="Tell us what happened or what you are trying to do."></textarea></label>'
    + '<div class="mhw-hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>'
    + '<div class="mhw-err" role="alert" hidden></div>'
    + '<button type="submit" class="mhw-go">Send to the Mindy team</button>'
    + '<p class="mhw-note">A real person reads every message. Or email <a href="mailto:' + mail + '">' + mail + '</a></p>'
    + '</form>';
  const panel =
    '<div class="mhw-h"><h2 id="mhwT">How can we help?</h2><p>We usually reply within one business hour.</p>'
    + '<button type="button" class="mhw-x" aria-label="Close help">&times;</button></div>'
    + '<div class="mhw-body">' + form + '</div>';

  return '(function(){try{'
    + 'if(window.__mindyHelp)return;window.__mindyHelp=1;'
    + 'function excluded(){var p=location.pathname;return /^\\/(admin|support|oauth)(\\/|$)/.test(p)||/[?&]embed=/.test(location.search);}'
    + 'if(excluded())return;'
    + 'function start(){if(document.querySelector(".mhw-btn"))return;'
    + 'var st=document.createElement("style");st.textContent=' + js(css) + ';document.head.appendChild(st);'
    + 'var btn=document.createElement("button");btn.type="button";btn.className="mhw-btn";btn.setAttribute("aria-haspopup","dialog");btn.setAttribute("aria-expanded","false");'
    + 'btn.innerHTML=\'<span class="mhw-dot" aria-hidden="true">?</span>Get help\';'
    + 'var p=null;'
    + 'function close(){if(!p)return;p.remove();p=null;btn.setAttribute("aria-expanded","false");document.removeEventListener("keydown",onKey);btn.focus();}'
    + 'function onKey(e){if(e.key==="Escape")close();}'
    + 'function open(){if(excluded()){btn.remove();return;}if(p){close();return;}'
    + 'p=document.createElement("div");p.className="mhw-p";p.setAttribute("role","dialog");p.setAttribute("aria-labelledby","mhwT");p.tabIndex=-1;p.innerHTML=' + js(panel) + ';'
    + 'document.body.appendChild(p);btn.setAttribute("aria-expanded","true");document.addEventListener("keydown",onKey);'
    + 'p.querySelector(".mhw-x").onclick=close;'
    + 'var f=p.querySelector("form"),F=f.elements,err=p.querySelector(".mhw-err"),go=p.querySelector(".mhw-go");'
    + 'try{var em=localStorage.getItem("mi_beta_email");if(em&&em.indexOf("@")>0)F.email.value=em;}catch(e){}'
    + '(F.email.value?F.topic:F.email).focus();'
    + 'function fail(msg){err.innerHTML=msg;err.hidden=false;go.disabled=false;go.textContent="Send to the Mindy team";}'
    + 'f.onsubmit=function(e){e.preventDefault();'
    + 'var d={email:F.email.value,name:F.name.value,topic:F.topic.value,message:F.message.value,website:F.website.value,page:location.pathname};'
    + '["email","topic","message"].forEach(function(k){F[k].classList.remove("bad");});'
    + 'var miss=[];if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(d.email.trim()))miss.push("email");if(!d.topic)miss.push("topic");if(d.message.trim().length<5)miss.push("message");'
    + 'if(miss.length){miss.forEach(function(k){F[k].classList.add("bad");});F[miss[0]].focus();fail("Please fill in the highlighted fields.");return;}'
    + 'err.hidden=true;go.disabled=true;go.textContent="Sending\\u2026";'
    + 'fetch("/api/support",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)})'
    + '.then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,j:j};});})'
    + '.then(function(x){if(x.ok&&x.j&&x.j.success){'
    + 'p.querySelector(".mhw-body").innerHTML=\'<div class="mhw-ok" role="status"><b>Thanks, we got it.</b><p>A member of the Mindy team will reply to <span class="mhw-em"></span> soon.</p></div>\';'
    + 'var s=p.querySelector(".mhw-em");if(s)s.textContent=d.email.trim();p.focus();return;}'
    + 'if(x.j&&Array.isArray(x.j.errors)){x.j.errors.forEach(function(k){if(F[k])F[k].classList.add("bad");});}'
    + 'fail(x.j&&x.j.errors?"Please fill in the highlighted fields.":' + js('We could not send your message. Please email <a href="mailto:' + mail + '">' + mail + '</a>.') + ');})'
    + '.catch(function(){fail(' + js('We could not send your message. Please email <a href="mailto:' + mail + '">' + mail + '</a>.') + ');});'
    + '};}'
    + 'btn.onclick=open;document.body.appendChild(btn);'
    + 'window.mindyOpenHelp=function(){if(!p)open();};'
    + '}'
    + 'if(document.body)start();else document.addEventListener("DOMContentLoaded",start);'
    + '}catch(e){}})();';
}
