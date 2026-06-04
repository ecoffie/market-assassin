'use client';

/**
 * Government Buyer Market Research — /agency
 *
 * The buyer-side surface (reverse search): a contracting officer finds
 * qualified small businesses for a requirement and gets a defensible,
 * performance-weighted market-depth count (Rule of Two).
 *
 * Gated to gov_buyer users (.gov/.mil). Auth reuses the MI session token
 * (localStorage mi_beta_auth_token, x-mi-auth-token header) like /app.
 * PRD: docs/PRD-gov-buyer-market-research.md §4, §9
 */

import { useState, useEffect, Suspense } from 'react';

const MI_AUTH_TOKEN_KEY = 'mi_beta_auth_token';

type Tier = 'active_performer' | 'capable' | 'emerging' | 'registered_only';

interface ScoredEntity {
  uei: string;
  legalBusinessName: string;
  cageCode: string | null;
  state: string | null;
  certifications: string[];
  primaryNaics: string | null;
  registrationExpiry: string | null;
  totalObligated: number;
  awardCount: number;
  distinctAgencyCount: number;
  lastActionDate: string | null;
  score: number;
  tier: Tier;
}

interface ResearchResult {
  marketDepth: number;
  ruleOfTwoMet: boolean;
  counts: Record<Tier, number>;
  registeredOnlyCount: number;
  businesses: ScoredEntity[];
  dataAsOf: string;
  caveats: string[];
}

const SET_ASIDES = ['', '8(a)', 'HUBZone', 'WOSB', 'SDVOSB', 'VOSB'];
const STATES = ['', 'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const TIER_META: Record<Tier, { label: string; color: string; bg: string }> = {
  active_performer: { label: 'Active Performer', color: '#065f46', bg: '#d1fae5' },
  capable:          { label: 'Capable',          color: '#92400e', bg: '#fef3c7' },
  emerging:         { label: 'Emerging',         color: '#9a3412', bg: '#ffedd5' },
  registered_only:  { label: 'Registered Only',  color: '#475569', bg: '#f1f5f9' },
};

function fmtUSD(n: number): string {
  if (!n) return '$0';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}

