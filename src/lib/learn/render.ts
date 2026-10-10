/**
 * Mindy Learn — server-rendered HTML for /learn and /learn/<slug> (Learn PR B).
 *
 * Pure functions over static data (missions.ts, action-plan.ts), wrapped in the shared public shell
 * (src/lib/public-site/html.ts): the same header, footer, fonts and `--mp-*` roles as /today, /bid and
 * /gov. No auth, no DB, no tier read, no progress — every page is public and identical for every viewer.
 *
 * What these pages never do (pinned by render.unit.test.ts):
 *   · show a checkmark, a percentage or any "done" state — progress is a later, signed-in phase;
 *   · link a "Do it" for a mission that is Coming next or Outside Mindy;
 *   · say "Playbook" (the library is the Tutorial Library).
 */
import { mpRawBodyClose, mpRawBodyOpen, mpRawHeadHtml } from '@/lib/public-site/html';
import { ACTION_PLAN, ACTION_PLAN_STEPS, actionPlanStep } from './action-plan';
import { ACCESS_LABEL, MISSIONS, OUTSIDE_STEPS, STAGES, missionById, type Mission, type StageKey } from './missions';

export const LEARN_ORIGIN = 'https://getmindy.ai';

function esc(v: string): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const stageOf = (k: StageKey) => STAGES.find((s) => s.key === k)!;
const missionHref = (m: Mission) => `/learn/${m.slug}`;
const missionsIn = (k: StageKey) => MISSIONS.filter((m) => m.stage === k);

const LEARN_CSS = `
  body{margin:0;font-size:17px;line-height:1.6}
  :where(.mp-main) :is(h1,h2,h3){font-family:var(--mp-font-serif);font-weight:700;line-height:1.2;letter-spacing:-.01em;margin:0;color:var(--mp-ink);text-wrap:balance}
  :where(.mp-main) p{margin:0}
  :where(.mp-main) a{color:var(--mp-navy);text-underline-offset:2px}
  .lw{max-width:var(--mp-content-max);margin:0 auto;padding:0 var(--mp-gutter)}
  .eyebrow{font-family:var(--mp-font-sans);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--mp-accent);font-weight:700}
  .lhero{padding:56px 0 28px;border-bottom:1px solid var(--mp-hair)}
  .lhero h1{font-size:clamp(32px,5vw,48px);margin-top:12px;max-width:20ch}
  .lhero .sub{color:var(--mp-body);font-size:18px;max-width:60ch;margin-top:16px}
  .lnav{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
  .lnav a{font-family:var(--mp-font-sans);font-size:14px;font-weight:600;border:1px solid var(--mp-line);padding:8px 14px;text-decoration:none;color:var(--mp-ink);background:var(--mp-surface)}
  .lnav a:hover{border-color:var(--mp-ink)}
  .stage{padding:40px 0;border-bottom:1px solid var(--mp-hair)}
  .stage .lvl{font-family:var(--mp-font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mp-navy);font-weight:600}
  .stage h2{font-size:clamp(24px,3.2vw,32px);margin-top:6px}
  .stage .blurb{color:var(--mp-body);margin-top:8px;max-width:60ch}
  .stage.later h2{font-size:22px}
  .mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:22px}
  .mcard{display:block;border:1px solid var(--mp-line);background:var(--mp-surface);padding:18px;text-decoration:none;color:var(--mp-ink)}
  .mcard:hover{border-color:var(--mp-ink)}
  .mcard .mid{font-family:var(--mp-font-mono);font-size:11px;color:var(--mp-muted);letter-spacing:.04em}
  .mcard h3{font-size:17px;margin-top:6px}
  .mcard p{color:var(--mp-body);font-size:14.5px;line-height:1.5;margin-top:8px}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  .tag{font-family:var(--mp-font-sans);font-size:11.5px;font-weight:600;padding:3px 8px;border:1px solid var(--mp-line);color:var(--mp-body);background:var(--mp-wash)}
  .tag.pro{border-color:var(--mp-navy);color:var(--mp-navy);background:var(--mp-navy-wash)}
  .tag.next,.tag.outside{border-style:dashed;color:var(--mp-muted)}
  .ap{padding:40px 0;border-bottom:1px solid var(--mp-hair)}
  .ap h2{font-size:clamp(24px,3.2vw,30px)}
  .phase{margin-top:22px}
  .phase h3{font-size:17px}
  .phase .cad{font-family:var(--mp-font-mono);font-size:10.5px;color:var(--mp-muted);letter-spacing:.06em;margin-left:8px}
  .steps{list-style:none;padding:0;margin:10px 0 0}
  .steps li{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:10px 0;border-top:1px solid var(--mp-hair);font-size:15px}
  .steps .sid{font-family:var(--mp-font-mono);font-size:12px;color:var(--mp-muted);padding-top:2px}
  .steps .cov{display:block;color:var(--mp-body);font-size:14px;margin-top:2px}
  .lib{padding:40px 0}
  .lib h2{font-size:clamp(24px,3.2vw,30px)}
  .lib input{width:100%;box-sizing:border-box;font:500 16px var(--mp-font-sans);padding:12px 14px;border:1px solid var(--mp-line);margin-top:16px;background:var(--mp-surface);color:var(--mp-ink)}
  .lib .count{font-family:var(--mp-font-sans);font-size:13px;color:var(--mp-muted);margin-top:10px}
  .lib ul{list-style:none;padding:0;margin:8px 0 0}
  .lib li{padding:12px 0;border-top:1px solid var(--mp-hair)}
  .lib li .k{font-family:var(--mp-font-mono);font-size:11px;color:var(--mp-muted)}
  .lib li p{color:var(--mp-body);font-size:14.5px;margin-top:4px}
  .lib li[hidden]{display:none}
  .crumb{font-family:var(--mp-font-sans);font-size:13.5px;color:var(--mp-muted);margin-top:28px}
  .crumb a{color:var(--mp-muted)}
  .mhead{padding:16px 0 26px;border-bottom:1px solid var(--mp-hair)}
  .mhead h1{font-size:clamp(30px,4.6vw,44px);margin-top:10px;max-width:22ch}
  .mhead .meta{font-family:var(--mp-font-sans);font-size:14px;color:var(--mp-body);margin-top:12px}
  .msec{padding:24px 0;border-bottom:1px solid var(--mp-hair);max-width:68ch}
  .msec h2{font-size:20px}
  .msec p{margin-top:8px;color:var(--mp-body)}
  .msec ol{margin:10px 0 0;padding-left:22px;color:var(--mp-body)}
  .msec ol li{margin:6px 0}
  .truth{border-left:3px solid var(--mp-navy);background:var(--mp-navy-wash);padding:14px 16px;margin-top:10px;color:var(--mp-ink);font-family:var(--mp-font-serif);font-style:italic}
  .doit{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:26px 0;border-bottom:1px solid var(--mp-hair)}
  .btn{font-family:var(--mp-font-sans);font-weight:600;font-size:15px;padding:13px 22px;text-decoration:none;display:inline-flex;align-items:center;gap:8px;background:var(--mp-navy);color:var(--mp-surface)!important;border:1px solid var(--mp-navy)}
  .btn:hover{background:var(--mp-navy-hover)}
  .note{font-size:14.5px;color:var(--mp-body);max-width:56ch}
  .unavail{border:1px dashed var(--mp-faint);background:var(--mp-wash);padding:16px 18px;color:var(--mp-body);font-size:15px;max-width:60ch}
  .gl a{margin-right:14px;font-size:15px}
  .nextm{padding:28px 0 56px}
  .nextm a{font-family:var(--mp-font-serif);font-size:20px;font-weight:700;text-decoration:none}
  @media (max-width:640px){.steps li{grid-template-columns:52px 1fr}.lhero{padding-top:36px}}
`;

