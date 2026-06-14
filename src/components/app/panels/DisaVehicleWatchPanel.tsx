'use client';

/**
 * DISA Vehicle Expiry Watch — dashboard.
 *
 * Replaces DISA's manual IDIQ/IDV spreadsheet tracking: upload the spreadsheet →
 * the system watches every expiry → previews the exact notice that WOULD go to
 * each incumbent at 6mo/90d/30d. Live sending is dry-run-gated (no real vendor
 * emailed until DISA approves). Demo-first. (DISA-VEHICLE-WATCH-SPEC.md)
 */
import { useState, useEffect, useCallback } from 'react';
import { getMIApiHeaders } from '../authHeaders';

interface Props { email: string }

interface Vehicle {
  id: string;
  vehicle_piid: string;
  vehicle_title?: string | null;
  incumbent_name?: string | null;
  incumbent_email?: string | null;
  expiration_date?: string | null;
  ceiling_value?: number | null;
  naics?: string | null;
  daysUntilExpiration: number | null;
  stage: '6mo' | '90d' | '30d' | null;
  last_notified_stage?: string | null;
}

interface Summary {
  total: number; expiringIn6mo: number; expiringIn90d: number; expiringIn30d: number;
  expired: number; missingEmail: number; notified: number;
}

interface Notice {
  vehicle_id: string; vehicle_piid: string; incumbent_name?: string | null;
  stage: string; to: string | null; hasEmail: boolean; subject: string; body: string;
}

const STAGE_BADGE: Record<string, string> = {
  '30d': 'bg-red-500/20 text-red-300',
  '90d': 'bg-amber-500/20 text-amber-300',
  '6mo': 'bg-blue-500/20 text-blue-300',
};
const STAGE_LABEL: Record<string, string> = { '30d': '≤30 days', '90d': '≤90 days', '6mo': '≤6 months' };

