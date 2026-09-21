'use client';

/**
 * The Procurement Observatory — the Mindy Institute's continuous research engine.
 *
 * NOT an annual report (Eric): a LIVING OBSERVATORY (Gartner/Bloomberg model). It observes the
 * public procurement market continuously; every publication — the annual Procurement Intelligence
 * Report, white papers, press, future indices — is a downstream SNAPSHOT of these metrics. Each
 * metric shows its MATURITY (where the science is) + the outputs it's eligible to flow into.
 *
 * Same dark console + admin-password auth as /admin/competition-health and /admin/map-funnel.
 * Grounded-now: every figure traces to the query on its card; a gap is disclosed via maturity,
 * never fabricated.
 */

import { useCallback, useEffect, useState } from 'react';

type Maturity = 'production' | 'beta' | 'collecting' | 'research' | 'error';
interface Standard {
  id: string; name: string;
  definition: string; whyItMatters: string; calculation: string;
  dataSources: string[]; limitations: string[]; interpretation: string;
  lifecycle: string; versionHistory: { version: string; date: string; change: string }[];
  version: string; since: string; category: string; audience: string[]; refresh: string;
  publishable: boolean; citable: boolean; public: boolean; apiReady: boolean; confidence: 1 | 2 | 3 | 4 | 5;
}
interface Metric {
  key: string; title: string; domain: 'supply' | 'behavior' | 'competition';
  maturity: Maturity; source: string; n: number;
  findings: { label: string; value: string }[];
  outputs: string[]; note: string; error: string | null;
  id: string | null; standard: Standard | null;
}
const stars = (c: 1 | 2 | 3 | 4 | 5) => '★'.repeat(c) + '☆'.repeat(5 - c);
interface Observatory {
  generatedAtNote: string;
  corpus: { events: number | null; users: number | null; firstDay: string | null; lastDay: string | null; error: string | null };
  metrics: Metric[];
}
interface ObsData { ok: boolean; observatory: Observatory; note: string }

