'use client';

/**
 * The "Mindy in your AI" gallery: a dark wall of finished results (the Higgsfield
 * content-factory pattern). Cards show the finished result; clicking one opens it large.
 *
 * Prompts are fetched from /api/mcp/gallery/prompts, which answers only for a signed-in
 * session. Signed out, the prompt box is a locked placeholder with a sign-in link; the prompt
 * text never reaches the browser. No credit amounts appear anywhere on this page.
 */
import { useEffect, useMemo, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { GALLERY_CATEGORIES, type GalleryCategory, type GalleryItem, type GalleryPreview } from '@/lib/mcp/gallery';

type PromptState = { status: 'loading' } | { status: 'signed-out' } | { status: 'ready'; prompts: Record<string, string> };

const SIGN_IN = '/app?next=%2Fmcp%2Fgallery';

export default function Gallery({ items }: { items: GalleryItem[] }) {
  const [tab, setTab] = useState<GalleryCategory | 'all'>('all');
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const [prompts, setPrompts] = useState<PromptState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    fetch('/api/mcp/gallery/prompts', { headers: getMIApiHeaders(), cache: 'no-store' })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) return setPrompts({ status: 'signed-out' });
        const d = await r.json().catch(() => null);
        setPrompts(d?.prompts ? { status: 'ready', prompts: d.prompts } : { status: 'signed-out' });
      })
      .catch(() => alive && setPrompts({ status: 'signed-out' }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const shown = useMemo(() => (tab === 'all' ? items : items.filter((i) => i.category === tab)), [items, tab]);

  return (
    <div className="mg">
      <style>{CSS}</style>
      <section className="mg-hero">
        <p className="mg-kicker">Mindy in your AI</p>
        <h1 className="mg-h1">
          Ask in plain English.
          <br />
          <span>Get the finished work back.</span>
        </h1>
        <p className="mg-lede">
          Connect Mindy to Claude, ChatGPT or any AI agent. One question returns a finished result built from the official federal
          record: bids, incumbents, buyers, rates, and a proposal draft.
        </p>
        <div className="mg-ctas">
          <a className="mg-btn mg-btn--pri" href="/mcp">
            Connect Mindy
          </a>
          <a className="mg-btn" href="/mcp/about">
            How it works
          </a>
        </div>
        <div className="mg-hosts" aria-label="Works with">
          <span>Claude</span>
          <span>ChatGPT</span>
          <span>Cursor</span>
          <span>Any MCP agent</span>
        </div>
      </section>

      <nav className="mg-tabs" aria-label="Filter results">
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          All
        </button>
        {GALLERY_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={tab === c.id ? 'on' : ''} onClick={() => setTab(c.id)}>
            {c.label}
          </button>
        ))}
      </nav>

      <div className="mg-grid">
        {shown.map((item) => (
          <button key={item.id} type="button" className="mg-card" onClick={() => setOpen(item)} aria-label={`Open: ${item.title}`}>
            <span className="mg-frame">
              <Preview item={item} />
            </span>
            <span className="mg-cap">
              <span className="mg-cat">{GALLERY_CATEGORIES.find((c) => c.id === item.category)?.label}</span>
              <span className="mg-title">{item.title}</span>
              <span className="mg-see">{prompts.status === 'ready' ? 'See the prompt →' : 'See the result →'}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="mg-foot">Sample results: company names and figures are illustrative. A real answer comes from live federal data.</p>

      <section className="mg-end">
        <h2>Your first answer is a sign-in away.</h2>
        <p>Connect in your browser. No API key to copy.</p>
        <div className="mg-ctas mg-ctas--c">
          <a className="mg-btn mg-btn--pri" href="/mcp">
            Connect Mindy
          </a>
          <a className="mg-btn" href="/signup">
            Create a free account
          </a>
        </div>
      </section>

      {open && <Detail item={open} prompts={prompts} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Detail({ item, prompts, onClose }: { item: GalleryItem; prompts: PromptState; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = prompts.status === 'ready' ? prompts.prompts[item.id] : null;
  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the prompt is visible and selectable */
    }
  };
  return (
    <div className="mg-modal" role="dialog" aria-modal="true" aria-label={item.title} onClick={onClose}>
      <div className="mg-sheet" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mg-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="mg-sheet-media">
          <Preview item={item} large />
        </div>
        <div className="mg-sheet-body">
          <span className="mg-cat">{GALLERY_CATEGORIES.find((c) => c.id === item.category)?.label}</span>
          <h3>{item.title}</h3>
          <p className="mg-result">{item.result}</p>
          <p className="mg-label">The prompt</p>
          {prompts.status === 'ready' && text ? (
            <>
              <p className="mg-prompt">{text}</p>
              <button type="button" className="mg-btn mg-btn--pri mg-btn--sm" onClick={copy}>
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
            </>
          ) : (
            <div className="mg-locked">
              <span className="mg-blur" aria-hidden="true">
                <i style={{ width: '92%' }} />
                <i style={{ width: '78%' }} />
                <i style={{ width: '64%' }} />
              </span>
              <p>{prompts.status === 'loading' ? 'Checking your account…' : 'Sign in to see the exact prompt and copy it into your AI.'}</p>
              {prompts.status === 'signed-out' && (
                <a className="mg-btn mg-btn--pri mg-btn--sm" href={SIGN_IN}>
                  Sign in to see the prompt
                </a>
              )}
            </div>
          )}
          <p className="mg-fine">Works in Claude, ChatGPT, Cursor or any MCP agent once Mindy is connected.</p>
        </div>
      </div>
    </div>
  );
}

function Preview({ item, large = false }: { item: GalleryItem; large?: boolean }) {
  return (
    <span className={`mg-doc${large ? ' mg-doc--lg' : ''}`}>
      <span className="mg-doc-bar">
        <b>Mindy</b>
        <span>{item.docTitle}</span>
      </span>
      <span className="mg-doc-body">
        <Body p={item.preview} />
      </span>
    </span>
  );
}

function Body({ p }: { p: GalleryPreview }) {
  switch (p.kind) {
    case 'horizons':
      return (
        <span className="pv-hz">
          {p.columns.map((c) => (
            <span key={c.label} className="pv-hz-col">
              <span className="pv-k">{c.label}</span>
              <b className="pv-big">{c.count}</b>
              {c.items.map((t) => (
                <span key={t} className="pv-line">
                  {t}
                </span>
              ))}
            </span>
          ))}
        </span>
      );
    case 'table':
      return (
        <span className="pv-tbl" style={{ gridTemplateColumns: `1.6fr ${p.columns.slice(1).map(() => '1fr').join(' ')}` }}>
          {p.columns.map((c) => (
            <span key={c} className="pv-th">
              {c}
            </span>
          ))}
          {p.rows.flatMap((r, ri) =>
            r.map((cell, ci) => (
              <span key={`${ri}-${ci}`} className={`pv-td${p.highlight === ci ? ' pv-hi' : ''}${ci > 0 ? ' pv-r' : ''}`}>
                {cell}
              </span>
            )),
          )}
        </span>
      );
    case 'bars':
      return (
        <span className="pv-bars">
          <b className="pv-big">{p.headline}</b>
          <span className="pv-k">{p.sub}</span>
          {p.bars.map((b) => (
            <span key={b.label} className="pv-bar">
              <span className="pv-bar-l">{b.label}</span>
              <span className="pv-bar-t">
                <i style={{ width: `${b.pct}%` }} />
              </span>
              <span className="pv-bar-v">{b.value}</span>
            </span>
          ))}
        </span>
      );
    case 'dossier':
      return (
        <span className="pv-dos">
          <span className="pv-chip">{p.badge}</span>
          {p.fields.map(([k, v]) => (
            <span key={k} className="pv-kv">
              <span>{k}</span>
              <b>{v}</b>
            </span>
          ))}
          <span className="pv-note">{p.note}</span>
        </span>
      );
    case 'people':
      return (
        <span className="pv-ppl">
          <span className="pv-k">{p.office}</span>
          {p.people.map((x) => (
            <span key={x.name} className="pv-person">
              <span className="pv-av" aria-hidden="true" />
              <span>
                <b>{x.name}</b>
                <span>{x.role}</span>
              </span>
            </span>
          ))}
        </span>
      );
    case 'verdict':
      return (
        <span className="pv-ver">
          <span className="pv-ver-top">
            <b className="pv-ver-v">{p.verdict}</b>
            <span className="pv-ring" style={{ ['--p' as string]: `${p.score}` }}>
              <span>{p.score}</span>
            </span>
          </span>
          {p.reasons.map((r) => (
            <span key={r.text} className="pv-reason">
              <i className={r.ok ? 'ok' : 'no'}>{r.ok ? '✓' : '!'}</i>
              {r.text}
            </span>
          ))}
        </span>
      );
    case 'matrix':
      return (
        <span className="pv-mx">
          {p.rows.map((r) => (
            <span key={r.ref} className="pv-mx-row">
              <span className="pv-ref">{r.ref}</span>
              <span className="pv-req">{r.req}</span>
              <span className={`pv-st ${r.status}`}>{r.status === 'ok' ? r.section : 'Missing'}</span>
            </span>
          ))}
        </span>
      );
    case 'doc':
      return (
        <span className="pv-docx">
          <b>{p.heading}</b>
          {p.paragraphs.map((t) => (
            <span key={t} className="pv-para">
              {t}
            </span>
          ))}
          <span className="pv-fade" aria-hidden="true" />
        </span>
      );
    case 'list':
      return (
        <span className="pv-list">
          {p.items.map((x) => (
            <span key={x.title} className="pv-li">
              <span>
                <b>{x.title}</b>
                <span>{x.meta}</span>
              </span>
              {x.tag && <span className="pv-chip">{x.tag}</span>}
            </span>
          ))}
        </span>
      );
  }
}

/* A deliberately dark, single-theme page (gallery wall). Not part of the light public design
   system; listed in docs/design/public-site/NOT-MIGRATED.md. */
const CSS = `
.mg{--bg:#0A0B0D;--panel:#13151A;--line:#262A31;--ink:#F3F4F6;--mute:#9BA1AC;--acc:#D7FF3F;--acc-ink:#0A0B0D;--blue:#7DB4FF;--ok:#4ADE80;--warn:#FBBF24;
  background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif;color-scheme:dark;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:72px 96px}
.mg *{box-sizing:border-box}
.mg-hero{max-width:1180px;margin:0 auto;text-align:center}
.mg-kicker{display:inline-block;font:700 12px/1 Inter,system-ui;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);border:1px solid rgba(215,255,63,.35);border-radius:999px;padding:8px 14px;margin:0}
.mg-h1{font:800 clamp(2.4rem,6.4vw,4.8rem)/1.02 Inter,system-ui;letter-spacing:-.035em;margin:22px auto 0;max-width:15ch;text-wrap:balance}
.mg-h1 span{color:var(--mute)}
.mg-lede{max-width:60ch;margin:22px auto 0;color:var(--mute);font-size:1.1rem;line-height:1.6}
.mg-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:30px}
.mg-btn{display:inline-flex;align-items:center;justify-content:center;font:600 15px Inter,system-ui;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:12px;padding:13px 22px;text-decoration:none;cursor:pointer;transition:border-color .15s,transform .15s}
.mg-btn:hover{border-color:#4a505b}
.mg-btn--pri{background:var(--acc);color:var(--acc-ink);border-color:var(--acc)}
.mg-btn--pri:hover{transform:translateY(-1px);border-color:var(--acc)}
.mg-btn--sm{padding:10px 16px;font-size:14px;border-radius:10px}
.mg-btn:focus-visible,.mg-card:focus-visible,.mg-tabs button:focus-visible,.mg-x:focus-visible{outline:2px solid var(--acc);outline-offset:3px}
.mg-hosts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:26px}
.mg-hosts span{font:500 12px Inter,system-ui;color:var(--mute);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.mg-tabs{max-width:1180px;margin:64px auto 22px;display:flex;gap:8px;flex-wrap:wrap}
.mg-tabs button{font:600 14px Inter,system-ui;color:var(--mute);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:9px 16px;cursor:pointer}
.mg-tabs button.on{color:var(--acc-ink);background:var(--ink);border-color:var(--ink)}
.mg-grid{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
@media(max-width:980px){.mg-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.mg-grid{grid-template-columns:minmax(0,1fr)}}
.mg-card{all:unset;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;cursor:pointer;transition:transform .2s,border-color .2s}
.mg-card:hover{transform:translateY(-4px);border-color:#3b414b}
.mg-frame{display:block;aspect-ratio:4/3;padding:18px 18px 0;background:radial-gradient(120% 90% at 50% 0%,#1d2230 0%,#13151A 70%);overflow:hidden}
.mg-cap{display:grid;gap:6px;padding:16px 18px 18px;border-top:1px solid var(--line)}
.mg-cat{font:700 11px Inter,system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
.mg-title{font:700 17px/1.3 Inter,system-ui;color:var(--ink)}
.mg-see{font:500 13px Inter,system-ui;color:var(--mute)}
.mg-card:hover .mg-see{color:var(--ink)}
.mg-foot{max-width:1180px;margin:22px auto 0;color:var(--mute);font-size:13px}
.mg-end{max-width:760px;margin:96px auto 0;text-align:center}
.mg-end h2{font:800 clamp(1.8rem,4vw,2.8rem)/1.1 Inter,system-ui;letter-spacing:-.03em;margin:0;text-wrap:balance}
.mg-end p{color:var(--mute);margin:14px 0 0}
/* finished-result previews */
.mg-doc{display:flex;flex-direction:column;height:100%;background:#F7F8FA;color:#14171D;border-radius:12px 12px 0 0;box-shadow:0 20px 50px rgba(0,0,0,.45);overflow:hidden;font-family:Inter,system-ui;text-align:left}
.mg-doc--lg{border-radius:14px;height:auto;min-height:100%}
.mg-doc-bar{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 12px;background:#14171D;color:#E8EAEE;font-size:11px}
.mg-doc-bar b{color:var(--acc);letter-spacing:.04em}
.mg-doc-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-doc-body{display:block;padding:12px;font-size:11.5px;line-height:1.4;flex:1;overflow:hidden}
.mg-doc--lg .mg-doc-body{padding:20px;font-size:14px}
.pv-k{display:block;font-size:.85em;color:#5F6672}
.pv-big{display:block;font-size:2em;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.pv-line{display:block;color:#3B414B;border-top:1px solid #E3E6EB;padding-top:4px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-hz{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pv-hz-col{display:block;background:#fff;border:1px solid #E3E6EB;border-radius:8px;padding:8px;min-width:0}
.pv-tbl{display:grid;gap:0;background:#fff;border:1px solid #E3E6EB;border-radius:8px;overflow:hidden}
.pv-th{font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5F6672;padding:7px 8px;background:#EEF0F3}
.pv-td{padding:7px 8px;border-top:1px solid #EEF0F3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-r{text-align:right;font-variant-numeric:tabular-nums}
.pv-hi{font-weight:800;color:#1E3A8A}
.pv-bars{display:grid;gap:6px}
.pv-bar{display:grid;grid-template-columns:minmax(0,1.3fr) 1.4fr auto;gap:8px;align-items:center}
.pv-bar-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-bar-t{height:8px;background:#E3E6EB;border-radius:4px;overflow:hidden}
.pv-bar-t i{display:block;height:100%;background:#1E3A8A;border-radius:4px}
.pv-bar-v{font-weight:700;font-variant-numeric:tabular-nums}
.pv-dos{display:grid;gap:6px}
.pv-chip{justify-self:start;display:inline-block;font-size:.8em;font-weight:700;color:#14532D;background:#DCFCE7;border-radius:999px;padding:3px 8px;white-space:nowrap}
.pv-kv{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #E3E6EB;padding-bottom:4px}
.pv-kv span{color:#5F6672}
.pv-note{color:#5F6672;font-style:italic}
.pv-ppl{display:grid;gap:8px}
.pv-person{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #E3E6EB;border-radius:8px;padding:8px}
.pv-person b,.pv-person span span{display:block}
.pv-person span span{color:#5F6672}
.pv-av{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#CBD5E1,#94A3B8);flex:none}
.pv-ver{display:grid;gap:8px}
.pv-ver-top{display:flex;justify-content:space-between;align-items:center}
.pv-ver-v{font-size:2.2em;font-weight:800;color:#15803D}
.pv-ring{--p:0;width:54px;height:54px;border-radius:50%;background:conic-gradient(#15803D calc(var(--p)*1%),#E3E6EB 0);display:grid;place-items:center}
.pv-ring span{width:40px;height:40px;border-radius:50%;background:#F7F8FA;display:grid;place-items:center;font-weight:800}
.pv-reason{display:flex;gap:8px;align-items:center}
.pv-reason i{font-style:normal;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:.8em;font-weight:800;flex:none}
.pv-reason i.ok{background:#DCFCE7;color:#15803D}
.pv-reason i.no{background:#FEF3C7;color:#B45309}
.pv-mx{display:grid;gap:5px}
.pv-mx-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;background:#fff;border:1px solid #E3E6EB;border-radius:6px;padding:6px 8px}
.pv-ref{font-family:ui-monospace,monospace;color:#5F6672}
.pv-req{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-st{font-weight:700;font-size:.85em;white-space:nowrap}
.pv-st.ok{color:#15803D}.pv-st.gap{color:#B45309}
.pv-docx{display:grid;gap:8px;position:relative;background:#fff;border:1px solid #E3E6EB;border-radius:6px;padding:12px;font-family:Georgia,'Times New Roman',serif}
.pv-para{display:block;color:#3B414B}
.pv-fade{position:absolute;left:0;right:0;bottom:0;height:40px;background:linear-gradient(transparent,#fff)}
.mg-doc--lg .pv-fade{display:none}
.pv-list{display:grid;gap:6px}
.pv-li{display:flex;justify-content:space-between;gap:8px;align-items:center;background:#fff;border:1px solid #E3E6EB;border-radius:8px;padding:8px}
.pv-li b,.pv-li span span{display:block}
.pv-li > span:first-child{min-width:0}
.pv-li b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-li span span{color:#5F6672}
/* detail sheet */
.mg-modal{position:fixed;inset:0;z-index:100;background:rgba(5,6,8,.78);backdrop-filter:blur(6px);display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.mg-sheet{position:relative;width:min(1040px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:20px;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}
@media(max-width:820px){.mg-sheet{grid-template-columns:minmax(0,1fr)}}
.mg-sheet-media{padding:24px;background:radial-gradient(120% 90% at 50% 0%,#1d2230 0%,#13151A 70%)}
.mg-sheet-body{padding:28px 26px;display:flex;flex-direction:column;gap:12px}
.mg-sheet-body h3{font:800 1.6rem/1.15 Inter,system-ui;letter-spacing:-.02em;margin:0}
.mg-result{color:var(--mute);margin:0;line-height:1.55}
.mg-label{font:700 11px Inter,system-ui;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);margin:10px 0 0}
.mg-prompt{margin:0;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px;line-height:1.55;user-select:text}
.mg-locked{display:grid;gap:12px;background:var(--bg);border:1px dashed #3a3f48;border-radius:12px;padding:14px}
.mg-locked p{margin:0;color:var(--mute);font-size:14px}
.mg-blur{display:grid;gap:8px}
.mg-blur i{display:block;height:10px;border-radius:6px;background:linear-gradient(90deg,#262A31,#30353e,#262A31)}
.mg-fine{color:var(--mute);font-size:13px;margin:auto 0 0}
.mg-x{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:22px;line-height:1;cursor:pointer;z-index:1}
.mg-ctas--c{justify-content:center}
@media (prefers-reduced-motion:reduce){.mg-card,.mg-btn{transition:none}.mg-card:hover{transform:none}}
`;