function page(opts: { title: string; description: string; path: string; body: string; script?: string }): string {
  const url = `${LEARN_ORIGIN}${opts.path}`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/png" href="/brand/mindy-logo-icon.png">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${url}">
${mpRawHeadHtml()}
<style>${LEARN_CSS}</style>
</head><body>
${mpRawBodyOpen()}
${opts.body}
${mpRawBodyClose()}
${opts.script || ''}
</body></html>`;
}

function accessTags(m: Mission): string {
  const cls = m.access === 'pro' ? 'tag pro' : m.access === 'coming-next' ? 'tag next' : m.access === 'outside' ? 'tag outside' : 'tag';
  return `<span class="${cls}">${esc(ACCESS_LABEL[m.access])}</span>`;
}

function stepTags(m: Mission): string {
  return m.steps.map((id) => `<span class="tag" title="${esc(actionPlanStep(id)?.title || '')}">${esc(id)}</span>`).join('');
}

function missionCard(m: Mission): string {
  return `<a class="mcard" href="${missionHref(m)}"><div class="mid">${esc(m.id)}${m.minutes ? ` · ~${m.minutes} min` : ''}</div>`
    + `<h3>${esc(m.title)}</h3><p>${esc(m.learn)}</p><div class="tags">${accessTags(m)}${stepTags(m)}</div></a>`;
}

/** Which missions / Outside entries cover an Action Plan step. */
export function coverageFor(stepId: string): { missions: Mission[]; outside: string | null } {
  return {
    missions: MISSIONS.filter((m) => m.steps.includes(stepId)),
    outside: OUTSIDE_STEPS.find((o) => o.step === stepId)?.principle ?? null,
  };
}

/** Everything the Tutorial Library can find: missions, truth rules and all 27 Action Plan steps. */
export function libraryItems(): Array<{ kind: string; key: string; title: string; text: string; href: string | null; haystack: string }> {
  const items: Array<{ kind: string; key: string; title: string; text: string; href: string | null; haystack: string }> = [];
  for (const m of MISSIONS) {
    const s = stageOf(m.stage);
    const text = m.learn;
    const steps = m.steps.map((id) => `${id} ${actionPlanStep(id)?.title || ''}`).join(' ');
    items.push({
      kind: `${s.level} · ${ACCESS_LABEL[m.access]}`, key: m.id, title: m.title, text, href: missionHref(m),
      haystack: [m.id, m.title, m.learn, m.why, m.example, m.mindy, ...(m.truths || []), ...(m.howTo || []), steps, s.level, s.name, ACCESS_LABEL[m.access]].filter(Boolean).join(' ').toLowerCase(),
    });
  }
  for (const st of ACTION_PLAN_STEPS) {
    const cov = coverageFor(st.id);
    const text = cov.outside
      ? `Outside Mindy. ${cov.outside}`
      : `Covered by: ${cov.missions.map((m) => m.title).join(' · ')}`;
    const href = cov.missions.length ? missionHref(cov.missions[0]) : null;
    items.push({
      kind: `Action Plan · Phase ${st.phase} ${st.phaseName}`, key: st.id, title: st.title, text, href,
      haystack: [st.id, st.title, st.phaseName, text].join(' ').toLowerCase(),
    });
  }
  return items;
}

const LIBRARY_JS = `<script>(function(){
  var input=document.getElementById('libq'); if(!input)return;
  var rows=[].slice.call(document.querySelectorAll('#libList li'));
  var count=document.getElementById('libCount');
  function run(){
    var q=input.value.trim().toLowerCase(); var terms=q.split(/\\s+/).filter(Boolean); var n=0;
    rows.forEach(function(li){
      var hay=li.getAttribute('data-h')||''; var hit=terms.every(function(t){return hay.indexOf(t)!==-1;});
      li.hidden=!hit; if(hit)n++;
    });
    count.textContent=q?(n+' result'+(n===1?'':'s')+' for \\u201c'+input.value.trim()+'\\u201d'+(n?'':' \\u2014 try another word, a step ID like P2-01, or a term like recompete')):(rows.length+' tutorials and Action Plan steps');
  }
  input.addEventListener('input',run); run();
})();</script>`;

export function learnIndexHtml(): string {
  const stageSection = (k: StageKey) => {
    const s = stageOf(k);
    return `<section class="stage${k === 'after' ? ' later' : ''}" id="${k}"><div class="lw">`
      + `<div class="lvl">${esc(s.level)}</div><h2>${esc(s.name)}</h2><p class="blurb">${esc(s.blurb)}</p>`
      + `<div class="mgrid">${missionsIn(k).map(missionCard).join('')}</div></div></section>`;
  };
  const plan = ACTION_PLAN.map((p) => `<div class="phase"><h3>Phase ${p.n} · ${esc(p.name)}<span class="cad">${p.cadence}</span></h3><ul class="steps">`
    + p.steps.map((st) => {
      const cov = coverageFor(st.id);
      const covHtml = cov.outside
        ? `<span class="cov">Outside Mindy — ${esc(cov.outside)}</span>`
        : `<span class="cov">${cov.missions.map((m) => `<a href="${missionHref(m)}">${esc(m.title)}</a>`).join(' · ')}</span>`;
      return `<li><span class="sid">${esc(st.id)}</span><span>${esc(st.title)}${covHtml}</span></li>`;
    }).join('') + `</ul></div>`).join('');
  const lib = libraryItems().map((it) => `<li data-h="${esc(it.haystack)}"><div class="k">${esc(it.key)} · ${esc(it.kind)}</div>`
    + `<div>${it.href ? `<a href="${it.href}">${esc(it.title)}</a>` : `<b>${esc(it.title)}</b>`}</div><p>${esc(it.text)}</p></li>`).join('');

  const body = `<section class="lhero"><div class="lw">
  <div class="eyebrow">Mindy Learn</div>
  <h1>Your GovCon Action Plan</h1>
  <p class="sub">Learn how the federal market really works, then do it in Mindy. Beginner, Intermediate and Advanced are stages, not levels you have to pick: start anywhere. Every tutorial is free to read. Sign in only to save what you do in Mindy.</p>
  <nav class="lnav" aria-label="Learn sections">
    <a href="#learn">Beginner · Learn the Game</a><a href="#play">Intermediate · Play the Game</a><a href="#win">Advanced · Win the Game</a><a href="#library">Tutorial Library</a><a href="#action-plan">The 27-step Action Plan</a>
  </nav>
</div></section>
${stageSection('learn')}
${stageSection('play')}
${stageSection('win')}
${stageSection('after')}
<section class="lib" id="library"><div class="lw">
  <div class="eyebrow">Tutorial Library</div>
  <h2>Search every tutorial and Action Plan step</h2>
  <label for="libq" class="note" style="display:block;margin-top:10px">Search by topic, term or step ID (for example “sources sought”, “incumbent” or “P2-01”).</label>
  <input id="libq" type="search" autocomplete="off" placeholder="Search the Tutorial Library">
  <div class="count" id="libCount" aria-live="polite"></div>
  <ul id="libList">${lib}</ul>
</div></section>
<section class="ap" id="action-plan"><div class="lw">
  <div class="eyebrow">The GovCon Action Plan</div>
  <h2>All 27 steps, and where each one is taught</h2>
  <p class="note" style="margin-top:10px">Steps Mindy can’t do for you are marked Outside Mindy, with the principle to follow.</p>
  ${plan}
</div></section>`;
  return page({
    title: 'Mindy Learn — Your GovCon Action Plan',
    description: 'Free GovCon tutorials: learn how federal buyers buy, then do each step in Mindy. Beginner, Intermediate and Advanced stages mapped to the 27-step GovCon Action Plan.',
    path: '/learn', body, script: LIBRARY_JS,
  });
}

export function missionHtml(m: Mission): string {
  const s = stageOf(m.stage);
  const steps = m.steps.map((id) => `${id} ${actionPlanStep(id)?.title || ''}`).join(' · ');
  const sec = (title: string, inner: string) => `<section class="msec"><h2>${esc(title)}</h2>${inner}</section>`;
  const next = m.next ? missionById(m.next) : null;

  let action = '';
  if (m.status === 'live' && m.doIt) {
    action = `<div class="doit"><a class="btn" href="${esc(m.doIt.href)}">${esc(m.doIt.label)} →</a>`
      + `<span class="tags">${accessTags(m)}</span>${m.accessNote ? `<span class="note">${esc(m.accessNote)}</span>` : ''}</div>`;
  } else if (m.status === 'coming-next') {
    action = `<div class="doit"><div class="unavail"><b>Coming next.</b> This isn’t available in Mindy yet. Learn the principle here; the workflow will appear in Mindy when it ships.${m.accessNote ? ` ${esc(m.accessNote)}` : ''}</div></div>`;
  } else if (m.status === 'outside') {
    action = `<div class="doit"><div class="unavail"><b>Outside Mindy.</b> Mindy can’t do this step for you. Follow the principle above.</div></div>`;
  }

  const body = `<div class="lw">
  <div class="crumb"><a href="/learn">Learn</a> › <a href="/learn#${m.stage}">${esc(s.level)} · ${esc(s.name)}</a></div>
  <header class="mhead">
    <div class="eyebrow">${esc(s.level)} · ${esc(s.name)}</div>
    <h1>${esc(m.title)}</h1>
    <div class="meta">${m.minutes ? `~${m.minutes} min · ` : ''}${steps ? `Action Plan: ${esc(steps)}` : 'Cross-cutting'}</div>
    <div class="tags">${accessTags(m)}</div>
  </header>
  ${sec('What you’ll learn', `<p>${esc(m.learn)}</p>`)}
  ${m.why ? sec('Why it matters', `<p>${esc(m.why)}</p>`) : ''}
  ${m.example ? sec('A practical example', `<p>${esc(m.example)}</p>`) : ''}
  ${m.truths && m.truths.length ? sec(m.truths.length > 1 ? 'Truth rules' : 'Truth rule', m.truths.map((t) => `<div class="truth">${esc(t)}</div>`).join('')) : ''}
  ${sec('What Mindy can do', `<p>${esc(m.mindy)}</p>`)}
  ${m.howTo && m.howTo.length ? sec('Step by step', `<ol>${m.howTo.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>`) : ''}
  ${action}
  ${m.glossary && m.glossary.length ? sec('Terms', `<p class="gl">${m.glossary.map((g) => `<a href="/glossary/${esc(g)}">${esc(g.replace(/-/g, ' '))}</a>`).join('')}</p>`) : ''}
  <div class="nextm">${next ? `<div class="eyebrow">Next</div><a href="${missionHref(next)}">${esc(next.title)} →</a>` : `<a href="/learn">Back to your Action Plan →</a>`}</div>
</div>`;
  return page({
    title: `${m.title} — Mindy Learn`,
    description: m.learn,
    path: missionHref(m),
    body,
  });
}
