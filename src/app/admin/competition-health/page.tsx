'use client';

/**
 * Admin: Competition Health — the buyer-side mirror of Market Intelligence.
 *
 * A procurement director's scorecard for one agency, insight-first (same dark console + priority
 * cards as /admin/map-funnel). Every metric is grounded in real data or honestly flagged "Coming".
 * Admin-previewable (Phase 1); a gated per-agency buyer entry is Phase 3 (PRD).
 */

import { FormEvent, useCallback, useEffect, useState } from 'react';

interface Priority { level: 'go' | 'watch' | 'stop'; title: string; body: string; rec: string }
interface Health {
  agency: string; windowDays: number; grounded: boolean;
  smallBizParticipation: { activeOpps: number; withSetAside: number; pct: number | null };
  setAsideMix: { label: string; count: number }[];
  awardedSetAsideMix: { label: string; count: number }[];
  marketCoverage: { distinctNaics: number; topNaics: { naics: string; opps: number }[] };
  notYetMeasurable: { metric: string; needs: string }[];
}
interface CHData { ok: boolean; agency: string; windowDays: number; todaysPriorities: Priority[]; health: Health; note: string }

// A few common agencies for the quick-switch (the admin preview; the buyer version is scoped to one).
const AGENCIES = [
  'VETERANS AFFAIRS, DEPARTMENT OF',
  'DEPT OF DEFENSE',
  'HOMELAND SECURITY, DEPARTMENT OF',
  'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',
  'GENERAL SERVICES ADMINISTRATION',
  'AGRICULTURE, DEPARTMENT OF',
];
const shortAgency = (a: string) => a.split(',')[0].replace(/DEPT OF /i, '').replace(/DEPARTMENT OF /i, '').trim();

export default function CompetitionHealthDashboard() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [agency, setAgency] = useState(AGENCIES[0]);
  const [data, setData] = useState<CHData | null>(null);
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

  const login = useCallback(async (e: FormEvent) => {
    e.preventDefault(); setAuthError('');
    try {
      const r = await fetch('/api/admin/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwInput }) });
      const d = await r.json();
      if (d.valid || d.success) { sessionStorage.setItem('adminPassword', pwInput); setPassword(pwInput); setAuthed(true); }
      else setAuthError('Invalid admin password');
    } catch { setAuthError('Could not verify. Try again.'); }
  }, [pwInput]);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true); setLoadError('');
    try {
      const r = await fetch(`/api/admin/competition-health?password=${encodeURIComponent(password)}&agency=${encodeURIComponent(agency)}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setData(d as CHData);
    } catch (err) { setLoadError(err instanceof Error ? err.message : 'Load failed'); setData(null); }
    finally { setLoading(false); }
  }, [password, agency]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  if (checking) return <Shell><p style={{ color: '#64748b' }}>Checking access…</p></Shell>;
  if (!authed) {
    return (
      <Shell>
        <form onSubmit={login} style={{ maxWidth: 340, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>Competition Health — admin</h1>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
          <button type="submit" style={{ padding: '10px 14px', border: 'none', background: '#6366f1', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Enter</button>
          {authError && <p style={{ color: '#f87171', fontSize: 13 }}>{authError}</p>}
        </form>
      </Shell>
    );
  }

  const h = data?.health;
  const sb = h?.smallBizParticipation;
  const mixMax = h && h.setAsideMix.length ? h.setAsideMix[0].count : 1;
  const awMax = h && h.awardedSetAsideMix.length ? h.awardedSetAsideMix[0].count : 1;

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <a href="/admin/map-funnel" style={{ fontSize: 12, color: '#64748b', textDecoration: 'none', display: 'inline-block', marginBottom: 4 }}>&larr; Market Intelligence (contractor view)</a>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6366f1', fontWeight: 700 }}>Mindy · Buyer mirror · procurement scorecard</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '2px 0 0', color: '#f8fafc', letterSpacing: '-.01em' }}>Competition Health</h1>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, maxWidth: 680 }}>Is this buyer&apos;s market competitive and healthy? The same intelligence platform, a procurement director&apos;s lens. (Admin preview — the gated per-agency buyer entry is Phase 3.)</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={agency} onChange={(e) => setAgency(e.target.value)}
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, cursor: 'pointer' }}>
            {AGENCIES.map((a) => <option key={a} value={a}>{shortAgency(a)}</option>)}
          </select>
          <button onClick={load} disabled={loading} style={{ padding: '7px 14px', fontSize: 13, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>{loading ? '…' : '↻ Refresh'}</button>
        </div>
      </div>

      {loadError && <div style={{ padding: '12px 14px', background: '#7f1d1d22', border: '1px solid #7f1d1d', borderRadius: 10, fontSize: 13, color: '#fca5a5', marginBottom: 16 }}>Couldn&apos;t load: {loadError}</div>}

      {data && h && (
        <>
          {/* TODAY'S PRIORITIES */}
          {data.todaysPriorities.length > 0 && (
            <div style={{ background: 'linear-gradient(160deg,#131b28,#0b1120)', border: '1px solid #2a3547', borderRadius: 14, padding: '18px 20px', marginBottom: 18, boxShadow: '0 18px 44px rgba(0,0,0,.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f5a623', boxShadow: '0 0 10px rgba(245,166,35,.5)' }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>The director&apos;s read — {shortAgency(h.agency)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.todaysPriorities.map((p, i) => <PriorityItem key={i} p={p} />)}
              </div>
            </div>
          )}

          {/* SUPPLIER HEALTH + DIVERSITY */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
            <Card title="Small-business participation" sub="% of active solicitations carrying a set-aside — the number a procurement director is graded on.">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#3ecf8e', fontVariantNumeric: 'tabular-nums' }}>{sb?.pct == null ? '—' : `${sb.pct}%`}</span>
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                <b style={{ color: '#e2e8f0' }}>{sb?.withSetAside.toLocaleString()}</b> of <b style={{ color: '#e2e8f0' }}>{sb?.activeOpps.toLocaleString()}</b> active solicitations carry a set-aside · buying across <b style={{ color: '#e2e8f0' }}>{h.marketCoverage.distinctNaics}</b> NAICS.
              </div>
              {h.setAsideMix.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#64748b', marginBottom: 8 }}>Set-aside mix · open notices</div>
                  {h.setAsideMix.map((m) => <MixRow key={m.label} label={m.label} count={m.count} max={mixMax} color="#6366f1" />)}
                </div>
              )}
            </Card>

            <Card title="Award record · who actually won" sub="Set-aside mix from the recompete/award record (set_aside_enriched) — stronger signal than open notices.">
              {h.awardedSetAsideMix.length === 0 ? (
                <div style={{ padding: '18px 4px', fontSize: 13, color: '#64748b' }}>No enriched award set-aside data for this agency yet.</div>
              ) : (
                <div>
                  {h.awardedSetAsideMix.map((m) => <MixRow key={m.label} label={m.label} count={m.count} max={awMax} color="#3ecf8e" />)}
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 10, paddingTop: 9, borderTop: '1px solid #1e293b' }}>
                    Compare open-notice intent (left) against what was actually awarded — a gap between them is a real competition signal.
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* MARKET COVERAGE */}
          {h.marketCoverage.topNaics.length > 0 && (
            <Card title="Market coverage · where the buying concentrates" sub="Top NAICS by active-solicitation volume — is competition spread, or piled into a few codes?">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {h.marketCoverage.topNaics.map((n, i) => (
                  <div key={n.naics} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < h.marketCoverage.topNaics.length - 1 ? '1px solid #1e293b' : 'none', fontSize: 13 }}>
                    <span style={{ width: 18, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: '#64748b' }}>{i + 1}</span>
                    <span style={{ flex: 1, color: '#cbd5e1', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12.5 }}>{n.naics}</span>
                    <span style={{ width: 90, height: 6, borderRadius: 99, background: '#0f172a', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${(n.opps / h.marketCoverage.topNaics[0].opps) * 100}%`, background: '#6366f1', borderRadius: 99 }} />
                    </span>
                    <span style={{ width: 60, textAlign: 'right', color: '#e2e8f0', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{n.opps} opps</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* COMPETITION DEPTH — the honest "Coming" block (never faked) */}
          <div style={{ background: '#0b1120', border: '1px dashed #334155', borderRadius: 14, padding: '18px 20px', marginTop: 4 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#e8b13a', fontWeight: 700, marginBottom: 4 }}>Competition Depth · Coming</div>
            <div style={{ fontSize: 13.5, color: '#cbd5e1', marginBottom: 12 }}>The marquee buyer metrics — <b>average bidders, single-bid rate, response rate, supplier reach</b> — are deliberately not shown, because we can&apos;t ground them from today&apos;s data. We flag them honestly rather than fabricate:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {h.notYetMeasurable.map((m) => (
                <div key={m.metric} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, fontSize: 12.5, padding: '8px 0', borderTop: '1px solid #1e293b' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.metric}</span>
                  <span style={{ color: '#64748b' }}>{m.needs}</span>
                </div>
              ))}
            </div>
          </div>

          <p style={{ color: '#64748b', fontSize: 12, marginTop: 18 }}>{data.note}</p>
        </>
      )}
    </Shell>
  );
}

