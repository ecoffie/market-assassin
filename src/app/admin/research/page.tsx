'use client';

/**
 * The Mindy Institute Research Library — the publications pipeline (admin view).
 *
 * Publications cite Observatory metrics by their permanent OBS-### id and inherit their maturity.
 * HONEST: nothing is listed as published that isn't — the pipeline is the real forthcoming work.
 * Same dark-console shell + admin-password auth as /admin/observatory. Public /research inherits
 * this registry later.
 */

import { useCallback, useEffect, useState } from 'react';

type PubStatus = 'planned' | 'drafting' | 'review' | 'published' | 'archived';
type Maturity = 'production' | 'beta' | 'collecting' | 'research' | null;
interface Cited { id: string; name: string | null; maturity: Maturity; confidence: number | null }
interface Publication {
  id: string; title: string; class: string; kind: string; status: PubStatus; summary: string;
  audience: string[]; edition: string | null; url: string | null; publishedDate: string | null; gate: string;
  cited: Cited[];
  readiness: { ready: boolean; blockedBy: { id: string; maturity: string }[] };
}
interface ResData { ok: boolean; publications: Publication[]; note: string }

const STATUS: Record<PubStatus, { label: string; color: string; bg: string; border: string }> = {
  published: { label: 'Published', color: '#3ecf8e', bg: 'rgba(62,207,142,.08)', border: 'rgba(62,207,142,.24)' },
  review:    { label: 'In Review', color: '#e8b13a', bg: 'rgba(232,177,58,.08)', border: 'rgba(232,177,58,.24)' },
  drafting:  { label: 'Drafting', color: '#c8a13a', bg: 'rgba(200,161,58,.06)', border: 'rgba(200,161,58,.20)' },
  planned:   { label: 'Planned', color: '#94a3b8', bg: 'rgba(148,163,184,.06)', border: '#334155' },
  archived:  { label: 'Archived', color: '#64748b', bg: '#0b1120', border: '#1e293b' },
};
const KIND_LABEL: Record<string, string> = { annual: 'Annual Report', white_paper: 'White Paper', press: 'Press', index: 'Index / Benchmark', dataset: 'Dataset' };
const CLASS_LABEL: Record<string, string> = { standard: 'Standard', benchmark: 'Benchmark', research: 'Research' };
const MAT: Record<string, { dot: string; color: string }> = {
  production: { dot: '🟢', color: '#3ecf8e' }, beta: { dot: '🟡', color: '#e8b13a' },
  collecting: { dot: '🟡', color: '#c8a13a' }, research: { dot: '🔴', color: '#f0616d' },
};