export default function DisaVehicleWatchPanel({ email }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/app/disa/vehicles?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load');
      setVehicles(data.vehicles || []);
      setSummary(data.summary || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vehicles');
    } finally { setLoading(false); }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  const onFile = useCallback(async (file: File) => {
    setUploading(true); setUploadMsg(null); setError(null);
    try {
      const csv = await file.text();
      const res = await fetch(`/api/app/disa/vehicles?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getMIApiHeaders(email) },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Upload failed');
      setUploadMsg(`Imported ${data.imported} vehicles · ${data.withIncumbentEmail} with incumbent email · ${data.withExpirationDate} with expiry date.${data.note ? ' ' + data.note : ''}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setUploading(false); }
  }, [email, load]);

  const runPreview = useCallback(async () => {
    setPreviewLoading(true); setError(null);
    try {
      const res = await fetch(`/api/app/disa/preview-notices?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Preview failed');
      setNotices(data.notices || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally { setPreviewLoading(false); }
  }, [email]);

  const removeVehicle = useCallback(async (id: string) => {
    await fetch(`/api/app/disa/vehicles?email=${encodeURIComponent(email)}&id=${id}`, { method: 'DELETE', headers: getMIApiHeaders(email) });
    await load();
  }, [email, load]);

  // Download a single incumbent notice as .docx (the leave-behind). The route is
  // auth-gated, so fetch with headers + trigger the download from the blob.
  const downloadNotice = useCallback(async (vehicleId: string, piid: string) => {
    try {
      const res = await fetch(`/api/app/disa/notice-docx?email=${encodeURIComponent(email)}&id=${vehicleId}`, { headers: getMIApiHeaders(email) });
      if (!res.ok) throw new Error('Could not generate notice');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expiry-notice-${piid.replace(/[^a-z0-9-_.]/gi, '_')}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Notice download failed');
    }
  }, [email]);

  const fmtDays = (d: number | null) => d === null ? '—' : d < 0 ? `expired ${-d}d ago` : `${d} days`;
  const fmtVal = (v?: number | null) => v ? `$${(v / 1_000_000).toFixed(1)}M` : '—';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Vehicle Expiry Watch</h1>
        <p className="text-sm text-slate-400 mt-1">
          Upload your IDIQ/IDV vehicle list once. The system watches every expiration date and
          prepares the incumbent notice automatically — no more manual spreadsheet tracking.
          <span className="ml-1 text-amber-300">Notices are preview-only (dry run) until you approve sending.</span>
        </p>
      </div>

      {/* Summary cards — the screenshot moment */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card n={summary.total} label="Vehicles watched" sub="auto-tracked, was a spreadsheet" color="text-white" />
          <Card n={summary.expiringIn6mo} label="Expiring ≤ 6 months" sub={`${summary.expiringIn30d} within 30 days`} color="text-amber-400" />
          <Card n={summary.notified} label="Incumbents notified" sub="this cycle" color="text-emerald-400" />
          <Card n={summary.missingEmail} label="Missing incumbent email" sub="add to enable notice" color="text-red-400" />
        </div>
      )}

      {/* Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Import your vehicle spreadsheet</h3>
        <p className="text-xs text-slate-500 mb-3">
          CSV with columns for PIID/contract #, incumbent, incumbent email, and expiration date
          (extra columns ignored; we auto-map common header names).
        </p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg cursor-pointer transition-colors">
          {uploading ? 'Importing…' : 'Upload CSV'}
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
        </label>
        {uploadMsg && <p className="mt-3 text-sm text-emerald-300">{uploadMsg}</p>}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>}

      {/* Dry-run preview action */}
      {vehicles.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-white">Preview notices that would send today</h3>
            <p className="text-xs text-slate-500 mt-1">Dry run — shows the exact email per due incumbent. Nothing is sent.</p>
          </div>
          <button onClick={runPreview} disabled={previewLoading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors">
            {previewLoading ? 'Checking…' : 'Preview notices'}
          </button>
        </div>
      )}

      {/* Preview results */}
      {notices && (
        <div className="bg-slate-900 border border-purple-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-300">DRY RUN</span>
            <span className="text-sm text-slate-300">
              {notices.filter(n => n.hasEmail).length} notice{notices.filter(n => n.hasEmail).length === 1 ? '' : 's'} would send
              {notices.some(n => !n.hasEmail) && ` · ${notices.filter(n => !n.hasEmail).length} blocked (no incumbent email)`}
            </span>
          </div>
          {notices.length === 0 && <p className="text-sm text-slate-500">No vehicles are due for a notice right now.</p>}
          {notices.map(n => (
            <div key={n.vehicle_id} className="rounded-lg border border-slate-700 bg-slate-950/50 p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STAGE_BADGE[n.stage] || 'bg-slate-700 text-slate-300'}`}>{STAGE_LABEL[n.stage] || n.stage}</span>
                <span className="text-sm font-medium text-white">{n.vehicle_piid}</span>
                <span className="text-xs text-slate-500">→ {n.to || '⚠ no email on file'}</span>
              </div>
              <p className="text-xs text-slate-400 mb-1"><span className="text-slate-500">Subject:</span> {n.subject}</p>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans bg-slate-900/60 rounded p-3 mt-1">{n.body}</pre>
              <button
                onClick={() => downloadNotice(n.vehicle_id, n.vehicle_piid)}
                className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
              >
                ⬇ Download notice (.docx)
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Watched vehicles table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            {loading ? 'Loading…' : `${vehicles.length} Watched Vehicles`}
          </h3>
        </div>
        {!loading && vehicles.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">No vehicles yet — upload your spreadsheet above to start.</div>
        )}
        <div className="divide-y divide-slate-800">
          {vehicles.map(v => (
            <div key={v.id} className="p-4 flex items-start justify-between gap-4 hover:bg-slate-800/40">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {v.stage && <span className={`px-2 py-0.5 rounded text-xs font-medium ${STAGE_BADGE[v.stage]}`}>{STAGE_LABEL[v.stage]}</span>}
                  <span className="text-sm font-medium text-white truncate">{v.vehicle_piid}</span>
                  {v.naics && <span className="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">NAICS {v.naics}</span>}
                  {v.last_notified_stage && <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-300">notified {v.last_notified_stage}</span>}
                </div>
                {v.vehicle_title && <p className="text-xs text-slate-400 truncate">{v.vehicle_title}</p>}
                <p className="text-xs text-slate-500 mt-1">
                  Incumbent: {v.incumbent_name || '—'}
                  {v.incumbent_email ? <span className="text-slate-400"> · {v.incumbent_email}</span> : <span className="text-red-400"> · no email</span>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm text-white">{v.expiration_date || '—'}</div>
                <div className={`text-xs ${v.daysUntilExpiration !== null && v.daysUntilExpiration <= 90 ? 'text-amber-400' : 'text-slate-500'}`}>{fmtDays(v.daysUntilExpiration)}</div>
                <div className="text-xs text-slate-500">{fmtVal(v.ceiling_value)}</div>
                <div className="flex items-center gap-3 justify-end mt-1">
                  <button onClick={() => downloadNotice(v.id, v.vehicle_piid)} className="text-[11px] text-slate-500 hover:text-amber-300">notice .docx</button>
                  <button onClick={() => removeVehicle(v.id)} className="text-[11px] text-slate-600 hover:text-red-400">remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Card({ n, label, sub, color }: { n: number; label: string; sub: string; color: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className={`text-2xl font-bold ${color}`}>{n.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-[11px] text-slate-600 mt-1">{sub}</div>
    </div>
  );
}