// ── components (mirror the Market Intelligence house style) ──
const LEVEL: Record<Priority['level'], { bg: string; border: string; dot: string }> = {
  go: { bg: 'rgba(62,207,142,.10)', border: 'rgba(62,207,142,.24)', dot: '#3ecf8e' },
  watch: { bg: 'rgba(232,177,58,.10)', border: 'rgba(232,177,58,.24)', dot: '#e8b13a' },
  stop: { bg: 'rgba(240,97,109,.10)', border: 'rgba(240,97,109,.26)', dot: '#f0616d' },
};
function PriorityItem({ p }: { p: Priority }) {
  const st = LEVEL[p.level];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 12, alignItems: 'start', padding: '12px 14px', borderRadius: 10, background: st.bg, border: `1px solid ${st.border}` }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', marginTop: 4, justifySelf: 'center', background: st.dot, boxShadow: `0 0 10px ${st.dot}88` }} />
      <div>
        <div style={{ fontSize: 14, fontWeight: 650, color: '#f1f5f9', marginBottom: 2 }}>{p.title}</div>
        <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>{p.body}</div>
        <div style={{ fontSize: 12.5, color: '#7c8899', marginTop: 5 }}><span style={{ color: '#f5a623', fontWeight: 700 }}>&rarr; </span>{p.rec}</div>
      </div>
    </div>
  );
}
function MixRow({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0', fontSize: 13 }}>
      <span style={{ width: 130, color: '#cbd5e1' }}>{label}</span>
      <span style={{ flex: 1, height: 7, borderRadius: 99, background: '#0f172a', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${(count / Math.max(1, max)) * 100}%`, background: color, borderRadius: 99 }} />
      </span>
      <span style={{ width: 44, textAlign: 'right', color: '#e2e8f0', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  );
}
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0b1120', border: '1px solid #1e293b', borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-sans-serif,system-ui,-apple-system,sans-serif', padding: '28px 20px 60px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
