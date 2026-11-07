/**
 * READ-ONLY "team activity" summary for a pursuit, shown on the map's pursuit pages
 * (/opportunity-map/pursuits row expand + /opportunity-map/proposal right rail).
 *
 * Collaboration on a pursuit (comments, the bid decision, assignment) is made in /app, and the
 * map pages never showed it. This renders a small, honest summary from data the app already
 * stores — nothing is computed or written here:
 *   - Bid decision  → user_pipeline.bid_decision (written by POST /api/app/proposal/bid-gates,
 *                     returned by GET /api/pipeline, which selects '*'). The bid-gates GET is NOT
 *                     used: it derives eliminator questions with an LLM and does not return the
 *                     saved decision.
 *   - Assignee      → user_pipeline.owner_email + collaborators (set by PursuitAssignment via
 *                     PATCH /api/pipeline, returned by GET /api/pipeline).
 *   - Comments      → GET /api/app/comments?email=&pipeline_id= (mi_beta_comments), fetched with
 *                     the same MI-token headers the page already sends to /api/pipeline.
 *
 * Honesty rules: a field the pursuit row does not carry renders NOTHING (never "none"); a failed
 * comments fetch says "couldn't load", never "0 comments". Editing stays in the app — the summary
 * ends with a "Discuss in the app" link.
 *
 * ⚠️ This is emitted inside a TS template literal: double every backslash and keep `${` for
 * deliberate interpolation only.
 */

export const PURSUIT_COLLAB_DISCUSS_HREF = '/app?panel=pipeline';

export const PURSUIT_COLLAB_CSS = `
  .pc-collab{margin-top:8px;font:500 12px Inter,sans-serif;color:var(--sub,#5b6270);line-height:1.5}
  .pc-collab .pc-line{display:block}
  .pc-collab .pc-k{font-weight:700;color:var(--ink,#111c26)}
  .pc-collab .pc-quote{display:block;color:var(--sub,#5b6270);font-style:italic;white-space:normal;overflow-wrap:anywhere}
  .pc-collab .pc-muted{color:var(--faint,#8a93a0)}
  .pc-collab a.pc-discuss{font-weight:700;color:var(--blue,#1d4ed8);text-decoration:none}
  .pc-collab a.pc-discuss:hover{text-decoration:underline}
`;

export const PURSUIT_COLLAB_JS = `(function(){
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function has(o,k){ return !!o && Object.prototype.hasOwnProperty.call(o,k); }
  var DECISION={pursue:'Pursue',watch:'Watch',skip:'No-bid'};
  var SNIPPET_MAX=140;
  var cache={};

  function decisionText(p){
    if(!has(p,'bid_decision')) return '';
    var d=String(p.bid_decision||'').toLowerCase().trim();
    if(!d) return 'Bid decision: not made yet';
    return 'Bid decision: '+(DECISION[d]||d);
  }
  function assigneeText(p){
    if(!has(p,'owner_email') && !has(p,'collaborators')) return '';
    var owner=String((p&&p.owner_email)||'').trim();
    var collab=Array.isArray(p&&p.collaborators)?p.collaborators.filter(function(c){return !!c;}):[];
    var s=owner?('Owner: '+owner):'Owner: not assigned';
    if(collab.length) s+=' + '+collab.length+' collaborator'+(collab.length===1?'':'s');
    return s;
  }
  function snippet(s){ s=String(s||'').replace(/\\s+/g,' ').trim(); return s.length>SNIPPET_MAX?(s.slice(0,SNIPPET_MAX-1)+'…'):s; }
  function commentsHtml(st){
    if(!st||st.status==='idle') return '';
    if(st.status==='loading') return '<span class="pc-line pc-muted">Loading comments…</span>';
    if(st.status==='error') return '<span class="pc-line pc-muted">Comments couldn’t load.</span>';
    if(!st.count) return '<span class="pc-line">No comments yet.</span>';
    var out='<span class="pc-line"><span class="pc-k">'+st.count+' comment'+(st.count===1?'':'s')+'</span>'
      +(st.last&&st.last.by?(' · latest from '+esc(st.last.by)):'')+'</span>';
    if(st.last&&st.last.content) out+='<span class="pc-quote">“'+esc(snippet(st.last.content))+'”</span>';
    return out;
  }
  function html(p, st){
    var parts=[];
    var d=decisionText(p); if(d) parts.push('<span class="pc-line">'+esc(d)+'</span>');
    var a=assigneeText(p); if(a) parts.push('<span class="pc-line">'+esc(a)+'</span>');
    var c=commentsHtml(st); if(c) parts.push(c);
    parts.push('<span class="pc-line"><a class="pc-discuss" href="${PURSUIT_COLLAB_DISCUSS_HREF}">Discuss in the app →</a></span>');
    return parts.join('');
  }
  function slot(p){
    var id=String((p&&p.id)||'');
    return '<div class="pc-collab" data-pc-id="'+esc(id)+'">'+html(p, cache[id]||{status:'idle'})+'</div>';
  }
  function paint(id,p){
    var els=document.querySelectorAll('[data-pc-id]');
    for(var i=0;i<els.length;i++){ if(els[i].getAttribute('data-pc-id')===id) els[i].innerHTML=html(p,cache[id]); }
  }
  // Fetch the comment summary once per pursuit per page load. opts = { email, headers }.
  function load(p, opts){
    var id=String((p&&p.id)||'');
    if(!id) return Promise.resolve();
    if(cache[id] && cache[id].status!=='error'){ paint(id,p); return Promise.resolve(); }
    if(!opts||!opts.email){ return Promise.resolve(); }
    cache[id]={status:'loading'}; paint(id,p);
    return fetch('/api/app/comments?email='+encodeURIComponent(opts.email)+'&pipeline_id='+encodeURIComponent(id),{headers:opts.headers||{}})
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,j:j}; }); })
      .then(function(x){
        if(!x.ok||!x.j||x.j.success!==true||!Array.isArray(x.j.comments)) throw new Error('comments unavailable');
        var list=x.j.comments, last=list.length?list[list.length-1]:null;
        cache[id]={status:'ok',count:list.length,last:last?{content:String(last.content||''),by:String(last.user_email||'')}:null};
      })
      .catch(function(){ cache[id]={status:'error'}; })
      .then(function(){ paint(id,p); });
  }
  window.__pursuitCollab={slot:slot,load:load,html:html,decisionText:decisionText,assigneeText:assigneeText};
})();`;
