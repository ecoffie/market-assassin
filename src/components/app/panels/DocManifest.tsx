'use client';
import { useState, useEffect } from 'react';
import { ClipboardList, DollarSign, Scale, HelpCircle, PenLine, FileStack, Target, FileText, Award, CheckCircle2, Paperclip, FolderOpen, Download, AlertTriangle, type LucideIcon } from 'lucide-react';
import { authedFetch } from '../authHeaders';

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
  extracted_text?: string | null;
  extraction_error?: string | null;
  sam_url?: string | null;
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
const KIND_ICON: Record<string, LucideIcon> = {
  sow_pws: ClipboardList, pricing: DollarSign, wage_det: Scale, qa: HelpCircle, amendment: PenLine,
  instructions: FileStack, eval_factors: Target, solicitation: FileText, past_perf_form: Award, rep_certs: CheckCircle2, attachment_other: Paperclip,
};
// Display order — most actionable first.
const ORDER = ['sow_pws', 'instructions', 'eval_factors', 'pricing', 'wage_det', 'qa', 'amendment', 'solicitation', 'past_perf_form', 'rep_certs', 'attachment_other'];

function fmtSize(b?: number | null) { if (!b) return ''; return b > 1e6 ? `${(b / 1e6).toFixed(1)}MB` : `${Math.round(b / 1e3)}KB`; }

export default function DocManifest({ email, pursuitId }: { email: string | null; pursuitId: string }) {
  const [docs, setDocs] = useState<PursuitDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email || !pursuitId) return;
    setLoading(true);
    authedFetch(`/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}`, email)
      .then(r => r.json())
      .then(d => { if (d.success) setDocs(d.documents || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [email, pursuitId]);

  const download = async (docId: string) => {
    try {
      const res = await authedFetch(`/api/app/proposal/doc-download?email=${encodeURIComponent(email || '')}&doc_id=${docId}`, email);
      const d = await res.json();
      if (d.url) window.open(d.url, '_blank');
    } catch { /* */ }
  };

  if (loading) return <div className="text-xs text-slate-500">Loading document manifest…</div>;
  if (docs.length === 0) return null;

  // Split readable vs couldn't-read (Eric QC: a 32MB drawings PDF + .xlsx pricing
  // were silently dropped). Surface the skipped ones with a SAM.gov link so the
  // user knows they exist and can grab them manually.
  const readable = docs.filter(d => d.extracted_text);
  const skipped = docs.filter(d => !d.extracted_text);

  // Group readable by kind.
  const groups: Record<string, PursuitDoc[]> = {};
  for (const d of readable) (groups[d.doc_kind || 'attachment_other'] ||= []).push(d);
  const orderedKinds = ORDER.filter(k => groups[k]?.length);

  const skipReason = (d: PursuitDoc) => {
    if (/unsupported/i.test(d.extraction_error || '')) return 'unsupported type (.xlsx/.zip)';
    if ((d.size_bytes || 0) > 20e6) return 'too large to fetch';
    return d.extraction_error || 'not readable';
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-white"><FolderOpen className="h-4 w-4 shrink-0" strokeWidth={2} /> Documents — {readable.length} readable{skipped.length ? ` · ${skipped.length} need manual download` : ''}</h3>
        <span className="text-[11px] text-slate-500">Hand the right file to the right person</span>
      </div>
      <div className="space-y-3">
        {orderedKinds.map(kind => (
          <div key={kind}>
            <div className="flex items-center gap-2 mb-1">
              {(() => { const Icon = KIND_ICON[kind] || Paperclip; return <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />; })()}
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
                    <button onClick={() => download(d.id)} className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300"><Download className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Download</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Couldn't-read docs — surfaced honestly with a SAM.gov link so the user
          knows they exist and can grab them manually (Eric QC). */}
      {skipped.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />
            <span className="text-xs font-semibold text-amber-300/90">Not auto-loaded ({skipped.length}) — download from SAM.gov</span>
          </div>
          <div className="space-y-1 pl-6">
            {skipped.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-400" title={d.filename}>
                  {d.filename}
                  <span className="ml-1 text-amber-500/60">· {skipReason(d)}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-600">{fmtSize(d.size_bytes)}</span>
                  {d.sam_url
                    ? <a href={d.sam_url} target="_blank" rel="noreferrer" className="text-purple-400 hover:text-purple-300">↗ SAM.gov</a>
                    : <button onClick={() => download(d.id)} className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300"><Download className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Try</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
