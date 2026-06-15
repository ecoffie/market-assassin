'use client';

/**
 * Navy OSBP — SMB Market Research.
 *
 * Find small/minority businesses by NAICS + socioeconomic certification
 * (8a/SDVOSB/WOSB/HUBZone) + state, from the authoritative SAM entity registry.
 * Clean, exportable list — the OSBP sourcing workflow, automated.
 * (GOVT-GTM-STRATEGY Track 1 — Navy OSBP prototype.)
 */
import { useState, useCallback } from 'react';
import { getMIApiHeaders } from '../authHeaders';

interface Props { email: string }

interface SmbRow {
  uei: string; cage: string; name: string; dba: string;
  city: string; state: string; certs: string[]; primaryNaics: string;
  registrationStatus: string; contactName: string; contactEmail: string; contactPhone: string;
}

const CERTS = ['8a', 'SDVOSB', 'WOSB', 'HUBZone'] as const;
const CERT_LABEL: Record<string, string> = { '8a': '8(a)', SDVOSB: 'SDVOSB', WOSB: 'WOSB', HUBZone: 'HUBZone' };
const CERT_BADGE: Record<string, string> = {
  '8(a)': 'bg-purple-500/20 text-purple-300',
  SDVOSB: 'bg-blue-500/20 text-blue-300',
  WOSB: 'bg-pink-500/20 text-pink-300',
  HUBZone: 'bg-emerald-500/20 text-emerald-300',
};

export default function OsbpSmbResearchPanel({ email }: Props) {
  const [naics, setNaics] = useState('');
  const [state, setState] = useState('');
  const [selectedCerts, setSelectedCerts] = useState<string[]>([]);
  const [rows, setRows] = useState<SmbRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [capped, setCapped] = useState(false);

  const toggleCert = (c: string) =>
    setSelectedCerts(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const search = useCallback(async () => {
    if (!naics.trim() && !state.trim() && selectedCerts.length === 0) {
      setError('Enter a NAICS code, a state, or pick a certification.');
      return;
    }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ email });
      if (naics.trim()) params.set('naics', naics.trim());
      if (state.trim()) params.set('state', state.trim());
      if (selectedCerts.length) params.set('certs', selectedCerts.join(','));
      const res = await fetch(`/api/app/osbp/smb-search?${params.toString()}`, { headers: getMIApiHeaders(email) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Search failed');
      setRows(data.results || []);
      setNotes(data.notes || []);
      setCapped(!!data.samCapped);
      setLastQuery([
        naics && `NAICS ${naics}`,
        selectedCerts.length ? selectedCerts.map(c => CERT_LABEL[c]).join('/') : null,
        state && state.toUpperCase(),
      ].filter(Boolean).join(' · '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally { setLoading(false); }
  }, [email, naics, state, selectedCerts]);

  const exportCsv = useCallback(() => {
    if (!rows || !rows.length) return;
    const headers = ['Company', 'DBA', 'UEI', 'CAGE', 'City', 'State', 'Certifications', 'Primary NAICS', 'SAM Status', 'Contact', 'Email', 'Phone'];
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([r.name, r.dba, r.uei, r.cage, r.city, r.state, r.certs.join('; '), r.primaryNaics, r.registrationStatus, r.contactName, r.contactEmail, r.contactPhone].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `smb-market-research-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Small Business Market Research</h1>
        <p className="text-sm text-slate-400 mt-1">
          Find certified small &amp; minority businesses by NAICS, socioeconomic certification, and state —
          from the live SAM.gov entity registry. Export the list for your market-research file.
        </p>
      </div>

      {/* Search form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">NAICS Code</label>
            <input value={naics} onChange={e => setNaics(e.target.value)} placeholder="541512"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">State</label>
            <input value={state} onChange={e => setState(e.target.value)} placeholder="VA" maxLength={2}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-blue-500 focus:outline-none uppercase" />
          </div>
          <div className="flex items-end">
            <button onClick={search} disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-medium rounded-lg transition-colors">
              {loading ? 'Searching SAM.gov…' : 'Search'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-2">Socioeconomic Certification (pick any)</label>
          <div className="flex flex-wrap gap-2">
            {CERTS.map(c => (
              <button key={c} onClick={() => toggleCert(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${selectedCerts.includes(c)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'}`}>
                {CERT_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>}

      {/* Honesty banners — these keep the prototype credible in front of a gov user */}
      {rows && (notes.length > 0 || capped) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200 space-y-1">
          {capped && <p>Showing up to 10 results per query (SAM.gov entity search page limit). Narrow by NAICS + state for the most relevant matches.</p>}
          {notes.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      )}

      {/* Results */}
      {rows && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              {rows.length} Certified Businesses{lastQuery ? ` · ${lastQuery}` : ''}
            </h3>
            {rows.length > 0 && (
              <button onClick={exportCsv}
                className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm rounded-lg transition-colors">
                ⬇ Export CSV
              </button>
            )}
          </div>
          {rows.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">No matching registered businesses. Try a broader NAICS prefix or fewer filters.</div>
          )}
          <div className="divide-y divide-slate-800">
            {rows.map(r => (
              <div key={r.uei} className="p-4 hover:bg-slate-800/40">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{r.name}</span>
                      {r.certs.map(c => (
                        <span key={c} className={`px-2 py-0.5 rounded text-xs font-medium ${CERT_BADGE[c] || 'bg-slate-700 text-slate-300'}`}>{c}</span>
                      ))}
                      {r.registrationStatus !== 'Active' && (
                        <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-300">{r.registrationStatus}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {[r.city, r.state].filter(Boolean).join(', ') || '—'}
                      {r.primaryNaics && <span> · NAICS {r.primaryNaics}</span>}
                      <span> · UEI {r.uei}</span>{r.cage && <span> · CAGE {r.cage}</span>}
                    </p>
                    {(r.contactName || r.contactEmail) && (
                      <p className="text-xs text-slate-400 mt-1">
                        {r.contactName}{r.contactEmail && <span className="text-slate-500"> · {r.contactEmail}</span>}{r.contactPhone && <span className="text-slate-500"> · {r.contactPhone}</span>}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!rows && !loading && (
        <p className="text-sm text-slate-500">Enter a NAICS code and pick a certification to find capable small businesses.</p>
      )}
    </div>
  );
}
