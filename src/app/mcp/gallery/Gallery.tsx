'use client';

/**
 * "Mindy in your AI" — a wall of finished results that play like short videos (the Higgsfield
 * content-factory pattern), inside the public site's header and footer.
 *
 * - Every card is a looping animation of the result being built: rows slide in, bars grow, pins
 *   drop, charts draw, the proposal types itself. Cards off screen pause; reduced-motion users
 *   get the finished frame.
 * - A sticky prompt bar at the bottom types the OPENING words of example prompts, as if you were
 *   already in Claude. Full prompts are signed-in only: fetched from /api/mcp/gallery/prompts,
 *   which answers only for a server-verified session.
 * - No credit amounts anywhere on this page.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import {
  GALLERY_CATEGORIES,
  GALLERY_STARTERS,
  type GalleryCategory,
  type GalleryItem,
  type GalleryPreview,
} from '@/lib/mcp/gallery';

type PromptState = { status: 'loading' } | { status: 'signed-out' } | { status: 'ready'; prompts: Record<string, string> };

const SIGN_IN = '/app?next=%2Fmcp%2Fgallery';
const catLabel = (c: GalleryCategory) => GALLERY_CATEGORIES.find((x) => x.id === c)?.label ?? '';
/** Stagger index for an animated element. */
const si = (i: number) => ({ ['--i' as string]: i }) as CSSProperties;

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
  const wall = useMemo(() => items.filter((i) => !i.featured && (tab === 'all' || i.category === tab)), [items, tab]);

  return (
    <div className="mg">
      <style>{CSS}</style>
      <section className="mg-band">
        <div className="mg-in">
          <header className="mg-top">
            <p className="mg-kicker">Mindy in your AI</p>
            <h1 className="mg-h1">One question in Claude or ChatGPT. Finished work back.</h1>
            <p className="mg-lede">Every result below came from one plain-English prompt, built from the official federal record.</p>
          </header>

          <p className="mg-sec">Featured</p>
          <div className="mg-feat">
            {featured.map((item, n) => (
              <Card key={item.id} item={item} big seed={n} onOpen={() => setOpen(item)} />
            ))}
          </div>

          <div className="mg-wallhead">
            <p className="mg-sec">Explore</p>
            <nav className="mg-tabs" aria-label="Filter results">
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
          <div className="mg-wall">
            {wall.map((item, n) => (
              <Card key={item.id} item={item} seed={n + 4} onOpen={() => setOpen(item)} />
            ))}
          </div>
          <p className="mg-fine">Sample results: company names and figures are illustrative. A real answer comes from live federal data.</p>

          <Composer />
        </div>
      </section>

      {open && <Detail item={open} prompts={prompts} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A result card that plays like a video while it is on screen. */
function Card({ item, big = false, seed, onOpen }: { item: GalleryItem; big?: boolean; seed: number; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setPlay(true);
    const io = new IntersectionObserver(([e]) => setPlay(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      className={`vid${big ? ' vid--big' : ''}`}
      data-play={play ? '' : undefined}
      style={{ ['--off' as string]: `${-(seed % 5) * 1.3}s` } as CSSProperties}
      onClick={onOpen}
      aria-label={`Open: ${item.title}`}
    >
      <span className="vid-screen">
        <span className="vid-cam">
          <Preview item={item} />
        </span>
      </span>
      <span className="vid-over">
        <span className="vid-cat">{catLabel(item.category)}</span>
        <span className="vid-title">{item.title}</span>
        <span className="vid-row">
          <span className="vid-re">Recreate ›</span>
          <span className="vid-bar" aria-hidden="true">
            <i />
          </span>
        </span>
      </span>
    </button>
  );
}

/** The sticky "already inside your AI" prompt bar. Types prompt openings, never full prompts. */
function Composer() {
  const [text, setText] = useState('');
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setText(GALLERY_STARTERS[0] + '…');
      return;
    }
    let idx = 0;
    let pos = 0;
    let phase: 'type' | 'hold' | 'erase' = 'type';
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = GALLERY_STARTERS[idx] + '…';
      if (phase === 'type') {
        pos++;
        setText(full.slice(0, pos));
        if (pos >= full.length) phase = 'hold';
        timer = setTimeout(tick, phase === 'hold' ? 1700 : 38);
      } else if (phase === 'hold') {
        phase = 'erase';
        timer = setTimeout(tick, 20);
      } else {
        pos = Math.max(0, pos - 3);
        setText(full.slice(0, pos));
        if (pos === 0) {
          phase = 'type';
          idx = (idx + 1) % GALLERY_STARTERS.length;
        }
        timer = setTimeout(tick, pos === 0 ? 300 : 16);
      }
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="cmp" role="region" aria-label="Try Mindy in your AI">
      <a className="cmp-top" href="/mcp">
        Connect Mindy MCP to generate <span aria-hidden="true">›</span>
      </a>
      <div className="cmp-body">
        <span className="cmp-ref" aria-hidden="true">
          <i />
          <span>Add your UEI</span>
        </span>
        <span className="cmp-input">
          <span className="cmp-text" aria-live="off">
            {text}
            <span className="cmp-caret" aria-hidden="true" />
          </span>
          <span className="cmp-chips">
            <span>+</span>
            <span>Live federal data</span>
            <span>Claude · ChatGPT</span>
          </span>
        </span>
        <a className="cmp-go" href="/mcp">
          Generate in Claude
        </a>
      </div>
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
        <div className="mg-sheet-media vid" data-play="">
          <span className="vid-cam">
            <Preview item={item} large />
          </span>
        </div>
        <div className="mg-sheet-body">
          <span className="mg-cat">{catLabel(item.category)}</span>
          <h3 className="mg-sheet-h">{item.title}</h3>
          <p className="mg-result">{item.result}</p>
          <p className="mg-label">The prompt</p>
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
          <p className="mg-fine2">Works in Claude, ChatGPT, Cursor or any MCP agent once Mindy is connected.</p>
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
          {p.columns.map((c, ci) => (
            <span key={c.label} className="pv-box a" style={si(ci)}>
              <span className="pv-k">{c.label}</span>
              <b className="pv-big">{c.count}</b>
              {c.items.map((t, ti) => (
                <span key={t} className="pv-line a" style={si(ci + ti + 1)}>
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
              <span
                key={`${ri}-${ci}`}
                className={`pv-td a${p.highlight === ci ? ' pv-hi' : ''}${ci > 0 ? ' pv-r' : ''}`}
                style={si(ri + 1)}
              >
                {cell}
              </span>
            )),
          )}
        </span>
      );
    case 'bars':
      return (
        <span className="pv-bars">
          <b className="pv-big a" style={si(0)}>
            {p.headline}
          </b>
          <span className="pv-k a" style={si(0)}>
            {p.sub}
          </span>
          {p.bars.map((b, i) => (
            <span key={b.label} className="pv-bar a" style={si(i + 1)}>
              <span className="pv-bar-l">{b.label}</span>
              <span className="pv-bar-t">
                <i className="g" style={{ width: `${b.pct}%`, ...si(i + 1) }} />
              </span>
              <span className="pv-bar-v">{b.value}</span>
            </span>
          ))}
        </span>
      );
    case 'dossier':
      return (
        <span className="pv-stack">
          <span className="pv-chip a" style={si(0)}>
            {p.badge}
          </span>
          {p.fields.map(([k, v], i) => (
            <span key={k} className="pv-kv a" style={si(i + 1)}>
              <span>{k}</span>
              <b>{v}</b>
            </span>
          ))}
          <span className="pv-note a" style={si(p.fields.length + 1)}>
            {p.note}
          </span>
        </span>
      );
    case 'people':
      return (
        <span className="pv-stack">
          <span className="pv-k a" style={si(0)}>
            {p.office}
          </span>
          {p.people.map((x, i) => (
            <span key={x.name} className="pv-box pv-person a" style={si(i + 1)}>
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
            <b className="pv-ver-v pop" style={si(3)}>
              {p.verdict}
            </b>
            <span className="pv-score a" style={si(1)}>
              <b>{p.score}</b>
              <span className="pv-k">fit score</span>
            </span>
          </span>
          {p.reasons.map((r, i) => (
            <span key={r.text} className="pv-reason a" style={si(i)}>
              <i className={r.ok ? 'ok' : 'no'}>{r.ok ? '✓' : '!'}</i>
              {r.text}
            </span>
          ))}
        </span>
      );
    case 'matrix':
      return (
        <span className="pv-stack">
          {p.rows.map((r, i) => (
            <span key={r.ref} className="pv-box pv-mx a" style={si(i)}>
              <span className="pv-ref">{r.ref}</span>
              <span className="pv-req">{r.req}</span>
              <span className={`pv-st pop ${r.status}`} style={si(i + 2)}>
                {r.status === 'ok' ? r.section : 'Missing'}
              </span>
            </span>
          ))}
        </span>
      );
    case 'doc':
      return (
        <span className="pv-box pv-docx">
          <b className="t" style={si(0)}>
            {p.heading}
          </b>
          {p.paragraphs.map((t, i) => (
            <span key={t} className="pv-para t" style={si(i * 3 + 2)}>
              {t}
            </span>
          ))}
        </span>
      );
    case 'capability':
      return (
        <span className="cs">
          <span className="cs-head a" style={si(0)}>
            <span className="cs-logo" aria-hidden="true">
              {p.company.slice(0, 1)}
            </span>
            <span className="cs-id">
              <b>{p.company}</b>
              <span>{p.tagline}</span>
            </span>
          </span>
          <span className="cs-grid">
            <span className="cs-col">
              <span className="cs-h">Core competencies</span>
              {p.competencies.map((c, i) => (
                <span key={c} className="cs-li a" style={si(i + 1)}>
                  {c}
                </span>
              ))}
              <span className="cs-h">Differentiators</span>
              {p.differentiators.map((c, i) => (
                <span key={c} className="cs-li cs-li--ok a" style={si(i + 5)}>
                  {c}
                </span>
              ))}
            </span>
            <span className="cs-col">
              <span className="cs-h">Past performance</span>
              {p.pastPerformance.map((x, i) => (
                <span key={x.work} className="cs-pp a" style={si(i + 2)}>
                  <span className={`cs-ag cs-ag--${i}`}>{x.agency}</span>
                  <span className="cs-pp-w">{x.work}</span>
                  <b>{x.value}</b>
                </span>
              ))}
              <span className="cs-h">NAICS</span>
              <span className="cs-chips">
                {p.naics.map((n, i) => (
                  <span key={n} className="cs-naics pop" style={si(i + 5)}>
                    {n}
                  </span>
                ))}
              </span>
              <span className="cs-h">Certifications</span>
              <span className="cs-chips">
                {p.certs.map((n, i) => (
                  <span key={n} className="cs-cert pop" style={si(i + 7)}>
                    {n}
                  </span>
                ))}
              </span>
            </span>
          </span>
          <span className="cs-foot a" style={si(9)}>
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
          <span className="a" style={si(0)}>
            <b className="pv-big">{p.headline}</b>
            <span className="pv-k">{p.sub}</span>
          </span>
          <span className="rp-grid">
            <span className="rp-donut">
              <Donut parts={p.agencies.map((a) => a.pct)} />
              <span className="rp-legend">
                {p.agencies.map((a, i) => (
                  <span key={a.label} className="a" style={si(i + 1)}>
                    <i className={`sw sw--${i}`} />
                    {a.label} <b>{a.value}</b>
                  </span>
                ))}
              </span>
            </span>
            <span className="rp-win">
              <span className="cs-h">Top winners</span>
              {p.winners.map((w, i) => (
                <span key={w.label} className="rp-bar a" style={si(i + 2)}>
                  <span className="rp-bar-l">{w.label}</span>
                  <span className="pv-bar-t">
                    <i className={`g fill--${i}`} style={{ width: `${w.pct}%`, ...si(i + 2) }} />
                  </span>
                  <b>{w.value}</b>
                </span>
              ))}
            </span>
          </span>
          <span className="cs-h">Set-aside mix</span>
          <span className="stack">
            {p.setAside.map((x, i) => (
              <i key={x.label} className={`g fill--${i}`} style={{ width: `${x.pct}%`, ...si(i + 5) }} />
            ))}
          </span>
          <span className="rp-legend rp-legend--row">
            {p.setAside.map((x, i) => (
              <span key={x.label} className="a" style={si(i + 6)}>
                <i className={`sw sw--${i}`} />
                {x.label} {x.pct}%
              </span>
            ))}
          </span>
        </span>
      );
    case 'map':
      return (
        <span className="mapv">
          <svg viewBox="0 0 200 260" className="mapv-svg" role="img" aria-label={`Map of ${p.region} with opportunity pins`}>
            <rect x="0" y="0" width="200" height="260" className="mapv-water" />
            <path
              d="M0,30 L118,30 L124,20 L150,22 L156,40 L150,60 L158,90 L172,140 L182,190 L180,230 L168,252 L150,250 L138,236 L124,214 L108,196 L92,180 L80,168 L66,150 L60,120 L72,96 L86,78 L70,62 L46,58 L20,56 L0,52 Z"
              className="mapv-land"
            />
            {p.pins.map((pin, i) => (
              <g key={i} className="pinw" style={si(i % 9)}>
                <circle cx={pin.x} cy={pin.y} r="9" className={`ping ping--${pin.s}`} />
                <circle cx={pin.x} cy={pin.y} r="4.2" className={`pin pin--${pin.s}`} />
              </g>
            ))}
            {p.cities.map((c) => (
              <text key={c.name} x={c.x + 7} y={c.y - 6} className="mapv-city">
                {c.name}
              </text>
            ))}
          </svg>
          <span className="mapv-legend">
            {p.legend.map((l, i) => (
              <span key={l.label} className="mapv-chip a" style={si(i * 2 + 1)}>
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
            <span className="a" style={si(0)}>
              <b className="pv-big">{p.headline}</b>
              <span className="pv-k">{p.sub}</span>
            </span>
            <span className="ls-ring">
              <Donut parts={[p.smallPct, 100 - p.smallPct]} two />
              <span className="ls-ring-l a" style={si(2)}>
                <b>{p.smallPct}%</b>
                <span className="pv-k">to small business</span>
              </span>
            </span>
          </span>
          <span className="cs-h">Market share</span>
          <span className="stack stack--tall">
            {p.shares.map((x, i) => (
              <i key={x.label} className={`g fill--${i}`} style={{ width: `${x.pct}%`, ...si(i + 1) }} />
            ))}
          </span>
          <span className="rp-legend ls-legend">
            {p.shares.map((x, i) => (
              <span key={x.label} className="a" style={si(i + 2)}>
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
          {p.items.map((x, i) => (
            <span key={x.title} className="pv-box pv-li a" style={si(i)}>
              <span className="pv-li-main">
                <b>{x.title}</b>
                <span className="pv-k">{x.meta}</span>
              </span>
              {x.tag && (
                <span className="pv-chip pop" style={si(i + 1)}>
                  {x.tag}
                </span>
              )}
            </span>
          ))}
        </span>
      );
  }
}

/** SVG donut (no CSS gradients). Segments draw in on each loop. */
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
            className={`seg ${two ? (i === 0 ? 'seg--ok' : 'seg--rest') : `seg--${i}`}`}
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset={offset}
            style={{ ['--da' as string]: `${pct} ${100 - pct}`, ...si(i) } as CSSProperties}
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
      <polyline points={pts.join(' ')} className="spark-line" pathLength={1} />
      <circle cx="200" cy={pts[pts.length - 1].split(',')[1]} r="3" className="spark-dot" />
    </svg>
  );
}

/* Public design system tokens only (--mp-* and hex from tokens.ts). The wall is a dark band
   painted with --mp-ink; no gradients; font weights at or below 700. */
const CSS = `
.mg{--c0:#1B3A6B;--c1:#027A48;--c2:#B54708;--c3:#8C2F1E;--c4:#9A9384;--tint0:#EFF5FF;--tint1:#ECFDF3;
  --on:var(--mp-surface);--on-mute:color-mix(in srgb,var(--mp-surface) 62%,transparent);--tile:color-mix(in srgb,var(--mp-surface) 7%,var(--mp-ink));--tile-line:color-mix(in srgb,var(--mp-surface) 14%,var(--mp-ink));--loop:7.5s}
.mg-band{background:var(--mp-ink);color:var(--on);padding-block:48px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.mg-in{max-width:1320px;margin:0 auto}
.mg-top{text-align:center;max-width:760px;margin:0 auto 36px}
.mg-kicker{display:inline-block;margin:0;font:700 11px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--on);border:1px solid var(--tile-line);padding:7px 12px}
.mg-h1{font:700 clamp(1.9rem,4.4vw,3.2rem)/1.08 var(--mp-font-serif);margin:16px 0 0;text-wrap:balance;color:var(--on)}
.mg-lede{margin:14px auto 0;color:var(--on-mute);font:400 1.05rem/1.55 var(--mp-font-sans);max-width:56ch}
.mg-sec{margin:0 0 12px;font:700 11px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--on-mute)}
.mg-feat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.mg-wallhead{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:40px 0 12px}
.mg-wallhead .mg-sec{margin:0}
.mg-tabs{display:flex;gap:6px;flex-wrap:wrap}
.mg-tabs button{font:600 13px var(--mp-font-sans);color:var(--on-mute);background:var(--tile);border:1px solid var(--tile-line);padding:7px 12px;cursor:pointer}
.mg-tabs button[aria-pressed="true"]{color:var(--mp-ink);background:var(--on);border-color:var(--on)}
.mg-wall{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
@media(max-width:1000px){.mg-wall{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.mg-feat,.mg-wall{grid-template-columns:minmax(0,1fr)}}
.mg-fine{margin:18px 0 0;color:var(--on-mute);font:400 12.5px var(--mp-font-sans)}
/* video card */
.vid{all:unset;box-sizing:border-box;position:relative;display:block;cursor:pointer;background:var(--tile);border:1px solid var(--tile-line);overflow:hidden;aspect-ratio:4/4.3}
.vid--big{aspect-ratio:16/12.5}
.vid:focus-visible{outline:2px solid var(--on);outline-offset:3px}
.vid-screen{position:absolute;inset:0;padding:22px 22px 128px;overflow:hidden;display:flex;align-items:center}
.vid--big .vid-screen{padding-bottom:132px}
.vid-cam{display:block;width:100%;transform-origin:50% 40%;animation:camDrift calc(var(--loop) * 2) ease-in-out infinite alternate;animation-delay:var(--off,0s)}
.vid-over{position:absolute;left:0;right:0;bottom:0;display:grid;gap:6px;padding:16px 18px 16px;background:color-mix(in srgb,var(--mp-ink) 88%,transparent);border-top:1px solid var(--tile-line)}
.vid-cat{font:700 10px var(--mp-font-sans);letter-spacing:.16em;text-transform:uppercase;color:var(--on-mute)}
.vid-title{font:700 1.08rem/1.25 var(--mp-font-serif);color:var(--on)}
.vid--big .vid-title{font-size:1.3rem}
.vid-row{display:flex;align-items:center;gap:12px}
.vid-re{font:600 13px var(--mp-font-sans);color:var(--mp-ink);background:var(--on);padding:6px 11px;flex:none;transition:transform .15s}
.vid:hover .vid-re{transform:translateX(2px)}
.vid-bar{flex:1;height:3px;background:var(--tile-line);overflow:hidden}
.vid-bar i{display:block;height:100%;background:var(--on);transform-origin:left;animation:prog var(--loop) linear infinite;animation-delay:var(--off,0s)}
.vid:not([data-play]) *{animation-play-state:paused!important}
/* result document */
.mg-doc{display:flex;flex-direction:column;box-shadow:0 20px 50px color-mix(in srgb,var(--mp-ink) 60%,transparent);background:var(--mp-surface);color:var(--mp-ink);font-family:var(--mp-font-sans);text-align:left}
.mg-doc-bar{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 14px;background:var(--mp-navy);color:var(--mp-surface);font-size:12px}
.mg-doc-bar b{letter-spacing:.04em}
.mg-doc-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-doc-body{display:block;padding:14px;font-size:13.5px;line-height:1.4;flex:1}
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
.pv-hi{font-weight:700;color:var(--c0)}
.pv-bars{display:grid;gap:7px}
.pv-bar{display:grid;grid-template-columns:minmax(0,1.2fr) 1.5fr auto;gap:10px;align-items:center}
.pv-bar-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-bar-t{height:12px;background:var(--mp-wash)}
.pv-bar-t i{display:block;height:100%;background:var(--c0)}
.pv-bar-v{font:600 1em var(--mp-font-mono)}
.pv-chip{justify-self:start;display:inline-block;font:600 11px var(--mp-font-sans);color:var(--mp-ok);background:var(--mp-ok-bg);border:1px solid var(--mp-ok-line);padding:2px 8px;white-space:nowrap}
.pv-kv{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--mp-hair);padding-bottom:5px}
.pv-kv span{color:var(--mp-muted)}
.pv-note{color:var(--mp-muted);font-style:italic}
.pv-person{display:flex;gap:10px;align-items:center}
.pv-person b{display:block}
.pv-av{width:28px;height:28px;border-radius:50%;background:var(--mp-wash);border:1px solid var(--mp-line);flex:none}
.pv-ver-top{display:flex;justify-content:space-between;align-items:center}
.pv-ver-v{display:inline-block;font:700 2.4em/1 var(--mp-font-serif);color:var(--c1)}
.pv-score{text-align:right}
.pv-score b{display:block;font:700 1.8em/1 var(--mp-font-mono)}
.pv-reason{display:flex;gap:8px;align-items:center}
.pv-reason i{font-style:normal;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:.8em;font-weight:700;flex:none}
.pv-reason i.ok{background:var(--mp-ok-bg);color:var(--mp-ok)}
.pv-reason i.no{background:var(--mp-warn-bg);color:var(--mp-warn)}
.pv-mx{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center}
.pv-ref{font-family:var(--mp-font-mono);color:var(--mp-muted)}
.pv-req{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-st{display:inline-block;font-weight:700;font-size:.86em;white-space:nowrap}
.pv-st.ok{color:var(--mp-ok)}.pv-st.gap{color:var(--mp-warn)}
.pv-docx{display:grid;gap:8px;font-family:var(--mp-font-serif)}
.pv-para{display:block;color:var(--mp-body)}
.pv-li{display:flex;justify-content:space-between;gap:8px;align-items:center}
.pv-li-main{min-width:0}
.pv-li b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fill--0,.sw--0{background:var(--c0)}.fill--1,.sw--1{background:var(--c1)}.fill--2,.sw--2{background:var(--c2)}.fill--3,.sw--3{background:var(--c3)}.fill--4,.sw--4{background:var(--c4)}
.sw{display:inline-block;width:9px;height:9px;margin-right:6px;flex:none}
.cs-h{display:block;font:700 9.5px var(--mp-font-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--mp-muted);margin-top:6px}
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
.cs-naics{display:inline-block;font:500 10.5px var(--mp-font-mono);background:var(--tint0);color:var(--c0);border:1px solid var(--c0);padding:1px 6px}
.cs-cert{display:inline-block;font:600 10.5px var(--mp-font-sans);background:var(--tint1);color:var(--c1);border:1px solid var(--mp-ok-line);padding:1px 6px}
.cs-foot{display:flex;flex-wrap:wrap;gap:4px 14px;border-top:1px solid var(--mp-hair);padding-top:6px;color:var(--mp-muted);font-size:.85em}
.cs-foot b{color:var(--mp-ink);font-family:var(--mp-font-mono)}
.rp{display:grid;gap:6px}
.rp-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;align-items:start}
.rp-donut{display:flex;gap:10px;align-items:center;min-width:0}
.donut{width:78px;height:78px;flex:none}
.mg-doc--lg .donut{width:110px;height:110px}
.donut-track{fill:none;stroke:var(--mp-wash);stroke-width:6}
.seg{fill:none;stroke-width:6}
.seg--0{stroke:var(--c0)}.seg--1{stroke:var(--c1)}.seg--2{stroke:var(--c2)}.seg--3{stroke:var(--c3)}.seg--4{stroke:var(--c4)}
.seg--ok{stroke:var(--c1)}.seg--rest{stroke:var(--mp-wash)}
.rp-legend{display:grid;gap:3px;font-size:.88em;min-width:0}
.rp-legend span{display:flex;align-items:center;white-space:nowrap}
.rp-legend b{margin-left:4px;font-family:var(--mp-font-mono)}
.rp-legend--row{display:flex;flex-wrap:wrap;gap:4px 12px}
.ls-legend{grid-template-columns:repeat(2,minmax(0,1fr))}
.rp-win{display:grid;gap:5px;min-width:0}
.rp-bar{display:grid;grid-template-columns:minmax(0,1fr) 60px auto;gap:6px;align-items:center}
.rp-bar-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-bar b{font-family:var(--mp-font-mono)}
.stack{display:flex;height:16px;overflow:hidden;background:var(--mp-wash)}
.stack i{display:block;height:100%}
.stack i+i{border-left:2px solid var(--mp-surface)}
.stack--tall{height:24px}
.mapv{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
.mapv-svg{width:100%;height:auto;max-height:340px;display:block}
.mapv-water{fill:var(--tint0)}
.mapv-land{fill:var(--mp-wash);stroke:var(--mp-line);stroke-width:1.2}
.pin{stroke:var(--mp-surface);stroke-width:1.6}
.pin--0,.ping--0{fill:var(--c1)}.pin--1,.ping--1{fill:var(--c2)}.pin--2,.ping--2{fill:var(--c0)}
.ping{opacity:0}
.mapv-city{font:600 7.5px var(--mp-font-sans);fill:var(--mp-body)}
.mapv-legend{display:grid;gap:8px}
.mapv-chip{display:grid;grid-template-columns:auto 1fr;gap:0 8px;align-items:center;background:var(--mp-surface);border:1px solid var(--mp-hair);padding:7px 10px}
.mapv-chip b{grid-column:2;font:700 1.5em/1 var(--mp-font-mono)}
.mapv-chip span{font-size:.85em;color:var(--mp-muted)}
.dot{width:10px;height:10px;border-radius:50%;grid-row:span 2}
.dot--0{background:var(--c1)}.dot--1{background:var(--c2)}.dot--2{background:var(--c0)}
.ls{display:grid;gap:6px}
.ls-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ls-ring{display:flex;gap:8px;align-items:center}
.ls-ring .donut{width:58px;height:58px}
.ls-ring-l b{display:block;font:700 1.4em/1 var(--mp-font-mono);color:var(--c1)}
.spark{width:100%;height:64px;display:block}
.spark-area{fill:var(--tint0)}
.spark-line{fill:none;stroke:var(--c0);stroke-width:2;vector-effect:non-scaling-stroke;stroke-dasharray:1;stroke-dashoffset:0}
.spark-dot{fill:var(--c3)}
/* the loop: build in, hold, fade out, repeat */
.vid .a{animation:inUp var(--loop) cubic-bezier(.2,.7,.2,1) infinite;animation-delay:calc(var(--i,0) * .18s + var(--off,0s))}
.vid .g{transform-origin:left;animation:grow var(--loop) cubic-bezier(.2,.7,.2,1) infinite;animation-delay:calc(var(--i,0) * .18s + .3s + var(--off,0s))}
.vid .pop{animation:pop var(--loop) cubic-bezier(.3,1.5,.5,1) infinite;animation-delay:calc(var(--i,0) * .18s + var(--off,0s))}
.vid .t{animation:type var(--loop) steps(36,end) infinite;animation-delay:calc(var(--i,0) * .25s + var(--off,0s))}
.vid .seg{animation:draw var(--loop) ease-out infinite;animation-delay:calc(var(--i,0) * .2s + var(--off,0s))}
.vid .spark-line{animation:line var(--loop) ease-out infinite;animation-delay:var(--off,0s)}
.vid .pinw{transform-box:fill-box;transform-origin:50% 100%;animation:drop var(--loop) cubic-bezier(.3,1.4,.5,1) infinite;animation-delay:calc(var(--i,0) * .15s + var(--off,0s))}
.vid .ping{transform-box:fill-box;transform-origin:center;animation:ping 1.8s ease-out infinite;animation-delay:calc(var(--i,0) * .2s)}
@keyframes inUp{0%{opacity:0;transform:translateY(8px)}8%,86%{opacity:1;transform:none}96%,100%{opacity:0;transform:none}}
@keyframes grow{0%{transform:scaleX(0)}14%,86%{transform:scaleX(1)}96%,100%{transform:scaleX(0)}}
@keyframes pop{0%,4%{opacity:0;transform:scale(.6)}12%,86%{opacity:1;transform:none}96%,100%{opacity:0}}
@keyframes type{0%{clip-path:inset(0 100% 0 0)}40%,86%{clip-path:inset(0 0 0 0)}96%,100%{clip-path:inset(0 100% 0 0)}}
@keyframes draw{0%{stroke-dasharray:0 100}18%,86%{stroke-dasharray:var(--da)}96%,100%{stroke-dasharray:0 100}}
@keyframes line{0%{stroke-dashoffset:1}30%,86%{stroke-dashoffset:0}96%,100%{stroke-dashoffset:1}}
@keyframes drop{0%,2%{opacity:0;transform:translateY(-14px)}10%,86%{opacity:1;transform:none}96%,100%{opacity:0}}
@keyframes ping{0%{opacity:.5;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}
@keyframes prog{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
@keyframes camDrift{0%{transform:scale(1) translateY(0)}100%{transform:scale(1.06) translateY(-2%)}}
/* prompt bar */
.cmp{position:sticky;bottom:max(14px,env(safe-area-inset-bottom,0px));z-index:20;max-width:760px;margin:36px auto 0;background:var(--mp-surface);border:1px solid var(--mp-line);box-shadow:0 18px 50px color-mix(in srgb,var(--mp-ink) 55%,transparent)}
.cmp-top{display:block;text-align:center;padding:8px 12px;font:600 14px var(--mp-font-sans);color:var(--mp-surface);background:var(--mp-navy);text-decoration:none}
.cmp-top:hover{background:var(--mp-navy-hover)}
.cmp-body{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:stretch;padding:9px}
.cmp-ref{display:grid;justify-items:center;align-content:center;gap:4px;width:70px;border:1px dashed var(--mp-line);background:var(--mp-paper);color:var(--mp-muted);font:500 11px var(--mp-font-sans);text-align:center;padding:8px 4px}
.cmp-ref i{width:22px;height:22px;border:1.5px solid var(--mp-navy)}
.cmp-input{display:grid;align-content:space-between;gap:6px;min-width:0}
.cmp-text{display:block;min-height:1.5em;font:400 16px/1.5 var(--mp-font-serif);color:var(--mp-ink)}
.cmp-caret{display:inline-block;width:2px;height:1.05em;margin-left:2px;vertical-align:-2px;background:var(--mp-navy);animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.cmp-chips{display:flex;gap:6px;flex-wrap:wrap}
.cmp-chips span{font:500 12px var(--mp-font-sans);color:var(--mp-body);background:var(--mp-paper);border:1px solid var(--mp-hair);padding:4px 9px}
.cmp-go{display:grid;place-items:center;text-align:center;width:132px;padding:8px;background:var(--mp-navy);color:var(--mp-surface);font:700 13px var(--mp-font-sans);letter-spacing:.06em;text-transform:uppercase;text-decoration:none}
.cmp-go:hover{background:var(--mp-navy-hover)}
@media(max-width:620px){.cmp-body{grid-template-columns:minmax(0,1fr)}.cmp-ref{display:none}.cmp-go{width:auto}}
/* detail sheet */
.mg-modal{position:fixed;inset:0;z-index:100;background:color-mix(in srgb,var(--mp-ink) 70%,transparent);display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
.mg-sheet{position:relative;width:min(1080px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--mp-surface);border:1px solid var(--mp-line);display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}
@media(max-width:820px){.mg-sheet{grid-template-columns:minmax(0,1fr)}}
.mg-sheet-media{display:flex;align-items:center;padding:26px;background:var(--mp-ink);overflow:hidden}
.mg-sheet-body{padding:30px 28px;display:flex;flex-direction:column;gap:12px}
.mg-cat{display:block;font:700 10px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mp-accent)}
.mg-sheet-h{margin:0;font:700 1.7rem/1.2 var(--mp-font-serif);color:var(--mp-ink)}
.mg-result{margin:0;font:400 15px/1.6 var(--mp-font-sans);color:var(--mp-body)}
.mg-label{margin:8px 0 0;font:700 11px var(--mp-font-sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mp-ink)}
.mg-prompt{margin:0;background:var(--mp-paper);border:1px solid var(--mp-line);padding:14px;font:400 15px/1.6 var(--mp-font-sans);color:var(--mp-ink);user-select:text}
.mg-locked{display:grid;gap:12px;background:var(--mp-paper);border:1px dashed var(--mp-line);padding:14px}
.mg-locked p{margin:0;color:var(--mp-muted);font:400 14px/1.5 var(--mp-font-sans)}
.mg-blur{display:grid;gap:8px}
.mg-blur i{display:block;height:10px;background:var(--mp-wash)}
.mg-fine2{margin:auto 0 0;color:var(--mp-muted);font:400 13px/1.5 var(--mp-font-sans)}
.mg-x{position:absolute;top:12px;right:12px;width:34px;height:34px;border-radius:50%;border:1px solid var(--mp-line);background:var(--mp-surface);color:var(--mp-ink);font-size:20px;line-height:1;cursor:pointer;z-index:1}
@media (prefers-reduced-motion:reduce){.mg *{animation:none!important}.vid .ping{display:none}}
`;
