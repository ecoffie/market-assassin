'use client';

/**
 * The "Mindy in your AI" gallery, in the public design system (cream canvas, serif headings,
 * navy actions). The four most visual results are featured large; the rest are a list.
 * Clicking either opens the result with its prompt.
 *
 * Prompts are fetched from /api/mcp/gallery/prompts, which answers only for a signed-in
 * session. Signed out, the prompt box is a locked placeholder with a sign-in link; the prompt
 * text never reaches the browser. No credit amounts appear anywhere on this page.
 */
import { useEffect, useMemo, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { ButtonLink, Container, Eyebrow, Heading, Section, Standfirst } from '@/components/public-site/ui';
import { GALLERY_CATEGORIES, type GalleryCategory, type GalleryItem, type GalleryPreview } from '@/lib/mcp/gallery';

type PromptState = { status: 'loading' } | { status: 'signed-out' } | { status: 'ready'; prompts: Record<string, string> };

const SIGN_IN = '/app?next=%2Fmcp%2Fgallery';
const catLabel = (c: GalleryCategory) => GALLERY_CATEGORIES.find((x) => x.id === c)?.label ?? '';

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

  const featured = items.filter((i) => i.featured);
  const rest = useMemo(() => items.filter((i) => !i.featured && (tab === 'all' || i.category === tab)), [items, tab]);

  return (
    <div className="mg">
      <style>{CSS}</style>

      <Section>
        <Container>
          <Eyebrow accent>Mindy in your AI</Eyebrow>
          <Heading as="h1" variant="display" style={{ marginTop: 12 }}>
            Ask in plain English. Get the finished work back.
          </Heading>
          <Standfirst>
            Connect Mindy to Claude, ChatGPT or any AI agent. One question returns a finished result built from the official
            federal record: bids, incumbents, buyers, rates and a proposal draft.
          </Standfirst>
          <div className="mg-ctas">
            <ButtonLink href="/mcp">Connect Mindy</ButtonLink>
            <ButtonLink href="/mcp/about" variant="secondary">
              How it works
            </ButtonLink>
          </div>
          <p className="mp-meta" style={{ marginTop: 14 }}>
            Works in Claude, ChatGPT, Cursor and any MCP agent.
          </p>
        </Container>
      </Section>

      <Section>
        <Container width="wide">
          <p className="mp-label">Featured results</p>
          <div className="mg-feat">
            {featured.map((item) => (
              <button key={item.id} type="button" className="mg-fcard" onClick={() => setOpen(item)} aria-label={`Open: ${item.title}`}>
                <span className="mg-stage">
                  <Preview item={item} />
                </span>
                <span className="mg-fcap">
                  <span className="mg-cat">{catLabel(item.category)}</span>
                  <span className="mg-ftitle">{item.title}</span>
                  <span className="mg-fsub">{item.result}</span>
                  <span className="mg-go">{prompts.status === 'ready' ? 'See the result and prompt →' : 'See the result →'}</span>
                </span>
              </button>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container width="wide">
          <div className="mg-listhead">
            <Heading as="h2" variant="title">
              Everything else you can ask
            </Heading>
            <nav className="mg-tabs" aria-label="Filter the list">
              <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
                All
              </button>
              {GALLERY_CATEGORIES.map((c) => (
                <button key={c.id} type="button" aria-pressed={tab === c.id} onClick={() => setTab(c.id)}>
                  {c.label}
                </button>
              ))}
            </nav>
          </div>
          <ul className="mg-list">
            {rest.map((item) => (
              <li key={item.id}>
                <button type="button" className="mg-row" onClick={() => setOpen(item)}>
                  <span className="mg-row-main">
                    <span className="mg-row-title">{item.title}</span>
                    <span className="mg-row-sub">{item.result}</span>
                  </span>
                  <span className="mg-cat mg-row-cat">{catLabel(item.category)}</span>
                  <span className="mg-row-go" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
            {rest.length === 0 && <li className="mp-meta">Nothing else in this group. The featured results above cover it.</li>}
          </ul>
          <p className="mp-meta" style={{ marginTop: 18 }}>
            Sample results: company names and figures are illustrative. A real answer comes from live federal data.
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="mp-panel mg-end">
            <Heading as="h2" variant="title">
              Your first answer is a sign-in away.
            </Heading>
            <p className="mp-meta" style={{ marginTop: 8 }}>
              Connect in your browser. No API key to copy.
            </p>
            <div className="mg-ctas">
              <ButtonLink href="/mcp">Connect Mindy</ButtonLink>
              <ButtonLink href="/signup" variant="secondary">
                Create a free account
              </ButtonLink>
            </div>
          </div>
        </Container>
      </Section>

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
          <span className="mg-cat">{catLabel(item.category)}</span>
          <Heading as="h3" variant="title">
            {item.title}
          </Heading>
          <p className="mg-result">{item.result}</p>
          <p className="mp-label" style={{ marginTop: 8 }}>
            The prompt
          </p>
          {prompts.status === 'ready' && text ? (
            <>
              <p className="mg-prompt">{text}</p>
              <button type="button" className="mp-btn mp-btn--primary mp-btn--sm" onClick={copy}>
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
                <a className="mp-btn mp-btn--primary mp-btn--sm" href={SIGN_IN}>
                  Sign in to see the prompt
                </a>
              )}
            </div>
          )}
          <p className="mp-meta" style={{ marginTop: 'auto' }}>
            Works in Claude, ChatGPT, Cursor or any MCP agent once Mindy is connected.
          </p>
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
            <span key={c.label} className="pv-box">
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
        <span className="pv-stack">
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
        <span className="pv-stack">
          <span className="pv-k">{p.office}</span>
          {p.people.map((x) => (
            <span key={x.name} className="pv-box pv-person">
              <span className="pv-av" aria-hidden="true" />
              <span>
                <b>{x.name}</b>
                <span className="pv-k">{x.role}</span>
              </span>
            </span>
          ))}
        </span>
      );
    case 'verdict':
      return (
        <span className="pv-stack">
          <span className="pv-ver-top">
            <b className="pv-ver-v">{p.verdict}</b>
            <span className="pv-score">
              <b>{p.score}</b>
              <span className="pv-k">fit score</span>
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
        <span className="pv-stack">
          {p.rows.map((r) => (
            <span key={r.ref} className="pv-box pv-mx">
              <span className="pv-ref">{r.ref}</span>
              <span className="pv-req">{r.req}</span>
              <span className={`pv-st ${r.status}`}>{r.status === 'ok' ? r.section : 'Missing'}</span>
            </span>
          ))}
        </span>
      );
    case 'doc':
      return (
        <span className="pv-box pv-docx">
          <b>{p.heading}</b>
          {p.paragraphs.map((t) => (
            <span key={t} className="pv-para">
              {t}
            </span>
          ))}
        </span>
      );
    case 'capability':
      return (
        <span className="cs">
          <span className="cs-head">
            <span className="cs-logo" aria-hidden="true">{p.company.slice(0, 1)}</span>
            <span className="cs-id">
              <b>{p.company}</b>
              <span>{p.tagline}</span>
            </span>
          </span>
          <span className="cs-grid">
            <span className="cs-col">
              <span className="cs-h">Core competencies</span>
              {p.competencies.map((c) => (
                <span key={c} className="cs-li">{c}</span>
              ))}
              <span className="cs-h">Differentiators</span>
              {p.differentiators.map((c) => (
                <span key={c} className="cs-li cs-li--ok">{c}</span>
              ))}
            </span>
            <span className="cs-col">
              <span className="cs-h">Past performance</span>
              {p.pastPerformance.map((x, i) => (
                <span key={x.work} className="cs-pp">
                  <span className={`cs-ag cs-ag--${i}`}>{x.agency}</span>
                  <span className="cs-pp-w">{x.work}</span>
                  <b>{x.value}</b>
                </span>
              ))}
              <span className="cs-h">NAICS</span>
              <span className="cs-chips">
                {p.naics.map((n) => (
                  <span key={n} className="cs-naics">{n}</span>
                ))}
              </span>
              <span className="cs-h">Certifications</span>
              <span className="cs-chips">
                {p.certs.map((n) => (
                  <span key={n} className="cs-cert">{n}</span>
                ))}
              </span>
            </span>
          </span>
          <span className="cs-foot">
            {p.data.map(([k, v]) => (
              <span key={k}>
                {k} <b>{v}</b>
              </span>
            ))}
          </span>
        </span>
      );
    case 'report':
      return (
        <span className="rp">
          <span className="rp-top">
            <span>
              <b className="pv-big">{p.headline}</b>
              <span className="pv-k">{p.sub}</span>
            </span>
          </span>
          <span className="rp-grid">
            <span className="rp-donut">
              <Donut parts={p.agencies.map((a) => a.pct)} />
              <span className="rp-legend">
                {p.agencies.map((a, i) => (
                  <span key={a.label}>
                    <i className={`sw sw--${i}`} />
                    {a.label} <b>{a.value}</b>
                  </span>
                ))}
              </span>
            </span>
            <span className="rp-win">
              <span className="cs-h">Top winners</span>
              {p.winners.map((w, i) => (
                <span key={w.label} className="rp-bar">
                  <span className="rp-bar-l">{w.label}</span>
                  <span className="pv-bar-t">
                    <i className={`fill--${i}`} style={{ width: `${w.pct}%` }} />
                  </span>
                  <b>{w.value}</b>
                </span>
              ))}
            </span>
          </span>
          <span className="cs-h">Set-aside mix</span>
          <span className="stack">
            {p.setAside.map((x, i) => (
              <i key={x.label} className={`fill--${i}`} style={{ width: `${x.pct}%` }} title={`${x.label} ${x.pct}%`} />
            ))}
          </span>
          <span className="rp-legend rp-legend--row">
            {p.setAside.map((x, i) => (
              <span key={x.label}>
                <i className={`sw sw--${i}`} />
                {x.label} {x.pct}%
              </span>
            ))}
          </span>
        </span>
      );
    case 'map':
      return (
        <span className="mp-map">
          <svg viewBox="0 0 200 260" className="mp-map-svg" role="img" aria-label={`Map of ${p.region} with opportunity pins`}>
            <rect x="0" y="0" width="200" height="260" className="mp-water" />
            <path
              d="M0,30 L118,30 L124,20 L150,22 L156,40 L150,60 L158,90 L172,140 L182,190 L180,230 L168,252 L150,250 L138,236 L124,214 L108,196 L92,180 L80,168 L66,150 L60,120 L72,96 L86,78 L70,62 L46,58 L20,56 L0,52 Z"
              className="mp-land"
            />
            {p.pins.map((pin, i) => (
              <circle key={i} cx={pin.x} cy={pin.y} r="4.2" className={`pin pin--${pin.s}`} />
            ))}
            {p.cities.map((c) => (
              <text key={c.name} x={c.x + 7} y={c.y - 6} className="mp-city">
                {c.name}
              </text>
            ))}
          </svg>
          <span className="mp-map-legend">
            {p.legend.map((l, i) => (
              <span key={l.label} className="mp-map-chip">
                <i className={`dot dot--${i}`} />
                <span>{l.label}</span>
                <b>{l.count}</b>
              </span>
            ))}
          </span>
        </span>
      );
    case 'landscape':
      return (
        <span className="ls">
          <span className="ls-top">
            <span>
              <b className="pv-big">{p.headline}</b>
              <span className="pv-k">{p.sub}</span>
            </span>
            <span className="ls-ring">
              <Donut parts={[p.smallPct, 100 - p.smallPct]} two />
              <span className="ls-ring-l">
                <b>{p.smallPct}%</b>
                <span className="pv-k">to small business</span>
              </span>
            </span>
          </span>
          <span className="cs-h">Market share</span>
          <span className="stack stack--tall">
            {p.shares.map((x, i) => (
              <i key={x.label} className={`fill--${i}`} style={{ width: `${x.pct}%` }} />
            ))}
          </span>
          <span className="rp-legend">
            {p.shares.map((x, i) => (
              <span key={x.label}>
                <i className={`sw sw--${i}`} />
                {x.label} <b>{x.pct}%</b>
              </span>
            ))}
          </span>
          <span className="cs-h">Awards per quarter</span>
          <Spark values={p.trend} />
        </span>
      );
    case 'list':
      return (
        <span className="pv-stack">
          {p.items.map((x) => (
            <span key={x.title} className="pv-box pv-li">
              <span className="pv-li-main">
                <b>{x.title}</b>
                <span className="pv-k">{x.meta}</span>
              </span>
              {x.tag && <span className="pv-chip">{x.tag}</span>}
            </span>
          ))}
        </span>
      );
  }
}

/** SVG donut (no CSS gradients). Segment colours come from the .seg--N classes. */
function Donut({ parts, two = false }: { parts: number[]; two?: boolean }) {
  const r = 15.915;
  let offset = 25;
  return (
    <svg viewBox="0 0 42 42" className="donut" aria-hidden="true">
      <circle cx="21" cy="21" r={r} className="donut-track" />
      {parts.map((pct, i) => {
        const el = (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={r}
            className={two ? (i === 0 ? 'seg seg--ok' : 'seg seg--rest') : `seg seg--${i}`}
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={offset}
          />
        );
        offset -= pct;
        return el;
      })}
    </svg>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 200},${46 - ((v - min) / (max - min || 1)) * 40}`);
  return (
    <svg viewBox="0 0 200 50" className="spark" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,50 ${pts.join(' ')} 200,50`} className="spark-area" />
      <polyline points={pts.join(' ')} className="spark-line" />
      <circle cx="200" cy={pts[pts.length - 1].split(',')[1]} r="3" className="spark-dot" />
    </svg>
  );
}

/* Public design system only: --mp-* tokens, no new colours, weights at or below 700. */
const CSS = `
.mg-ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.mg-cat{display:block;font:700 10px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mp-accent)}
.mg-feat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:16px}
@media(max-width:860px){.mg-feat{grid-template-columns:minmax(0,1fr)}}
.mg-fcard{all:unset;box-sizing:border-box;display:flex;flex-direction:column;background:var(--mp-surface);border:1px solid var(--mp-line);cursor:pointer;transition:border-color .15s}
.mg-fcard:hover{border-color:var(--mp-ink)}
.mg-fcard:focus-visible,.mg-row:focus-visible,.mg-tabs button:focus-visible,.mg-x:focus-visible{outline:2px solid var(--mp-navy);outline-offset:3px}
.mg-stage{display:block;background:var(--mp-wash);border-bottom:1px solid var(--mp-line);padding:28px 28px 0;aspect-ratio:16/10;overflow:hidden}
.mg-fcap{display:grid;gap:8px;padding:22px 24px 24px}
.mg-ftitle{font:700 1.35rem/1.25 var(--mp-font-serif);color:var(--mp-ink)}
.mg-fsub{font:400 15px/1.55 var(--mp-font-sans);color:var(--mp-body)}
.mg-go{font:600 14px var(--mp-font-sans);color:var(--mp-navy);margin-top:4px}
.mg-listhead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.mg-tabs{display:flex;gap:8px;flex-wrap:wrap}
.mg-tabs button{font:600 13px var(--mp-font-sans);color:var(--mp-muted);background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:var(--mp-radius-chip);padding:7px 12px;cursor:pointer}
.mg-tabs button[aria-pressed="true"]{color:var(--mp-surface);background:var(--mp-ink);border-color:var(--mp-ink)}
.mg-list{list-style:none;margin:18px 0 0;padding:0;border-top:1px solid var(--mp-line)}
.mg-list li{border-bottom:1px solid var(--mp-line)}
.mg-row{all:unset;box-sizing:border-box;width:100%;display:grid;grid-template-columns:minmax(0,1fr) 170px 24px;gap:16px;align-items:center;padding:18px 4px;cursor:pointer}
.mg-row:hover .mg-row-title{color:var(--mp-navy)}
@media(max-width:700px){.mg-row{grid-template-columns:minmax(0,1fr) 24px}.mg-row-cat{display:none}}
.mg-row-main{display:grid;gap:4px;min-width:0}
.mg-row-title{font:700 1.06rem/1.3 var(--mp-font-serif);color:var(--mp-ink)}
.mg-row-sub{font:400 14px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.mg-row-go{font:600 18px var(--mp-font-sans);color:var(--mp-muted);text-align:right}
.mg-end{text-align:center}
.mg-end .mg-ctas{justify-content:center}
/* finished-result previews */
.mg-doc{display:flex;flex-direction:column;height:100%;background:var(--mp-surface);color:var(--mp-ink);border:1px solid var(--mp-line);border-bottom:0;box-shadow:0 12px 32px color-mix(in srgb,var(--mp-ink) 12%,transparent);font-family:var(--mp-font-sans);text-align:left;overflow:hidden}
.mg-doc--lg{height:auto;min-height:100%;border-bottom:1px solid var(--mp-line)}
.mg-doc-bar{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 14px;background:var(--mp-navy);color:var(--mp-surface);font-size:12px}
.mg-doc-bar b{letter-spacing:.04em}
.mg-doc-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-doc-body{display:block;padding:14px;font-size:13px;line-height:1.4;flex:1;overflow:hidden}
.mg-doc--lg .mg-doc-body{padding:20px;font-size:14px}
.pv-k{display:block;font-size:.86em;color:var(--mp-muted)}
.pv-big{display:block;font:700 2.1em/1.1 var(--mp-font-mono);letter-spacing:-.03em;color:var(--mp-ink)}
.pv-stack{display:grid;gap:7px}
.pv-box{display:block;background:var(--mp-paper);border:1px solid var(--mp-hair);padding:9px;min-width:0}
.pv-line{display:block;color:var(--mp-body);border-top:1px solid var(--mp-hair);padding-top:5px;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-hz{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.pv-tbl{display:grid;border:1px solid var(--mp-hair);overflow:hidden}
.pv-th{font:600 10px var(--mp-font-sans);text-transform:uppercase;letter-spacing:.08em;color:var(--mp-muted);padding:8px;background:var(--mp-wash)}
.pv-td{padding:8px;border-top:1px solid var(--mp-hair);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-r{text-align:right;font-family:var(--mp-font-mono);font-variant-numeric:tabular-nums}
.pv-hi{font-weight:700;color:var(--mp-navy)}
.pv-bars{display:grid;gap:7px}
.pv-bar{display:grid;grid-template-columns:minmax(0,1.2fr) 1.5fr auto;gap:10px;align-items:center}
.pv-bar-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-bar-t{height:12px;background:var(--mp-wash)}
.pv-bar-t i{display:block;height:100%;background:var(--mp-navy)}
.pv-bar-v{font:600 1em var(--mp-font-mono);font-variant-numeric:tabular-nums}
.pv-chip{justify-self:start;display:inline-block;font:600 11px var(--mp-font-sans);color:var(--mp-ok);background:var(--mp-ok-bg);border:1px solid var(--mp-ok-line);border-radius:var(--mp-radius-chip);padding:2px 8px;white-space:nowrap}
.pv-kv{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--mp-hair);padding-bottom:5px}
.pv-kv span{color:var(--mp-muted)}
.pv-note{color:var(--mp-muted);font-style:italic}
.pv-person{display:flex;gap:10px;align-items:center}
.pv-person b{display:block}
.pv-av{width:28px;height:28px;border-radius:50%;background:var(--mp-wash);border:1px solid var(--mp-line);flex:none}
.pv-ver-top{display:flex;justify-content:space-between;align-items:center}
.pv-ver-v{font:700 2.3em/1 var(--mp-font-serif);color:var(--mp-ok)}
.pv-score{text-align:right}
.pv-score b{display:block;font:700 1.8em/1 var(--mp-font-mono)}
.pv-reason{display:flex;gap:8px;align-items:center}
.pv-reason i{font-style:normal;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:.8em;font-weight:700;flex:none}
.pv-reason i.ok{background:var(--mp-ok-bg);color:var(--mp-ok)}
.pv-reason i.no{background:var(--mp-warn-bg);color:var(--mp-warn)}
.pv-mx{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center}
.pv-ref{font-family:var(--mp-font-mono);color:var(--mp-muted)}
.pv-req{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-st{font-weight:700;font-size:.86em;white-space:nowrap}
.pv-st.ok{color:var(--mp-ok)}.pv-st.gap{color:var(--mp-warn)}
.pv-docx{display:grid;gap:8px;font-family:var(--mp-font-serif)}
.pv-para{display:block;color:var(--mp-body)}
.pv-li{display:flex;justify-content:space-between;gap:8px;align-items:center}
.pv-li-main{min-width:0}
.pv-li b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* detail sheet */
.mg-modal{position:fixed;inset:0;z-index:100;background:color-mix(in srgb,var(--mp-ink) 55%,transparent);display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.mg-sheet{position:relative;width:min(1040px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--mp-surface);border:1px solid var(--mp-line);display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}
@media(max-width:820px){.mg-sheet{grid-template-columns:minmax(0,1fr)}}
.mg-sheet-media{padding:28px;background:var(--mp-wash);border-right:1px solid var(--mp-line)}
.mg-sheet-body{padding:30px 28px;display:flex;flex-direction:column;gap:12px}
.mg-result{margin:0;font:400 15px/1.6 var(--mp-font-sans);color:var(--mp-body)}
.mg-prompt{margin:0;background:var(--mp-paper);border:1px solid var(--mp-line);padding:14px;font:400 15px/1.6 var(--mp-font-sans);color:var(--mp-ink);user-select:text}
.mg-locked{display:grid;gap:12px;background:var(--mp-paper);border:1px dashed var(--mp-line);padding:14px}
.mg-locked p{margin:0;color:var(--mp-muted);font:400 14px/1.5 var(--mp-font-sans)}
.mg-blur{display:grid;gap:8px}
.mg-blur i{display:block;height:10px;background:var(--mp-wash)}
.mg-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:50%;border:1px solid var(--mp-line);background:var(--mp-surface);color:var(--mp-ink);font-size:20px;line-height:1;cursor:pointer;z-index:1}
/* chart palette: hex values from src/lib/public-site/tokens.ts only */
.mg{--c0:#1B3A6B;--c1:#027A48;--c2:#B54708;--c3:#8C2F1E;--c4:#9A9384;--c5:#B91C1C;--tint0:#EFF5FF;--tint1:#ECFDF3;--tint2:#FFFAEB}
.fill--0,.sw--0{background:var(--c0)}.fill--1,.sw--1{background:var(--c1)}.fill--2,.sw--2{background:var(--c2)}.fill--3,.sw--3{background:var(--c3)}.fill--4,.sw--4{background:var(--c4)}
.sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;flex:none}
.cs-h{display:block;font:700 9.5px var(--mp-font-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--mp-muted);margin-top:6px}
/* capability statement */
.cs{display:grid;gap:8px}
.cs-head{display:flex;gap:10px;align-items:center;background:var(--c0);color:var(--mp-surface);padding:10px 12px;margin:-14px -14px 0}
.mg-doc--lg .cs-head{margin:-20px -20px 0;padding:14px 20px}
.cs-logo{width:32px;height:32px;display:grid;place-items:center;background:var(--mp-surface);color:var(--c0);font:700 18px var(--mp-font-serif);flex:none}
.cs-id b{display:block;font:700 1.15em var(--mp-font-serif)}
.cs-id span{display:block;font-size:.85em;opacity:.85}
.cs-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:12px}
.cs-col{display:grid;gap:4px;align-content:start;min-width:0}
.cs-li{display:block;padding-left:12px;position:relative}
.cs-li::before{content:"";position:absolute;left:0;top:.45em;width:6px;height:6px;background:var(--c0)}
.cs-li--ok::before{background:var(--c1)}
.cs-pp{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px;align-items:center}
.cs-pp-w{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cs-pp b{font-family:var(--mp-font-mono)}
.cs-ag{font:700 10px var(--mp-font-sans);color:var(--mp-surface);padding:2px 6px}
.cs-ag--0{background:var(--c0)}.cs-ag--1{background:var(--c1)}.cs-ag--2{background:var(--c2)}
.cs-chips{display:flex;flex-wrap:wrap;gap:4px}
.cs-naics{font:500 10.5px var(--mp-font-mono);background:var(--tint0);color:var(--c0);border:1px solid var(--c0);padding:1px 6px}
.cs-cert{font:600 10.5px var(--mp-font-sans);background:var(--tint1);color:var(--c1);border:1px solid var(--mp-ok-line);padding:1px 6px}
.cs-foot{display:flex;flex-wrap:wrap;gap:4px 14px;border-top:1px solid var(--mp-hair);padding-top:6px;color:var(--mp-muted);font-size:.85em}
.cs-foot b{color:var(--mp-ink);font-family:var(--mp-font-mono)}
/* market report */
.rp{display:grid;gap:6px}
.rp-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;align-items:start}
.rp-donut{display:flex;gap:10px;align-items:center;min-width:0}
.donut{width:78px;height:78px;flex:none;transform:rotate(0deg)}
.mg-doc--lg .donut{width:110px;height:110px}
.donut-track{fill:none;stroke:var(--mp-wash);stroke-width:6}
.seg{fill:none;stroke-width:6}
.seg--0{stroke:var(--c0)}.seg--1{stroke:var(--c1)}.seg--2{stroke:var(--c2)}.seg--3{stroke:var(--c3)}.seg--4{stroke:var(--c4)}
.seg--ok{stroke:var(--c1)}.seg--rest{stroke:var(--mp-wash)}
.rp-legend{display:grid;gap:3px;font-size:.88em;min-width:0}
.rp-legend span{display:flex;align-items:center;gap:0;white-space:nowrap}
.rp-legend b{margin-left:4px;font-family:var(--mp-font-mono)}
.rp-legend--row{display:flex;flex-wrap:wrap;gap:4px 12px}
.rp-win{display:grid;gap:5px;min-width:0}
.rp-bar{display:grid;grid-template-columns:minmax(0,1fr) 60px auto;gap:6px;align-items:center}
.rp-bar-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-bar b{font-family:var(--mp-font-mono)}
.pv-bar-t i[class*=fill]{display:block;height:100%}
.stack{display:flex;height:16px;overflow:hidden;background:var(--mp-wash)}
.stack i{display:block;height:100%}
.stack i+i{border-left:2px solid var(--mp-surface)}
.stack--tall{height:26px}
/* map */
.mp-map{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;height:100%}
.mp-map-svg{width:100%;height:auto;max-height:330px;display:block}
.mg-doc--lg .mp-map-svg{max-height:380px}
.mp-water{fill:var(--tint0)}
.mp-land{fill:var(--mp-wash);stroke:var(--mp-line);stroke-width:1.2}
.pin{stroke:var(--mp-surface);stroke-width:1.6}
.pin--0{fill:var(--c1)}.pin--1{fill:var(--c2)}.pin--2{fill:var(--c0)}
.mp-city{font:600 7.5px var(--mp-font-sans);fill:var(--mp-body)}
.mp-map-legend{display:grid;gap:8px}
.mp-map-chip{display:grid;grid-template-columns:auto 1fr;gap:0 8px;align-items:center;background:var(--mp-surface);border:1px solid var(--mp-hair);padding:7px 10px}
.mp-map-chip b{grid-column:2;font:700 1.5em/1 var(--mp-font-mono)}
.mp-map-chip span{font-size:.85em;color:var(--mp-muted)}
.dot{width:10px;height:10px;border-radius:50%;grid-row:span 2}
.dot--0{background:var(--c1)}.dot--1{background:var(--c2)}.dot--2{background:var(--c0)}
/* landscape */
.ls{display:grid;gap:6px}
.ls-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ls-ring{display:flex;gap:8px;align-items:center}
.ls-ring .donut{width:58px;height:58px}
.ls-ring-l b{display:block;font:700 1.4em/1 var(--mp-font-mono);color:var(--c1)}
.ls .rp-legend{grid-template-columns:repeat(2,minmax(0,1fr))}
.spark{width:100%;height:70px;display:block}
.spark-area{fill:var(--tint0)}
.spark-line{fill:none;stroke:var(--c0);stroke-width:2;vector-effect:non-scaling-stroke}
.spark-dot{fill:var(--c3)}
.mg-feat .mg-stage{aspect-ratio:auto;height:440px}
@media(max-width:860px){.mg-feat .mg-stage{height:auto;padding-bottom:0}}
@media (prefers-reduced-motion:reduce){.mg-fcard{transition:none}}
`;