function AgencyContent() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Search state
  const [naics, setNaics] = useState('541512');
  const [state, setState] = useState('');
  const [setAside, setSetAside] = useState('');
  const [includeEmerging, setIncludeEmerging] = useState(true);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = localStorage.getItem(MI_AUTH_TOKEN_KEY);
    const e = localStorage.getItem('ma_access_email');
    if (t) setToken(t);
    if (e) setEmail(e);
  }, []);

  // Request a magic link for a .gov/.mil email.
  async function requestAccess() {
    setAuthMsg(''); setAuthLoading(true);
    const e = emailInput.trim().toLowerCase();
    if (!/\.gov$|\.mil$/.test(e)) {
      setAuthMsg('Government access requires a .gov or .mil email address.');
      setAuthLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/mi-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      });
      const data = await res.json();
      if (data?.success) {
        setAuthMsg('Check your email for a secure sign-in link.');
        localStorage.setItem('ma_access_email', e);
        setEmail(e);
      } else {
        setAuthMsg(data?.error || 'Could not send link. Confirm your account is provisioned for government access.');
      }
    } catch {
      setAuthMsg('Network error — please try again.');
    }
    setAuthLoading(false);
  }

  async function runSearch() {
    setError(''); setLoading(true); setResult(null);
    try {
      const params = new URLSearchParams({ email, naics });
      if (state) params.set('state', state);
      if (setAside) params.set('setAside', setAside);
      if (!includeEmerging) params.set('includeEmerging', 'false');
      const res = await fetch(`/api/gov-buyer/market-research?${params}`, {
        headers: token ? { 'x-mi-auth-token': token } : {},
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (res.status === 403) setError('This account is not provisioned for government buyer access.');
        else if (res.status === 401) setError('Your session expired. Please sign in again.');
        else setError(data.error || 'Search failed.');
      } else {
        setResult(data);
      }
    } catch {
      setError('Network error — please try again.');
    }
    setLoading(false);
  }

  // ─────────────────── gate: not signed in ───────────────────
  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#1e3a8a,#1e293b)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ maxWidth: 520, width: '100%' }}>
          <div style={{ fontSize: 13, letterSpacing: 2, opacity: 0.7, marginBottom: 12 }}>GOVERNMENT BUYER ACCESS</div>
          <h1 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, margin: '0 0 16px' }}>
            Market research for federal buyers — who can <em>actually</em> do the work.
          </h1>
          <p style={{ fontSize: 17, opacity: 0.85, lineHeight: 1.5, marginBottom: 28 }}>
            Search registered small businesses by NAICS, location, and set-aside. See who has actually
            won the work. Justify your set-aside with one defensible number.
          </p>
          <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
              Sign in with your .gov / .mil email
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
                placeholder="you@agency.gov"
                style={{ flex: 1, padding: '12px 14px', borderRadius: 8, border: 'none', fontSize: 15 }}
                onKeyDown={e => e.key === 'Enter' && requestAccess()}
              />
              <button onClick={requestAccess} disabled={authLoading}
                style={{ padding: '12px 20px', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                {authLoading ? '…' : 'Get link'}
              </button>
            </div>
            {authMsg && <div style={{ marginTop: 12, fontSize: 14, opacity: 0.9 }}>{authMsg}</div>}
          </div>
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 18 }}>
            .gov / .mil verified access · data sourced from SAM.gov + USASpending · methodology transparent
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────── authed: research surface ───────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', color: '#0f172a' }}>
      <header style={{ background: 'linear-gradient(135deg,#1e3a8a,#7c3aed)', color: '#fff', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 12, letterSpacing: 2, opacity: 0.8 }}>GOVERNMENT BUYER · MARKET RESEARCH</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Find businesses for your requirement</div>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        {/* search bar */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="NAICS code">
            <input value={naics} onChange={e => setNaics(e.target.value)} placeholder="541512"
              style={inputStyle} onKeyDown={e => e.key === 'Enter' && runSearch()} />
          </Field>
          <Field label="State">
            <select value={state} onChange={e => setState(e.target.value)} style={inputStyle}>
              {STATES.map(s => <option key={s} value={s}>{s || 'Any state'}</option>)}
            </select>
          </Field>
          <Field label="Set-aside">
            <select value={setAside} onChange={e => setSetAside(e.target.value)} style={inputStyle}>
              {SET_ASIDES.map(s => <option key={s} value={s}>{s || 'Any'}</option>)}
            </select>
          </Field>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 10 }}>
            <input type="checkbox" checked={includeEmerging} onChange={e => setIncludeEmerging(e.target.checked)} />
            Include emerging firms in count
          </label>
          <button onClick={runSearch} disabled={loading || !naics}
            style={{ padding: '11px 24px', borderRadius: 8, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            {loading ? 'Searching…' : 'Run market research'}
          </button>
        </div>

        {error && <div style={{ marginTop: 16, padding: 14, background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 14 }}>{error}</div>}

        {result && (
          <>
            {/* headline */}
            <div style={{ marginTop: 20, background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 48, fontWeight: 800, color: result.ruleOfTwoMet ? '#065f46' : '#92400e' }}>
                  {result.marketDepth}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    qualified small businesses
                  </div>
                  <div style={{ fontSize: 15, color: result.ruleOfTwoMet ? '#059669' : '#b45309', fontWeight: 600 }}>
                    {result.ruleOfTwoMet ? '✓ Rule of Two met' : '⚠ Rule of Two not met'}
                    {setAside ? ` · ${setAside}` : ''} · NAICS {naics}{state ? ` · ${state}` : ''}
                  </div>
                </div>
              </div>
              {/* tier breakdown */}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                {(Object.keys(TIER_META) as Tier[]).map(t => (
                  <div key={t} style={{ background: TIER_META[t].bg, color: TIER_META[t].color, borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 600 }}>
                    {result.counts[t]} {TIER_META[t].label}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 14 }}>
                Data as of {new Date(result.dataAsOf).toLocaleDateString()}. Registered-Only firms are shown but excluded from the depth count.
              </div>
            </div>

            {/* results table */}
            <div style={{ marginTop: 16, background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>Business</th><th style={th}>State</th><th style={th}>Tier</th>
                    <th style={th}>Score</th><th style={th}>5yr Federal $</th><th style={th}>Awards</th>
                    <th style={th}>Certs</th>
                  </tr>
                </thead>
                <tbody>
                  {result.businesses.slice(0, 100).map(b => (
                    <tr key={b.uei} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td style={td}>
                        <a href={`https://sam.gov/entity/${b.uei}`} target="_blank" rel="noreferrer" style={{ color: '#1e3a8a', fontWeight: 600, textDecoration: 'none' }}>
                          {b.legalBusinessName}
                        </a>
                      </td>
                      <td style={td}>{b.state || '—'}</td>
                      <td style={td}>
                        <span style={{ background: TIER_META[b.tier].bg, color: TIER_META[b.tier].color, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                          {TIER_META[b.tier].label}
                        </span>
                      </td>
                      <td style={td}>{b.score}</td>
                      <td style={td}>{fmtUSD(b.totalObligated)}</td>
                      <td style={td}>{b.awardCount}</td>
                      <td style={td}>{b.certifications.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.businesses.length > 100 && (
                <div style={{ padding: 12, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                  Showing top 100 of {result.businesses.length} by score.
                </div>
              )}
            </div>

            {/* caveats */}
            <div style={{ marginTop: 16, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              {result.caveats.map((c, i) => <div key={i}>• {c}</div>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, minWidth: 120 };
const th: React.CSSProperties = { padding: '10px 14px', fontWeight: 600, fontSize: 13, color: '#475569' };
const td: React.CSSProperties = { padding: '10px 14px' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

export default function AgencyPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>Loading…</div>}>
      <AgencyContent />
    </Suspense>
  );
}