export default function ResearchLibrary() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [data, setData] = useState<ResData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = sessionStorage.getItem('adminPassword');
      if (!stored) { if (!cancelled) setChecking(false); return; }
      try {
        const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: stored }) });
        const d = await r.json();
        if (cancelled) return;
        if (d.valid || d.success) { setAuthed(true); setPassword(stored); }
        else sessionStorage.removeItem('adminPassword');
      } catch { if (!cancelled) sessionStorage.removeItem('adminPassword'); }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (pw: string) => {
    setLoading(true); setLoadError('');
    try {
      const r = await fetch(`/api/admin/research?password=${encodeURIComponent(pw)}`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      setData(await r.json());
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (authed && password) load(password); }, [authed, password, load]);

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthError('');
    try {
      const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwInput }) });
      const d = await r.json();
      if (d.valid || d.success) { sessionStorage.setItem('adminPassword', pwInput); setPassword(pwInput); setAuthed(true); }
      else setAuthError('Incorrect password');
    } catch { setAuthError('Verification failed'); }
  };

  if (checking) return <Shell><div style={{ color: '#64748b', padding: 40 }}>Checking access…</div></Shell>;
  if (!authed) return (
    <Shell>
      <form onSubmit={submitPw} style={{ maxWidth: 360, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Research Library</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>Admin access required.</div>
        <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus
          style={{ padding: '10px 12px', borderRadius: 8, background: '#0b1120', border: '1px solid #334155', color: '#f1f5f9', fontSize: 14 }} />
        {authError && <div style={{ color: '#f0616d', fontSize: 13 }}>{authError}</div>}
        <button type="submit" style={{ padding: '10px 12px', borderRadius: 8, background: '#3ecf8e', color: '#022c22', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>Enter</button>
      </form>
    </Shell>
  );

  const pubs = data?.publications || [];
  const published = pubs.filter((p) => p.status === 'published').length;

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#3ecf8e', fontWeight: 700 }}>The Mindy Institute</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: '2px 0 0' }}>Research Library</h1>
        </div>
        <button onClick={() => load(password)} disabled={loading}
          style={{ padding: '8px 14px', borderRadius: 8, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? .6 : 1 }}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>
      <p style={{ color: '#94a3b8', fontSize: 13.5, margin: '0 0 8px', maxWidth: 820 }}>
        Every publication <b>cites Observatory metrics by their permanent OBS-### id</b> — inheriting their
        credibility and their maturity. A publication can only be as credible as its least-mature cited metric.
      </p>
      <p style={{ color: '#64748b', fontSize: 12.5, margin: '0 0 20px', maxWidth: 820 }}>
        {published === 0
          ? 'Nothing is published yet — this is the honest forthcoming pipeline. Nothing here claims to be published that isn’t; a report shows a URL only once it actually ships.'
          : `${published} published · the rest is the forthcoming pipeline.`}
      </p>

      {loadError && <div style={{ background: 'rgba(240,97,109,.10)', border: '1px solid rgba(240,97,109,.30)', borderRadius: 10, padding: '12px 16px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>✗ {loadError}</div>}

      <div style={{ display: 'grid', gap: 14 }}>
        {pubs.map((p) => <PubCard key={p.id} p={p} />)}
      </div>

      {data?.note && <p style={{ color: '#475569', fontSize: 11.5, marginTop: 20, maxWidth: 900 }}>{data.note}</p>}
    </Shell>
  );
}

function PubCard({ p }: { p: Publication }) {
  const st = STATUS[p.status];
  return (
    <div style={{ background: '#0f172a', border: `1px solid ${st.border}`, borderLeft: `3px solid ${st.color}`, borderRadius: 12, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', background: '#0b1120', border: '1px solid #334155', borderRadius: 5, padding: '1px 7px' }}>{p.id}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{p.title}</span>
          {p.edition && <span style={{ fontSize: 12, color: '#64748b' }}>· {p.edition}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, color: '#a78bfa', background: 'rgba(124,58,237,.10)', border: '1px solid rgba(124,58,237,.30)', borderRadius: 5, padding: '2px 8px' }}>{CLASS_LABEL[p.class] || p.class}</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>{KIND_LABEL[p.kind] || p.kind}</span>
          <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, color: st.color, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 5, padding: '2px 8px' }}>{st.label}</span>
        </div>
      </div>

      <p style={{ color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.55, margin: '11px 0 12px', maxWidth: 760 }}>{p.summary}</p>

      {/* cited metrics — each chip carries the metric's LIVE maturity, so the dependency is honest */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', fontWeight: 700 }}>Cites Observatory metrics</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {p.cited.map((c) => {
            const m = c.maturity ? MAT[c.maturity] : null;
            return (
              <span key={c.id} title={c.name || c.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#e2e8f0', background: '#0b1120', border: `1px solid ${m?.color ? m.color + '55' : '#334155'}`, borderRadius: 6, padding: '2px 8px' }}>
                {m && <span style={{ fontSize: 9 }}>{m.dot}</span>}
                <b style={{ fontFamily: 'ui-monospace, monospace', color: '#94a3b8' }}>{c.id}</b>
                {c.name && <span style={{ color: '#64748b' }}>{c.name.length > 26 ? c.name.slice(0, 26) + '…' : c.name}</span>}
              </span>
            );
          })}
        </div>
      </div>

      {/* readiness — a DATA signal (are all cited metrics Production?), not an auto-publish */}
      <div style={{ marginTop: 12, borderTop: '1px solid #1e293b', paddingTop: 10, fontSize: 12, color: '#64748b' }}>
        {p.status === 'published' ? (
          <span style={{ color: '#3ecf8e' }}>✓ Published{p.publishedDate ? ` · ${p.publishedDate}` : ''}{p.url ? <> · <a href={p.url} style={{ color: '#3ecf8e' }}>view →</a></> : ''}</span>
        ) : p.readiness.ready ? (
          <span><span style={{ color: '#3ecf8e' }}>◆ Data-ready</span> — all cited metrics are Production. {p.gate}</span>
        ) : (
          <span>
            <span style={{ color: '#e8b13a' }}>◇ Not data-ready</span> — blocked by {p.readiness.blockedBy.map((b) => `${b.id} (${b.maturity})`).join(', ')}. {p.gate}
          </span>
        )}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px 60px' }}>{children}</div>
    </div>
  );
}
