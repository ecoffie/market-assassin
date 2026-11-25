'use client';

/**
 * /admin/new-contractors — download businesses that are NEW to SAM.gov as a spreadsheet.
 * Data: GET /api/admin/new-sam-registrants (admin password). No emails: SAM's public data has none.
 */
import { useCallback, useEffect, useState } from 'react';

function ymd(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default function NewContractorsAdmin() {
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const today = ymd(new Date());
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(today);
  const [count, setCount] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem('adminPassword'); } catch { /* storage blocked */ }
    if (stored) { setPassword(stored); setAuthed(true); }
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const r = await fetch('/api/admin/verify-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwInput }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.valid || d.success) {
      try { sessionStorage.setItem('adminPassword', pwInput); } catch { /* storage blocked */ }
      setPassword(pwInput); setAuthed(true);
    } else setAuthError('Invalid admin password');
  };

  const qs = useCallback(
    (extra = '') => `/api/admin/new-sam-registrants?password=${encodeURIComponent(password)}&from=${from}&to=${to}${extra}`,
    [password, from, to],
  );

  const preview = useCallback(async () => {
    setBusy(true); setStatus(''); setCount(null);
    try {
      const r = await fetch(qs('&format=json'));
      const d = await r.json();
      if (r.status === 401) { setAuthed(false); try { sessionStorage.removeItem('adminPassword'); } catch { /* */ } return; }
      if (!d.success) { setStatus(d.message || 'Could not load the list'); return; }
      setCount(d.data.count);
    } catch {
      setStatus('Could not load the list');
    } finally { setBusy(false); }
  }, [qs]);

  useEffect(() => { if (authed) void preview(); }, [authed, preview]);

  const box: React.CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };

  if (!authed) {
    return (
      <main style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'system-ui, sans-serif' }}>
        <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>New contractors — admin</h1>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} placeholder="Admin password" autoFocus style={box} />
          <button type="submit" style={{ ...box, background: '#1B3A6B', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>Enter</button>
          {authError && <p style={{ color: '#b91c1c', fontSize: 13 }}>{authError}</p>}
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>New contractors on SAM.gov</h1>
      <p style={{ color: '#475569', fontSize: 14, marginTop: 6 }}>
        Businesses whose first SAM.gov registration falls in the dates below. Grants-only registrants are left out
        (they can&apos;t win contracts). SAM.gov&apos;s public data has no emails, so the spreadsheet has none.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 20 }}>
        <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={box} />
        </label>
        <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          To<input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} style={box} />
        </label>
        <button onClick={preview} disabled={busy} style={{ ...box, background: '#fff', cursor: 'pointer' }}>
          {busy ? 'Counting…' : 'Count'}
        </button>
        <a href={qs()} download style={{ ...box, background: '#1B3A6B', color: '#fff', border: 'none', fontWeight: 700, textDecoration: 'none' }}>
          Download spreadsheet (CSV)
        </a>
      </div>

      <p style={{ marginTop: 16, fontSize: 15 }}>
        {status
          ? <span style={{ color: '#b91c1c' }}>{status}</span>
          : count === null
            ? (busy ? 'Counting…' : '')
            : <><strong>{count.toLocaleString()}</strong> new contractors from {from} to {to}.</>}
      </p>
      <p style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>Max 92 days per download.</p>
    </main>
  );
}
