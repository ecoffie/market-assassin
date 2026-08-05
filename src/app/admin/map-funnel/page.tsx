'use client';

/**
 * Admin: Opportunity Map — "Today's Product" (Epic #1, PR4).
 *
 * The morning dashboard FOR ERIC over /api/admin/map-funnel. Renders the three things the
 * instrumentation collects — the discovery FUNNEL (map_open → … → proposal_started with per-step
 * drop-off), the top STRATEGY combinations, and "WHY THIS OPPORTUNITY?" (which DNA strand drives the
 * click) — in one scannable view. Pure CSS/SVG bars (no chart lib), matching the /mcp usage-charts house
 * style. Honest empty-states: instrumented:false and ctr:null read as "not yet", never a fabricated 0.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface FunnelStep {
  step: string; label: string; users: number; events: number;
  convFromPrev: number | null; convFromTop: number | null;
}
interface StrategyCombo { combo: string; strands: string[]; users: number; applies: number }
interface StrandPop { strand: string; users: number }
interface WhyStrand { strand: string; impressions: number; clicks: number; ctr: number | null }
interface FunnelData {
  ok: boolean; windowDays: number; instrumented: boolean; totalMapEvents: number;
  funnel: FunnelStep[];
  biggestDrop: { fromStep: string; toStep: string; dropPct: number } | null;
  strategy: { strategyFilterUsers: number; topStrategies: StrategyCombo[]; strandPopularity: StrandPop[] };
  whyThisOpportunity: { minImpressions: number; strands: WhyStrand[] };
  note: string;
}

// Turn a snake_case strand/step key into a human label ("repeat_buyer" → "Repeat Buyer").
const humanize = (k: string) => k.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const nfmt = new Intl.NumberFormat('en-US');
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);

export default function MapFunnelDashboard() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');

  const [days, setDays] = useState(30);
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const today = useMemo(() => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date()), []);

  // ── auth (mirrors launch-command-center: sessionStorage + /api/admin/verify-password) ──────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = sessionStorage.getItem('adminPassword');
      if (!stored) { if (!cancelled) setChecking(false); return; }
      try {
        const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: stored }) });
        const d = await r.json();
        if (cancelled) return;
        if (d.valid || d.success) { setAuthenticated(true); setPassword(stored); }
        else { sessionStorage.removeItem('adminPassword'); }
      } catch { if (!cancelled) sessionStorage.removeItem('adminPassword'); }
      finally { if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (e: FormEvent) => {
    e.preventDefault(); setAuthError('');
    try {
      const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwInput }) });
      const d = await r.json();
      if (d.valid || d.success) { sessionStorage.setItem('adminPassword', pwInput); setPassword(pwInput); setAuthenticated(true); }
      else setAuthError('Invalid admin password');
    } catch { setAuthError('Could not verify. Try again.'); }
  }, [pwInput]);

  // ── load ───────────────────────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true); setLoadError('');
    try {
      const r = await fetch(`/api/admin/map-funnel?password=${encodeURIComponent(password)}&days=${days}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d as FunnelData);
    } catch (err) { setLoadError(err instanceof Error ? err.message : 'Load failed'); setData(null); }
    finally { setLoading(false); }
  }, [password, days]);

  useEffect(() => { if (authenticated) load(); }, [authenticated, load]);

  if (checking) return <Shell><p style={S.muted}>Checking access…</p></Shell>;

  if (!authenticated) {
    return (
      <Shell>
        <form onSubmit={login} style={{ maxWidth: 340, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ ...S.h1, fontSize: 20 }}>Map Funnel — admin</h1>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
          <button type="submit" style={S.btnPrimary}>Enter</button>
          {authError && <p style={{ color: '#f87171', fontSize: 13, margin: 0 }}>{authError}</p>}
        </form>
      </Shell>
    );
  }

  const funnel = data?.funnel ?? [];
  const top = funnel[0]?.users ?? 0; // the funnel's mouth — every bar scales to this
  const notInstrumented = data && !data.instrumented;

  return (
    <Shell>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={S.eyebrow}>Today&apos;s Product · {today}</div>
          <h1 style={S.h1}>Opportunity Map — how people use it</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 2 }}>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                style={{ ...S.segBtn, ...(days === d ? S.segBtnOn : {}) }}>{d}d</button>
            ))}
          </div>
          <button onClick={load} disabled={loading} style={S.btnGhost}>{loading ? '…' : '↻ Refresh'}</button>
        </div>
      </div>

      {loadError && <div style={S.errorBox}>Couldn&apos;t load: {loadError}</div>}

      {notInstrumented && (
        <div style={S.noteBox}>
          <strong>No map events in this {data!.windowDays}-day window yet.</strong> The funnel is empty because
          nothing was logged — not because conversion is 0. (Newly-shipped events populate a day or two after deploy.)
        </div>
      )}

      {data && (
        <>
          {/* KPI strip — the funnel steps as at-a-glance tiles */}
          <div style={S.kpiRow}>
            {funnel.map((s) => (
              <div key={s.step} style={S.kpi}>
                <div style={S.kpiNum}>{nfmt.format(s.users)}</div>
                <div style={S.kpiLabel}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* The FUNNEL — descending bars, per-step conversion, biggest drop flagged */}
          <Card title="The discovery funnel" sub={`${nfmt.format(data.totalMapEvents)} events · users per step, % = conversion from the step above`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {funnel.map((s, i) => {
                const w = top > 0 ? Math.max((s.users / top) * 100, s.users > 0 ? 2 : 0) : 0;
                const isDrop = data.biggestDrop && data.biggestDrop.toStep === s.step;
                return (
                  <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 130, fontSize: 13, color: '#cbd5e1', textAlign: 'right', flexShrink: 0 }}>{s.label}</div>
                    <div style={{ flex: 1, position: 'relative', height: 30, background: '#0f172a', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', inset: 0, width: `${w}%`, background: isDrop ? 'linear-gradient(90deg,#b4530933,#b45309)' : 'linear-gradient(90deg,#10b98122,#10b981)', borderRadius: 6, transition: 'width .4s ease' }} />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 13, fontWeight: 600, color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
                        {nfmt.format(s.users)}
                      </div>
                    </div>
                    <div style={{ width: 92, fontSize: 12, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: i === 0 ? '#64748b' : isDrop ? '#f59e0b' : '#94a3b8' }}>
                      {i === 0 ? 'start' : `${pct(s.convFromPrev)}${isDrop ? ' ⚠' : ''}`}
                    </div>
                  </div>
                );
              })}
            </div>
            {data.biggestDrop && (
              <div style={S.dropCallout}>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>Biggest drop-off:</span>{' '}
                {humanize(data.biggestDrop.fromStep)} → {humanize(data.biggestDrop.toStep)} loses{' '}
                <strong>{data.biggestDrop.dropPct}%</strong> of users. Focus here.
              </div>
            )}
          </Card>

          {/* Two-up: Top Strategies + Why this opportunity */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
            <Card title="Top strategies" sub={`${nfmt.format(data.strategy.strategyFilterUsers)} users filtered by strategy · a combination = one strategy`}>
              {data.strategy.topStrategies.length === 0 ? (
                <Empty>No strategy filters applied yet in this window.</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.strategy.topStrategies.slice(0, 8).map((c) => {
                    const maxU = data.strategy.topStrategies[0].users || 1;
                    return (
                      <div key={c.combo}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                          <span style={{ color: '#e2e8f0', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {c.strands.map((st) => <span key={st} style={S.chip}>{humanize(st)}</span>)}
                          </span>
                          <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 8 }}>{nfmt.format(c.users)}</span>
                        </div>
                        <div style={{ height: 5, background: '#0f172a', borderRadius: 3 }}>
                          <div style={{ height: 5, width: `${(c.users / maxU) * 100}%`, background: '#7c3aed', borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card title="Why this opportunity?" sub={`Which DNA strand drives the click (CTR = click ÷ impression, min ${data.whyThisOpportunity.minImpressions} impressions)`}>
              {data.whyThisOpportunity.strands.filter((s) => s.ctr != null).length === 0 ? (
                <Empty>Not enough clicked-card data yet — needs the DNA-on-card event live + traffic.</Empty>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#64748b', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      <th style={{ padding: '4px 0' }}>Strand</th>
                      <th style={{ ...S.thNum }}>Seen</th>
                      <th style={{ ...S.thNum }}>Clicks</th>
                      <th style={{ ...S.thNum }}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.whyThisOpportunity.strands.filter((s) => s.ctr != null).slice(0, 10).map((s) => (
                      <tr key={s.strand} style={{ borderTop: '1px solid #1e293b' }}>
                        <td style={{ padding: '6px 0', color: '#e2e8f0' }}>{humanize(s.strand)}</td>
                        <td style={S.tdNum}>{nfmt.format(s.impressions)}</td>
                        <td style={S.tdNum}>{nfmt.format(s.clicks)}</td>
                        <td style={{ ...S.tdNum, color: '#34d399', fontWeight: 700 }}>{s.ctr}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <p style={{ ...S.muted, fontSize: 12, marginTop: 18 }}>{data.note}</p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-sans-serif,system-ui,-apple-system,sans-serif', padding: '28px 20px 60px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '18px 4px', fontSize: 13, color: '#64748b' }}>{children}</div>;
}

const S: Record<string, React.CSSProperties> = {
  eyebrow: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#7c3aed', fontWeight: 700 },
  h1: { fontSize: 24, fontWeight: 800, margin: '2px 0 0', color: '#f8fafc', letterSpacing: '-.01em' },
  muted: { color: '#64748b' },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginBottom: 16 },
  kpi: { background: '#0b1120', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px' },
  kpiNum: { fontSize: 22, fontWeight: 800, color: '#10b981', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 },
  kpiLabel: { fontSize: 11, color: '#94a3b8', marginTop: 3 },
  chip: { fontSize: 11, background: '#1e293b', color: '#cbd5e1', padding: '1px 6px', borderRadius: 4 },
  dropCallout: { marginTop: 14, padding: '10px 12px', background: '#b4530915', border: '1px solid #b4530944', borderRadius: 8, fontSize: 13, color: '#fcd9a8' },
  noteBox: { padding: '12px 14px', background: '#0b1120', border: '1px solid #1e293b', borderRadius: 10, fontSize: 13, color: '#94a3b8', marginBottom: 16 },
  errorBox: { padding: '12px 14px', background: '#7f1d1d22', border: '1px solid #7f1d1d', borderRadius: 10, fontSize: 13, color: '#fca5a5', marginBottom: 16 },
  segBtn: { padding: '5px 12px', fontSize: 13, border: 'none', background: 'transparent', color: '#94a3b8', borderRadius: 6, cursor: 'pointer', fontWeight: 600 },
  segBtnOn: { background: '#1e293b', color: '#f1f5f9' },
  btnGhost: { padding: '7px 14px', fontSize: 13, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  btnPrimary: { padding: '10px 14px', fontSize: 14, border: 'none', background: '#7c3aed', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700 },
  thNum: { padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tdNum: { padding: '6px 0', textAlign: 'right', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' },
};
