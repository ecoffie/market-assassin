'use client';
import { useState, useEffect, useCallback } from 'react';
import { getMIApiHeaders } from '../authHeaders';

/**
 * Doc Manifest — every attachment on a pursuit, CLASSIFIED + grouped by type, so
 * the user can separate + hand the right file to the right person (Eric: a
 * combined synopsis can have 10+ docs; send the SOW + pricing schedule to subs).
 * Each doc has a download. Groups: SOW/PWS, Pricing, Wage Det, Q&A, Amendments,
 * Instructions (L), Eval (M), Solicitation, PPQ, Reps&Certs, Other.
 */
interface PursuitDoc {
  id: string;
  filename: string;
  doc_kind?: string | null;
  doc_kind_confidence?: string | null;
  size_bytes?: number | null;
  page_count?: number | null;
}

const KIND_LABEL: Record<string, string> = {
  sow_pws: 'Statement of Work / PWS', pricing: 'Pricing Schedule', wage_det: 'Wage Determination',
  qa: 'Questions & Answers', amendment: 'Amendments', instructions: 'Instructions (Section L)',
  eval_factors: 'Evaluation Factors (Section M)', solicitation: 'Solicitation / RFP',
  past_perf_form: 'Past Performance Questionnaire', rep_certs: 'Reps & Certs', attachment_other: 'Other Attachments',
};
const KIND_HINT: Record<string, string> = {
  sow_pws: 'Send to subs + estimators', pricing: 'Send to subs + pricing lead',
  wage_det: 'Send to estimators', past_perf_form: 'For your past-performance lead',
  rep_certs: 'For contracts/admin', qa: 'Read for clarifications',
};
const KIND_ICON: Record<string, string> = {
  sow_pws: '📋', pricing: '💲', wage_det: '⚖️', qa: '❓', amendment: '📝',
  instructions: '📑', eval_factors: '🎯', solicitation: '📄', past_perf_form: '🏅', rep_certs: '✅', attachment_other: '📎',
};
// Display order — most actionable first.
const ORDER = ['sow_pws', 'instructions', 'eval_factors', 'pricing', 'wage_det', 'qa', 'amendment', 'solicitation', 'past_perf_form', 'rep_certs', 'attachment_other'];

function fmtSize(b?: number | null) { if (!b) return ''; return b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.round(b / 1e3)}KB`; }

export default function DocManifest({ email, pursuitId }: { email: string | null; pursuitId: string }) {
  const [docs, setDocs] = useState<PursuitDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = useCallback(() => getMIApiHeaders(email), [email]);

  useEffect(() => {
    if (!email || !pursuitId) return;
    setLoading(true);
    fetch(`/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}`, { headers: headers() })
      .then(r => r.json())
      .then(d => { if (d.success) setDocs(d.documents || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [email, pursuitId, headers]);

  const download = async (docId: string) => {
    try {
      const res = await fetch(`/api/app/proposal/doc-download?email=${encodeURIComponent(email || '')}&doc_id=${docId}`, { headers: headers() });
      const d = await res.json();
      if (d.url) window.open(d.url, '_blank');
    } catch { /* */ }
  };

  if (loading) return <div className="text-xs text-slate-500">Loading document manifest…</div>;
  if (docs.length === 0) return null;

  // Group by kind.
  const groups: Record<string, PursuitDoc[]> = {};
  for (const d of docs) (groups[d.doc_kind || 'attachment_other'] ||= []).push(d);
  const orderedKinds = ORDER.filter(k => groups[k]?.length);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">📂 All documents ({docs.length}) — sorted by type</h3>
        <span className="text-[11px] text-slate-500">Hand the right file to the right person</span>
      </div>
      <div className="space-y-3">
        {orderedKinds.map(kind => (
          <div key={kind}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{KIND_ICON[kind] || '📎'}</span>
              <span className="text-xs font-semibold text-slate-300">{KIND_LABEL[kind] || kind}</span>
              <span className="text-[10px] text-slate-600">({groups[kind].length})</span>
              {KIND_HINT[kind] && <span className="text-[10px] text-emerald-400/80">· {KIND_HINT[kind]}</span>}
            </div>
            <div className="space-y-1 pl-6">
              {groups[kind].map(d => (
                <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-slate-400" title={d.filename}>
                    {d.filename}
                    {d.doc_kind_confidence === 'low' && <span className="ml-1 text-amber-500/70" title="Low-confidence classification — verify">?</span>}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-600">{fmtSize(d.size_bytes)}{d.page_count ? ` · ${d.page_count}p` : ''}</span>
                    <button onClick={() => download(d.id)} className="text-purple-400 hover:text-purple-300">⬇ Download</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
