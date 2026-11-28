/**
 * In-page dialog for the Opportunity Map pages (Design & Output, 2026-11-28).
 *
 * Replaces the browser's window.prompt / window.confirm / window.alert in the saved-search flows (naming,
 * renaming, deleting, the alerts offer). Native pop-ups block automated tests (they were the blocker in the
 * alerts acceptance run), cannot be styled, and read like an error. This is one small dialog the map and the
 * Saved Searches page share:
 *
 *   window.__mdDialog({
 *     title, message,                         // heading + one short paragraph
 *     input:  { label, value, maxLength },    // optional text field (Enter submits)
 *     choice: { label, value, options: [{ value, label }] },  // optional single choice (Daily / Weekly / Off)
 *     okLabel, cancelLabel,                   // clear wording ("Save" / "Cancel", "Delete" / "Keep it")
 *     danger,                                 // red primary button for destructive actions
 *     hideCancel                              // an information dialog with one button
 *   }, function (result) { ... });            // result: null when cancelled, else { value, choice }
 *
 * Accessible: role="dialog" + aria-modal + aria-labelledby/-describedby; focus moves into the dialog and is
 * trapped (Tab / Shift+Tab cycle); Esc cancels; Enter submits (from the field or anywhere but a button, which
 * clicks itself); focus returns to the element that opened it. The choice is a radiogroup with arrow keys.
 * A required field (input given) cannot be submitted empty.
 *
 * Plain ES5 in a string: it is inlined into the map pages' client scripts (no backticks, no template
 * placeholders, no arrow functions, no let/const). Tests evaluate the same string in jsdom.
 */