const MATURITY: Record<Maturity, { dot: string; label: string; blurb: string; color: string; bg: string; border: string; order: number }> = {
  production: { dot: '🟢', label: 'Production', blurb: 'publishable now', color: '#3ecf8e', bg: 'rgba(62,207,142,.08)', border: 'rgba(62,207,142,.22)', order: 0 },
  beta:       { dot: '🟡', label: 'Beta', blurb: 'real signal · needs validation', color: '#e8b13a', bg: 'rgba(232,177,58,.08)', border: 'rgba(232,177,58,.22)', order: 1 },
  collecting: { dot: '🟡', label: 'Collecting', blurb: 'accruing · not yet enough', color: '#c8a13a', bg: 'rgba(200,161,58,.06)', border: 'rgba(200,161,58,.20)', order: 2 },
  research:   { dot: '🔴', label: 'Research', blurb: 'defined · no data yet', color: '#f0616d', bg: 'rgba(240,97,109,.07)', border: 'rgba(240,97,109,.22)', order: 3 },
  error:      { dot: '⚠️', label: 'Error', blurb: 'query failed · surfaced', color: '#f0616d', bg: 'rgba(240,97,109,.10)', border: 'rgba(240,97,109,.30)', order: 4 },
};
const DOMAIN_LABEL: Record<Metric['domain'], string> = { supply: 'Supply-side (public record)', behavior: 'Behavioral (the moat)', competition: 'Competition (composite)' };
const OUTPUT_LABEL: Record<string, string> = { annual: 'Annual Report', white_paper: 'White Paper', press: 'Press', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export default function ObservatoryDashboard() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [data, setData] = useState<ObsData | null>(null);
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
      const r = await fetch(`/api/admin/observatory?password=${encodeURIComponent(pw)}`);
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
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Procurement Observatory</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>Admin access required.</div>
        <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus
          style={{ padding: '10px 12px', borderRadius: 8, background: '#0b1120', border: '1px solid #334155', color: '#f1f5f9', fontSize: 14 }} />
        {authError && <div style={{ color: '#f0616d', fontSize: 13 }}>{authError}</div>}
        <button type="submit" style={{ padding: '10px 12px', borderRadius: 8, background: '#3ecf8e', color: '#022c22', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>Enter</button>
      </form>
    </Shell>
  );

  const obs = data?.observatory;
  const metrics = obs?.metrics || [];
  const counts = metrics.reduce((a, m) => { a[m.maturity] = (a[m.maturity] || 0) + 1; return a; }, {} as Record<string, number>);
  const domains: Metric['domain'][] = ['supply', 'behavior', 'competition'];

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#3ecf8e', fontWeight: 700 }}>The Mindy Institute</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: '2px 0 0' }}>Procurement Observatory</h1>
        </div>
        <button onClick={() => load(password)} disabled={loading}
          style={{ padding: '8px 14px', borderRadius: 8, background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? .6 : 1 }}>
          {loading ? 'Running…' : '↻ Re-run'}
        </button>
      </div>
      <p style={{ color: '#94a3b8', fontSize: 13.5, margin: '0 0 18px', maxWidth: 820 }}>
        A continuous research engine — not an annual report. It observes the public procurement market every day; the annual
        Procurement Intelligence Report, white papers, and press are downstream <b>snapshots</b> of these metrics. Every figure
        traces to the query on its card; each metric shows where the science is.
      </p>

      {loadError && <div style={{ background: 'rgba(240,97,109,.10)', border: '1px solid rgba(240,97,109,.30)', borderRadius: 10, padding: '12px 16px', color: '#fca5a5', fontSize: 13, marginBottom: 16 }}>✗ {loadError}</div>}

      {/* maturity legend + corpus */}
      {obs && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          {(['production', 'beta', 'collecting', 'research'] as Maturity[]).map((m) => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', background: MATURITY[m].bg, border: `1px solid ${MATURITY[m].border}`, borderRadius: 8, padding: '6px 11px' }}>
              <span>{MATURITY[m].dot}</span>
              <b style={{ color: MATURITY[m].color }}>{MATURITY[m].label}</b>
              <span style={{ color: '#64748b' }}>{counts[m] || 0} · {MATURITY[m].blurb}</span>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>
            {obs.corpus.error ? <span style={{ color: '#f0616d' }}>corpus: {obs.corpus.error}</span> : (
              <>corpus: {(obs.corpus.events ?? 0).toLocaleString()} events · {(obs.corpus.users ?? 0).toLocaleString()} users · {obs.corpus.firstDay}→{obs.corpus.lastDay}</>
            )}
          </div>
        </div>
      )}

      {/* metrics grouped by domain, sorted by maturity within */}
      {domains.map((dom) => {
        const rows = metrics.filter((m) => m.domain === dom).sort((a, b) => MATURITY[a.maturity].order - MATURITY[b.maturity].order);
        if (!rows.length) return null;
        return (
          <div key={dom} style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', fontWeight: 700, marginBottom: 10 }}>{DOMAIN_LABEL[dom]}</div>
            <div style={{ display: 'grid', gap: 12 }}>
              {rows.map((m) => <MetricCard key={m.key} m={m} />)}
            </div>
          </div>
        );
      })}

      {data?.note && <p style={{ color: '#475569', fontSize: 11.5, marginTop: 20, maxWidth: 900 }}>{data.note}</p>}
    </Shell>
  );
}

function MetricCard({ m }: { m: Metric }) {
  const mat = MATURITY[m.maturity];
  const [openStd, setOpenStd] = useState(false);
  const std = m.standard;
  return (
    <div style={{ background: '#0f172a', border: `1px solid ${mat.border}`, borderLeft: `3px solid ${mat.color}`, borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{mat.dot}</span>
          {m.id && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', background: '#0b1120', border: '1px solid #334155', borderRadius: 5, padding: '1px 7px' }}>{m.id}</span>}
          <span style={{ fontSize: 15.5, fontWeight: 700, color: '#f1f5f9' }}>{m.title}</span>
          <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700, color: mat.color, background: mat.bg, border: `1px solid ${mat.border}`, borderRadius: 5, padding: '1px 7px' }}>{mat.label}</span>
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>n = {m.n.toLocaleString()}</span>
      </div>

      {m.error ? (
        <div style={{ color: '#fca5a5', fontSize: 13, padding: '10px 0 2px' }}>✗ {m.error}</div>
      ) : m.findings.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, margin: '11px 0 4px' }}>
          {m.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 13.5, borderBottom: i < m.findings.length - 1 ? '1px solid #1e293b' : 'none', paddingBottom: 5 }}>
              <span style={{ color: '#94a3b8' }}>{f.label}</span>
              <span style={{ color: '#f1f5f9', fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{f.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#64748b', fontSize: 13, padding: '8px 0 2px', fontStyle: 'italic' }}>No data yet — {mat.blurb}.</div>
      )}

      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>{m.note}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: '#475569', fontFamily: 'ui-monospace, monospace' }}>{m.source}</span>
        <span style={{ flex: 1 }} />
        {m.outputs.map((o) => (
          <span key={o} style={{ fontSize: 10, color: '#64748b', background: '#0b1120', border: '1px solid #1e293b', borderRadius: 5, padding: '1px 7px' }}>{OUTPUT_LABEL[o] || o}</span>
        ))}
      </div>

      {/* View Standard (OBS-###) — the citable scientific record. NO SQL/engineering detail here. */}
      {std && (
        <div style={{ marginTop: 12, borderTop: '1px solid #1e293b', paddingTop: 10 }}>
          <button onClick={() => setOpenStd((v) => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
            <span style={{ transform: openStd ? 'rotate(90deg)' : 'none', transition: 'transform .12s', display: 'inline-block' }}>▸</span>
            View Standard ({std.id}) · v{std.version} · <span title="confidence" style={{ color: '#e8b13a', letterSpacing: 1 }}>{stars(std.confidence)}</span>
          </button>
          {openStd && (
            <div style={{ marginTop: 10, display: 'grid', gap: 11, fontSize: 12.5, color: '#cbd5e1' }}>
              <StdField label="Definition">{std.definition}</StdField>
              <StdField label="Why It Matters">{std.whyItMatters}</StdField>
              <StdField label="Calculation">{std.calculation}</StdField>
              <StdField label="Data Sources">{std.dataSources.join(' · ')}</StdField>
              <StdField label="Limitations">
                <ul style={{ margin: 0, paddingLeft: 16 }}>{std.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </StdField>
              <StdField label="Interpretation">{std.interpretation}</StdField>
              <StdField label="Lifecycle">
                <span style={{ color: '#e2e8f0', fontFamily: 'ui-monospace, monospace' }}>Research → Collecting → Beta → Production</span>
                <span style={{ color: '#64748b' }}> · currently <b style={{ color: mat.color }}>{std.lifecycle}</b> (since {std.since})</span>
              </StdField>
              <StdField label="Version History">
                {std.versionHistory.map((v, i) => (
                  <div key={i} style={{ color: '#94a3b8' }}><b style={{ color: '#e2e8f0' }}>{v.version}</b> ({v.date}) — {v.change}</div>
                ))}
              </StdField>
              {/* structured metadata badges — powers research pages / APIs / AI citations later */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 2 }}>
                <MetaBadge on={std.publishable}>publishable</MetaBadge>
                <MetaBadge on={std.citable}>citable</MetaBadge>
                <MetaBadge on={std.apiReady}>api-ready</MetaBadge>
                <MetaBadge on={std.public}>public</MetaBadge>
                <span style={{ fontSize: 10, color: '#475569', alignSelf: 'center' }}>· audience: {std.audience.join(', ')} · refresh: {std.refresh}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StdField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', fontWeight: 700, marginBottom: 3 }}>{label}</div>
      <div style={{ lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
function MetaBadge({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: on ? '#3ecf8e' : '#475569', background: on ? 'rgba(62,207,142,.08)' : '#0b1120', border: `1px solid ${on ? 'rgba(62,207,142,.22)' : '#1e293b'}`, borderRadius: 5, padding: '1px 7px' }}>
      {on ? '✓' : '·'} {children}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px 60px' }}>{children}</div>
    </div>
  );
}