export const MAP_DIALOG_JS = `
(function(){
  if(window.__mdDialog)return;
  var CSS='.md-ov{position:fixed;inset:0;background:rgba(17,28,38,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px}'
    +'.md-box{width:100%;max-width:420px;background:#fff;border-radius:14px;box-shadow:0 24px 60px -12px rgba(17,28,38,.45);border:1px solid #e2e8f0;padding:22px 22px 18px;font-family:Inter,system-ui,sans-serif;color:#0f172a}'
    +'.md-title{font-weight:800;font-size:17px;margin:0 0 8px}'
    +'.md-msg{font-weight:500;font-size:13.5px;color:#475569;line-height:1.5;margin:0 0 16px;white-space:pre-line}'
    +'.md-lbl{display:block;font-weight:700;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#475569;margin:0 0 6px}'
    +'.md-in{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font:500 14px Inter,system-ui,sans-serif;color:#0f172a;margin:0 0 16px}'
    +'.md-in:focus{outline:2px solid #1e3a8a;outline-offset:1px;border-color:#1e3a8a}'
    +'.md-seg{display:flex;gap:8px;margin:0 0 18px}'
    +'.md-opt{flex:1;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font:600 13px Inter,system-ui,sans-serif;border-radius:9px;padding:8px 10px;cursor:pointer}'
    +'.md-opt[aria-checked="true"]{border-color:#1e3a8a;background:#eff5ff;color:#1e3a8a;box-shadow:0 0 0 1px #1e3a8a inset}'
    +'.md-acts{display:flex;justify-content:flex-end;gap:10px}'
    +'.md-btn{font:700 13px Inter,system-ui,sans-serif;border-radius:10px;padding:9px 16px;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#0f172a}'
    +'.md-btn.md-ok{border:0;background:#1e3a8a;color:#fff}'
    +'.md-btn.md-danger{border:0;background:#b91c1c;color:#fff}'
    +'.md-btn:focus-visible,.md-opt:focus-visible{outline:2px solid #1e3a8a;outline-offset:2px}';
  var seq=0;
  function el(tag,cls,text){ var e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; }
  window.__mdDialog=function(opts,cb){
    opts=opts||{}; cb=typeof cb==='function'?cb:function(){};
    if(!document.getElementById('md-style')){ var st=el('style'); st.id='md-style'; st.textContent=CSS; document.head.appendChild(st); }
    var opener=document.activeElement; var id='md'+(++seq); var done=false;
    var ov=el('div','md-ov'); var box=el('div','md-box');
    box.setAttribute('role','dialog'); box.setAttribute('aria-modal','true'); box.setAttribute('aria-labelledby',id+'-t');
    var h=el('h2','md-title',opts.title||''); h.id=id+'-t'; box.appendChild(h);
    if(opts.message){ var p=el('p','md-msg',opts.message); p.id=id+'-m'; box.setAttribute('aria-describedby',id+'-m'); box.appendChild(p); }
    var input=null;
    if(opts.input){
      var lb=el('label','md-lbl',opts.input.label||'Name'); lb.setAttribute('for',id+'-i'); box.appendChild(lb);
      input=el('input','md-in'); input.id=id+'-i'; input.type='text'; input.value=opts.input.value||'';
      if(opts.input.maxLength)input.maxLength=opts.input.maxLength;
      box.appendChild(input);
    }
    var choice=null, optBtns=[];
    if(opts.choice&&opts.choice.options&&opts.choice.options.length){
      choice=opts.choice.value!=null?opts.choice.value:opts.choice.options[0].value;
      var cl=el('div','md-lbl',opts.choice.label||''); cl.id=id+'-c'; box.appendChild(cl);
      var seg=el('div','md-seg'); seg.setAttribute('role','radiogroup'); seg.setAttribute('aria-labelledby',id+'-c');
      for(var i=0;i<opts.choice.options.length;i++){
        (function(o){
          var b=el('button','md-opt',o.label); b.type='button'; b.setAttribute('role','radio'); b.setAttribute('data-value',o.value);
          b.onclick=function(){ pick(o.value,true); };
          optBtns.push(b); seg.appendChild(b);
        })(opts.choice.options[i]);
      }
      box.appendChild(seg);
    }
    function pick(v,focus){
      choice=v;
      for(var j=0;j<optBtns.length;j++){ var on=optBtns[j].getAttribute('data-value')===String(v);
        optBtns[j].setAttribute('aria-checked',on?'true':'false'); optBtns[j].tabIndex=on?0:-1; if(on&&focus)optBtns[j].focus(); }
    }
    if(optBtns.length)pick(choice,false);
    var acts=el('div','md-acts');
    var cancel=null;
    if(!opts.hideCancel){ cancel=el('button','md-btn',opts.cancelLabel||'Cancel'); cancel.type='button'; cancel.onclick=function(){ close(null); }; acts.appendChild(cancel); }
    var ok=el('button','md-btn '+(opts.danger?'md-danger':'md-ok'),opts.okLabel||'OK'); ok.type='button';
    ok.onclick=function(){ submit(); }; acts.appendChild(ok);
    box.appendChild(acts); ov.appendChild(box);
    function submit(){
      if(input&&!String(input.value).trim()){ input.focus(); return; }
      close({ value: input?String(input.value).trim():undefined, choice: optBtns.length?choice:undefined });
    }
    function close(result){
      if(done)return; done=true;
      document.removeEventListener('keydown',onKey,true);
      if(ov.parentNode)ov.parentNode.removeChild(ov);
      try{ if(opener&&opener.focus)opener.focus(); }catch(e){}
      cb(result);
    }
    function focusables(){ var all=box.querySelectorAll('input,button'); var out=[]; for(var k=0;k<all.length;k++){ if(all[k].tabIndex!==-1&&!all[k].disabled)out.push(all[k]); } return out; }
    function onKey(e){
      if(e.key==='Escape'||e.key==='Esc'){ e.preventDefault(); e.stopPropagation(); close(null); return; }
      if(e.key==='Tab'){
        var f=focusables(); if(!f.length)return;
        var first=f[0], last=f[f.length-1], a=document.activeElement;
        if(e.shiftKey&&(a===first||!box.contains(a))){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey&&(a===last||!box.contains(a))){ e.preventDefault(); first.focus(); }
        return;
      }
      if((e.key==='ArrowRight'||e.key==='ArrowDown'||e.key==='ArrowLeft'||e.key==='ArrowUp')&&optBtns.length&&optBtns.indexOf(document.activeElement)>=0){
        e.preventDefault(); var at=optBtns.indexOf(document.activeElement);
        var step=(e.key==='ArrowRight'||e.key==='ArrowDown')?1:-1; var nx=(at+step+optBtns.length)%optBtns.length;
        pick(optBtns[nx].getAttribute('data-value'),true); return;
      }
      if(e.key==='Enter'){
        var t=document.activeElement;
        if(t&&t.tagName==='BUTTON'&&t!==ok&&optBtns.indexOf(t)<0)return; /* Cancel clicks itself */
        e.preventDefault(); e.stopPropagation(); submit();
      }
    }
    ov.addEventListener('mousedown',function(e){ if(e.target===ov&&!opts.hideCancel)close(null); });
    document.addEventListener('keydown',onKey,true);
    document.body.appendChild(ov);
    if(input){ input.focus(); try{ input.select(); }catch(e){} } else ok.focus();
  };
})();
`;

export const MAP_DIALOG_SCRIPT = '<script>' + MAP_DIALOG_JS + '</script>';
