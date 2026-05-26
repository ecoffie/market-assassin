'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

interface ProposalsPanelProps {
  email: string | null;
  tier: AppTier;
  /** Optional context passed when user navigated here from another
   *  panel. PipelinePanel sets { pursuit_id: 'xyz' } when the user
   *  clicks 'Draft Proposal' on a pursuit card — we then auto-fetch
   *  that pursuit's cached SAM attachments and pre-populate the RFP
   *  upload state so the user can skip the manual download + re-upload. */
  panelContext?: Record<string, unknown>;
}

interface PipelineOpportunity {
  id: string;
  title: string;
  agency?: string;
  notice_id?: string;
  external_url?: string;
  response_deadline?: string;
  naics_code?: string;
  set_aside?: string;
  priority?: string;
  stage?: string;
  notes?: string;
  next_action?: string;
  win_probability?: number;
}

const QUESTION_PROMPTS = [
  'What evaluation factors matter most, and are any more important than price?',
  'Are there incumbent performance issues or delivery risks we should address directly?',
  'Which past performance examples best match the scope, size, and customer environment?',
  'What partners, certifications, or contract vehicles reduce buyer risk?',
  'What assumptions need customer clarification before we commit bid resources?',
];

interface UploadedRfp {
  fileName: string;
  fileSize: number;
  charCount: number;
  pageCount?: number;
  text: string;
}

type ComplianceCategory = 'submission' | 'evaluation' | 'technical' | 'past_performance' | 'pricing' | 'admin' | 'other';
type ComplianceStatus = 'open' | 'in_progress' | 'done' | 'n_a';

interface ComplianceRequirementRow {
  id: string;
  requirement: string;
  category: ComplianceCategory;
  section?: string;
  source_quote?: string;
  owner: string;     // user-editable
  status: ComplianceStatus; // user-editable
}

const CATEGORY_LABELS: Record<ComplianceCategory, { label: string; color: string }> = {
  submission: { label: 'Submission', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  evaluation: { label: 'Evaluation', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  technical: { label: 'Technical', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  past_performance: { label: 'Past Perf', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  pricing: { label: 'Pricing', color: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  admin: { label: 'Admin', color: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  other: { label: 'Other', color: 'bg-slate-700/30 text-slate-400 border-slate-600/40' },
};

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  n_a: 'N/A',
};

type SectionType = 'exec_summary' | 'technical' | 'management' | 'past_performance' | 'pricing';

const SECTION_TABS: Array<{ id: SectionType; label: string; targetWords: number }> = [
  { id: 'exec_summary', label: 'Exec Summary', targetWords: 350 },
  { id: 'technical', label: 'Technical', targetWords: 600 },
  { id: 'management', label: 'Management', targetWords: 450 },
  { id: 'past_performance', label: 'Past Performance', targetWords: 400 },
  { id: 'pricing', label: 'Pricing', targetWords: 300 },
];

interface SectionDraft {
  draft: string;
  wordCount: number;
  targetWords: number;
  generatedAt: number;
  profileGrounded?: boolean;
}

interface ChecklistItemState {
  id: string;
  label: string;
  checked: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItemState[] = [
  { id: 'compliance-coverage', label: 'Every shall / must / required from the solicitation is addressed somewhere in the response.', checked: false },
  { id: 'evaluation-factors', label: 'Each Section M evaluation factor is explicitly addressed in the proposal.', checked: false },
  { id: 'page-limits', label: 'Each volume respects the page, font, and margin limits stated in Section L.', checked: false },
  { id: 'submission-format', label: 'Submission format matches Section L (file types, file names, portal, encryption).', checked: false },
  { id: 'reps-certs', label: 'Required representations, certifications, and small-business size certifications are filled in.', checked: false },
  { id: 'past-performance-filled', label: 'Past performance placeholders ([Contract title], [Agency], [Period], [Value]) have real data filled in.', checked: false },
  { id: 'pricing-filled', label: 'Pricing [TBD]/[INSERT RATE] placeholders are replaced with real numbers and tied to the cost volume.', checked: false },
  { id: 'placeholders-removed', label: 'No [CONFIRM], [TBD], or [Company name] placeholders remain in the body text.', checked: false },
  { id: 'signed-dated', label: 'Cover letter and authorized representative pages are signed and dated.', checked: false },
  { id: 'red-team', label: 'Red team / second-reader review is complete and findings are incorporated.', checked: false },
  { id: 'submission-time', label: 'Submission is ready at least 24 hours before the deadline (portal upload buffer + amendment check).', checked: false },
];

export default function ProposalsPanel({ email, tier, panelContext }: ProposalsPanelProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedRfp, setUploadedRfp] = useState<UploadedRfp | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const handleRfpFile = useCallback(async (file: File) => {
    if (!email) {
      setUploadError('Sign in required.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/app/proposal/upload?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setUploadError(data.error || 'Could not parse the file.');
        return;
      }
      setUploadedRfp({
        fileName: data.file?.name || file.name,
        fileSize: data.file?.size ?? file.size,
        charCount: data.charCount || 0,
        pageCount: data.pageCount,
        text: data.text || '',
      });
    } catch (err) {
      console.error('RFP upload failed:', err);
      setUploadError('Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }, [email, getAuthHeaders]);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleRfpFile(file);
    e.target.value = '';
  }, [handleRfpFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleRfpFile(file);
  }, [handleRfpFile]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const clearRfp = useCallback(() => {
    setUploadedRfp(null);
    setUploadError(null);
    setCompliance([]);
    setComplianceError(null);
    setDrafts({
      exec_summary: undefined,
      technical: undefined,
      management: undefined,
      past_performance: undefined,
      pricing: undefined,
    });
    setDraftError(null);
    setChecklist(DEFAULT_CHECKLIST.map(item => ({ ...item, checked: false })));
    setExportError(null);
  }, []);

  // Compliance matrix
  const [compliance, setCompliance] = useState<ComplianceRequirementRow[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [complianceMeta, setComplianceMeta] = useState<{ truncated?: boolean; originalChars?: number; inputChars?: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ComplianceStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ComplianceCategory>('all');

  const generateCompliance = useCallback(async () => {
    if (!email || !uploadedRfp) return;
    setComplianceLoading(true);
    setComplianceError(null);
    try {
      const res = await fetch(`/api/app/proposal/compliance?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: uploadedRfp.text, fileName: uploadedRfp.fileName }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setComplianceError(data.error || 'Could not generate the matrix.');
        return;
      }
      const rows: ComplianceRequirementRow[] = (data.requirements || []).map((r: Partial<ComplianceRequirementRow> & { id?: string }, idx: number) => ({
        id: r.id || `REQ-${String(idx + 1).padStart(3, '0')}`,
        requirement: r.requirement || '',
        category: (r.category as ComplianceCategory) || 'other',
        section: r.section,
        source_quote: r.source_quote,
        owner: '',
        status: 'open',
      }));
      setCompliance(rows);
      setComplianceMeta(data.meta || null);
    } catch (err) {
      console.error('Compliance generation failed:', err);
      setComplianceError('Request failed. Try again.');
    } finally {
      setComplianceLoading(false);
    }
  }, [email, uploadedRfp, getAuthHeaders]);

  const updateRequirement = useCallback((id: string, patch: Partial<ComplianceRequirementRow>) => {
    setCompliance(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const filteredCompliance = useMemo(() => {
    return compliance.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      return true;
    });
  }, [compliance, statusFilter, categoryFilter]);

  // Section drafts (Step 3)
  const [drafts, setDrafts] = useState<Record<SectionType, SectionDraft | undefined>>({
    exec_summary: undefined,
    technical: undefined,
    management: undefined,
    past_performance: undefined,
    pricing: undefined,
  });
  const [activeSection, setActiveSection] = useState<SectionType>('exec_summary');
  const [draftLoading, setDraftLoading] = useState<SectionType | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const generateDraft = useCallback(async (sectionType: SectionType) => {
    if (!email || !uploadedRfp) return;
    setDraftLoading(sectionType);
    setDraftError(null);
    try {
      const res = await fetch(`/api/app/proposal/draft?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: uploadedRfp.text, fileName: uploadedRfp.fileName, sectionType }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDraftError(data.error || 'Could not generate the draft.');
        return;
      }
      setDrafts(prev => ({
        ...prev,
        [sectionType]: {
          draft: data.draft,
          wordCount: data.wordCount,
          targetWords: data.targetWords,
          profileGrounded: data.meta?.profileGrounded,
          generatedAt: Date.now(),
        },
      }));
      setActiveSection(sectionType);
    } catch (err) {
      console.error('Section draft failed:', err);
      setDraftError('Request failed. Try again.');
    } finally {
      setDraftLoading(null);
    }
  }, [email, uploadedRfp, getAuthHeaders]);

  const updateDraftText = useCallback((sectionType: SectionType, text: string) => {
    setDrafts(prev => {
      const existing = prev[sectionType];
      if (!existing) return prev;
      return {
        ...prev,
        [sectionType]: {
          ...existing,
          draft: text,
          wordCount: text.split(/\s+/).filter(Boolean).length,
        },
      };
    });
  }, []);

  const copyDraftToClipboard = useCallback((sectionType: SectionType) => {
    const d = drafts[sectionType];
    if (!d || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(d.draft).catch(() => {});
  }, [drafts]);

  const downloadDraft = useCallback((sectionType: SectionType) => {
    const d = drafts[sectionType];
    if (!d) return;
    const meta = SECTION_TABS.find(t => t.id === sectionType);
    const label = meta?.label || sectionType;
    const safeName = (uploadedRfp?.fileName || 'proposal').replace(/[^a-z0-9-_.]/gi, '_');
    const blob = new Blob([d.draft], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}-${label.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [drafts, uploadedRfp]);

  // Review checklist (Step 4)
  const [checklist, setChecklist] = useState<ChecklistItemState[]>(DEFAULT_CHECKLIST);
  const checklistChecked = useMemo(() => checklist.filter(c => c.checked).length, [checklist]);
  const toggleChecklistItem = useCallback((id: string) => {
    setChecklist(prev => prev.map(c => (c.id === id ? { ...c, checked: !c.checked } : c)));
  }, []);

  // Final package export
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const hasAnyDraft = useMemo(
    () => SECTION_TABS.some(t => !!drafts[t.id]?.draft),
    [drafts]
  );

  const exportProposalPackage = useCallback(async () => {
    if (!email || !uploadedRfp) return;
    setExporting(true);
    setExportError(null);
    try {
      const draftsForExport: Record<string, { label: string; draft: string; wordCount?: number }> = {};
      for (const tab of SECTION_TABS) {
        const d = drafts[tab.id];
        if (d?.draft) {
          draftsForExport[tab.id] = { label: tab.label, draft: d.draft, wordCount: d.wordCount };
        }
      }

      const res = await fetch(`/api/app/proposal/export?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          fileName: (uploadedRfp.fileName.replace(/\.(pdf|docx|txt)$/i, '') || 'proposal') + '-package',
          rfpFileName: uploadedRfp.fileName,
          compliance: compliance.map(c => ({
            id: c.id,
            requirement: c.requirement,
            category: CATEGORY_LABELS[c.category]?.label || c.category,
            section: c.section,
            owner: c.owner,
            status: STATUS_LABELS[c.status],
            source_quote: c.source_quote,
          })),
          drafts: draftsForExport,
          checklist: checklist.map(c => ({ label: c.label, checked: c.checked })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setExportError(data?.error || 'Export failed. Try again.');
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const fallback = `${uploadedRfp.fileName.replace(/\.(pdf|docx|txt)$/i, '') || 'proposal'}-package-${new Date().toISOString().split('T')[0]}.docx`;
      const fileName = match?.[1] || fallback;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Proposal export failed:', err);
      setExportError('Request failed. Try again.');
    } finally {
      setExporting(false);
    }
  }, [email, uploadedRfp, compliance, drafts, checklist, getAuthHeaders]);

  const exportComplianceCsv = useCallback(() => {
    if (compliance.length === 0) return;
    const headers = ['ID', 'Requirement', 'Category', 'Section', 'Owner', 'Status', 'Source'];
    const rows = compliance.map(r => [
      r.id,
      r.requirement,
      CATEGORY_LABELS[r.category]?.label || r.category,
      r.section || '',
      r.owner,
      STATUS_LABELS[r.status],
      r.source_quote || '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (uploadedRfp?.fileName || 'rfp').replace(/[^a-z0-9-_.]/gi, '_');
    link.download = `compliance-${safeName}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [compliance, uploadedRfp]);

  const selectedOpportunity = useMemo(
    () => opportunities.find(opp => opp.id === selectedId) || opportunities[0] || null,
    [opportunities, selectedId]
  );

  const loadPipeline = useCallback(async () => {
    if (!email || tier === 'free') return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load pursuits');
        return;
      }

      const active = (data.opportunities || []).filter((opp: PipelineOpportunity) => (
        !['won', 'lost', 'archived'].includes(opp.stage || '')
      ));
      setOpportunities(active);
      setSelectedId(current => current || active[0]?.id || '');
    } catch (err) {
      console.error('Failed to load proposal pursuits:', err);
      setError('Failed to load pursuits');
    } finally {
      setLoading(false);
    }
  }, [email, getAuthHeaders, tier]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  // Pursuit Document Pipeline v1 (2026-05-25) — auto-load cached SAM
  // attachments when the user lands here from PipelinePanel's
  // 'Draft Proposal' button. Context shape: { pursuit_id: 'uuid' }.
  // Fetches the first/largest doc from /api/app/proposal/pursuit-docs
  // and pre-populates uploadedRfp state so the user can skip the
  // manual download-from-SAM + re-upload step. They can still upload
  // a different file manually after — this just removes the friction
  // when the cache has what they need.
  const [autoLoadStatus, setAutoLoadStatus] = useState<'idle' | 'loading' | 'loaded' | 'no-docs' | 'error'>('idle');
  const [autoLoadMessage, setAutoLoadMessage] = useState<string | null>(null);
  useEffect(() => {
    const pursuitId = panelContext?.pursuit_id;
    if (!pursuitId || typeof pursuitId !== 'string' || !email) return;

    let cancelled = false;
    setAutoLoadStatus('loading');
    setSelectedId(pursuitId);

    fetch(`/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}`, {
      headers: getAuthHeaders(),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.success) {
          if (!cancelled) {
            setAutoLoadStatus('error');
            setAutoLoadMessage('Could not load pursuit docs');
          }
          return;
        }
        const docs = data.documents || [];
        if (docs.length === 0) {
          // Pursuit has no SAM attachments — explain so user knows to
          // upload manually (or the fetch is still in flight).
          const status = data.pursuit?.docs_status;
          setAutoLoadStatus('no-docs');
          setAutoLoadMessage(
            status === 'fetching'
              ? 'SAM.gov attachments still downloading. Refresh in a moment, or upload manually below.'
              : status === 'none'
                ? 'This SAM notice has no attachments. Upload a draft or related document manually below.'
                : status === 'failed'
                  ? 'SAM attachment download failed. Upload manually below.'
                  : 'No documents cached yet. Upload manually below.'
          );
          return;
        }
        // Use the largest doc as the "main" RFP — typically the SOW
        // or the actual RFP rather than amendments / Q&A which tend
        // to be smaller. User can manually re-upload to pick a
        // different one.
        const primary = docs[0];
        if (primary.extracted_text) {
          setUploadedRfp({
            fileName: primary.filename,
            fileSize: primary.size_bytes || 0,
            charCount: primary.char_count || primary.extracted_text.length,
            pageCount: primary.page_count,
            text: primary.extracted_text,
          });
          setAutoLoadStatus('loaded');
          setAutoLoadMessage(
            docs.length > 1
              ? `Loaded ${primary.filename} (${docs.length} total docs in this pursuit — pick a different one with the upload button below)`
              : `Loaded ${primary.filename} from this pursuit`
          );
        } else if (primary.extraction_error) {
          setAutoLoadStatus('error');
          setAutoLoadMessage(`Could not extract text from ${primary.filename}: ${primary.extraction_error}. Upload manually below.`);
        } else {
          setAutoLoadStatus('no-docs');
          setAutoLoadMessage('Docs found but text not yet extracted. Try again in a moment.');
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[ProposalsPanel] pursuit-docs fetch failed:', err);
        setAutoLoadStatus('error');
        setAutoLoadMessage('Could not load pursuit docs (network error)');
      });

    return () => { cancelled = true; };
  }, [panelContext, email, getAuthHeaders]);

  if (tier === 'free') {
    return (
      <div className="p-6">
        <div className="border border-purple-500/30 bg-purple-950/20 p-8 text-center">
          <div className="text-4xl mb-4">📝</div>
          <h1 className="text-2xl font-bold text-white mb-3">Proposal Assist</h1>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Upgrade to turn saved pursuits into bid/no-bid risks, win themes, compliance prompts, and a first proposal outline.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    );
  }

  const pack = selectedOpportunity ? buildPrepPack(selectedOpportunity) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Proposal Assist</h1>
          <p className="text-slate-400 mt-1">Turn a saved pursuit into the first capture/proposal workspace.</p>
        </div>
        <button
          onClick={loadPipeline}
          disabled={loading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded-lg transition-colors"
        >
          {loading ? 'Refreshing...' : 'Refresh Pursuits'}
        </button>
      </div>

      {/* RFP Upload */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Step 1 · Source Document</p>
            <h2 className="text-lg font-semibold text-white">Upload an RFP / Sources Sought / Solicitation</h2>
            <p className="text-sm text-slate-400 mt-1">
              PDF, DOCX, or TXT, up to 10 MB. Mindy extracts the text so future steps can pull compliance requirements and draft sections.
            </p>
          </div>
        </div>

        {/* Auto-load status banner — appears when user landed here from
            PipelinePanel's 'Draft Proposal' button and a pursuit_id was
            passed via panelContext. Tells them what we did (or didn't do)
            with their pursuit's cached SAM docs. */}
        {autoLoadStatus !== 'idle' && autoLoadMessage && (
          <div className={`mb-4 rounded-lg border p-3 text-sm ${
            autoLoadStatus === 'loaded'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : autoLoadStatus === 'loading'
                ? 'border-blue-500/30 bg-blue-500/10 text-blue-200'
                : autoLoadStatus === 'no-docs'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                  : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}>
            <span className="font-semibold">
              {autoLoadStatus === 'loaded' && '✓ '}
              {autoLoadStatus === 'loading' && '⏳ '}
              {autoLoadStatus === 'no-docs' && 'ⓘ '}
              {autoLoadStatus === 'error' && '✕ '}
            </span>
            {autoLoadStatus === 'loading' ? 'Loading pursuit documents…' : autoLoadMessage}
          </div>
        )}

        {!uploadedRfp ? (
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="border border-dashed border-slate-700 rounded-lg p-8 text-center hover:border-purple-500/60 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={onFileInputChange}
              className="hidden"
            />
            <p className="text-slate-300">
              Drop a file here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-purple-300 hover:text-purple-200 underline disabled:opacity-50"
              >
                browse
              </button>
            </p>
            <p className="text-xs text-slate-500 mt-2">PDF · DOCX · TXT · max 10 MB</p>
            {uploading && (
              <p className="text-xs text-purple-300 mt-3 flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                Extracting text…
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">📄</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{uploadedRfp.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {(uploadedRfp.fileSize / 1024).toFixed(1)} KB · {uploadedRfp.charCount.toLocaleString()} chars
                    {uploadedRfp.pageCount ? ` · ${uploadedRfp.pageCount} page${uploadedRfp.pageCount === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearRfp}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-400 hover:text-red-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>

            <details className="bg-slate-950/40 border border-slate-800 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300 hover:text-white">
                Preview extracted text ({uploadedRfp.text.length.toLocaleString()} chars)
              </summary>
              <pre className="px-3 pb-3 pt-1 text-xs text-slate-400 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                {uploadedRfp.text.slice(0, 5000)}
                {uploadedRfp.text.length > 5000 ? '\n\n…' : ''}
              </pre>
            </details>

            <p className="text-xs text-slate-500">
              Compliance matrix and section drafting coming next — for now this text is held in your session.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={onFileInputChange}
              className="hidden"
            />
          </div>
        )}

        {uploadError && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {uploadError}
          </div>
        )}
      </section>

      {/* Step 2 · Compliance Matrix */}
      {uploadedRfp && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Step 2 · Compliance Matrix</p>
              <h2 className="text-lg font-semibold text-white">Extract every shall / must / required</h2>
              <p className="text-sm text-slate-400 mt-1">
                Mindy reads the source doc and lists each obligation so you can assign owners and track status before drafting.
              </p>
            </div>
            <div className="flex gap-2">
              {compliance.length > 0 && (
                <button
                  type="button"
                  onClick={exportComplianceCsv}
                  className="px-3 py-2 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  Export CSV
                </button>
              )}
              <button
                type="button"
                onClick={generateCompliance}
                disabled={complianceLoading}
                className="px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white transition-colors flex items-center gap-2"
              >
                {complianceLoading && (
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {complianceLoading
                  ? 'Extracting…'
                  : compliance.length > 0
                  ? 'Regenerate'
                  : 'Generate Compliance Matrix'}
              </button>
            </div>
          </div>

          {complianceError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 mb-3">
              {complianceError}
            </div>
          )}

          {complianceMeta?.truncated && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 mb-3">
              Source doc was truncated to {complianceMeta.inputChars?.toLocaleString()} chars of {complianceMeta.originalChars?.toLocaleString()} for this pass. Long documents may miss late-section requirements — split big PDFs by volume if you need full coverage.
            </div>
          )}

          {compliance.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <span className="text-slate-500">{compliance.length} requirements</span>
                <span className="text-slate-700">·</span>
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value as 'all' | ComplianceCategory)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"
                >
                  <option value="all">All categories</option>
                  {(Object.keys(CATEGORY_LABELS) as ComplianceCategory[]).map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c].label}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as 'all' | ComplianceStatus)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"
                >
                  <option value="all">All statuses</option>
                  {(Object.keys(STATUS_LABELS) as ComplianceStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <span className="text-slate-500 ml-auto">
                  Showing {filteredCompliance.length} of {compliance.length}
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-20">ID</th>
                      <th className="text-left px-3 py-2 font-medium">Requirement</th>
                      <th className="text-left px-3 py-2 font-medium w-28">Category</th>
                      <th className="text-left px-3 py-2 font-medium w-24">Section</th>
                      <th className="text-left px-3 py-2 font-medium w-40">Owner</th>
                      <th className="text-left px-3 py-2 font-medium w-32">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompliance.map(r => {
                      const cat = CATEGORY_LABELS[r.category] || CATEGORY_LABELS.other;
                      return (
                        <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/30 align-top">
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.id}</td>
                          <td className="px-3 py-2 text-slate-200">
                            {r.requirement}
                            {r.source_quote && (
                              <details className="mt-1">
                                <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">Source quote</summary>
                                <p className="text-xs text-slate-400 mt-1 italic border-l-2 border-slate-700 pl-2">{r.source_quote}</p>
                              </details>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded border ${cat.color}`}>
                              {cat.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400 font-mono">{r.section || '—'}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={r.owner}
                              onChange={e => updateRequirement(r.id, { owner: e.target.value })}
                              placeholder="Assign…"
                              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={r.status}
                              onChange={e => updateRequirement(r.id, { status: e.target.value as ComplianceStatus })}
                              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
                            >
                              {(Object.keys(STATUS_LABELS) as ComplianceStatus[]).map(s => (
                                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-slate-500 mt-3">
                Owner and status edits live in this session only. CSV export captures the full table.
              </p>
            </>
          )}

          {!complianceLoading && compliance.length === 0 && !complianceError && (
            <p className="text-sm text-slate-500">
              Click <strong className="text-slate-300">Generate Compliance Matrix</strong> to pull every shall / must / required from the uploaded document.
            </p>
          )}
        </section>
      )}

      {/* Step 3 · Draft Sections */}
      {uploadedRfp && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Step 3 · Draft Sections</p>
              <h2 className="text-lg font-semibold text-white">First drafts grounded in the RFP + your profile</h2>
              <p className="text-sm text-slate-400 mt-1">
                Pick a section. Mindy uses the source doc and your saved profile (NAICS, set-asides, target agencies) to write a first pass with [placeholders] for facts it shouldn&apos;t invent.
              </p>
            </div>
          </div>

          {draftError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 mb-3">
              {draftError}
            </div>
          )}

          {/* Section tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 mb-4 -mx-1 px-1">
            {SECTION_TABS.map(tab => {
              const hasDraft = !!drafts[tab.id];
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSection(tab.id)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-purple-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                  {hasDraft && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                </button>
              );
            })}
          </div>

          {/* Active section pane */}
          {(() => {
            const meta = SECTION_TABS.find(t => t.id === activeSection)!;
            const current = drafts[activeSection];
            const isLoading = draftLoading === activeSection;

            return (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="text-xs text-slate-500">
                    Target ≈ {meta.targetWords} words
                    {current && (
                      <>
                        <span className="mx-2 text-slate-700">·</span>
                        <span className={current.wordCount > meta.targetWords * 1.5 ? 'text-amber-400' : 'text-slate-400'}>
                          {current.wordCount} words written
                        </span>
                        {current.profileGrounded === false && (
                          <>
                            <span className="mx-2 text-slate-700">·</span>
                            <span className="text-amber-400">No profile saved — placeholders used</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {current && (
                      <>
                        <button
                          type="button"
                          onClick={() => copyDraftToClipboard(activeSection)}
                          className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadDraft(activeSection)}
                          className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Download .md
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => generateDraft(activeSection)}
                      disabled={isLoading}
                      className="px-4 py-1.5 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white flex items-center gap-2"
                    >
                      {isLoading && (
                        <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      )}
                      {isLoading ? 'Drafting…' : current ? 'Regenerate' : `Draft ${meta.label}`}
                    </button>
                  </div>
                </div>

                {current ? (
                  <textarea
                    value={current.draft}
                    onChange={e => updateDraftText(activeSection, e.target.value)}
                    spellCheck
                    className="w-full min-h-[400px] bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm text-slate-200 font-mono leading-relaxed focus:border-purple-500 focus:outline-none whitespace-pre-wrap"
                  />
                ) : (
                  <div className="bg-slate-950/40 border border-dashed border-slate-700 rounded-lg p-8 text-center text-sm text-slate-400">
                    No draft yet. Click <strong className="text-slate-300">Draft {meta.label}</strong> to generate a first pass.
                  </div>
                )}
              </div>
            );
          })()}

          <p className="text-xs text-slate-500 mt-3">
            Edits live in this session only. Use Step 4 below to bundle the package as a Word doc.
          </p>
        </section>
      )}

      {/* Step 4 · Review Checklist + Export */}
      {uploadedRfp && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Step 4 · Review &amp; Export</p>
              <h2 className="text-lg font-semibold text-white">Final compliance review + Word export</h2>
              <p className="text-sm text-slate-400 mt-1">
                Walk the checklist before you ship. Then export a single .docx containing the compliance matrix, drafted sections, and the checklist appendix.
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-white">{checklistChecked}<span className="text-slate-500 text-base font-normal">/{checklist.length}</span></div>
              <div className="text-xs text-slate-500">items confirmed</div>
            </div>
          </div>

          <ul className="space-y-2 mb-4">
            {checklist.map(item => (
              <li key={item.id}>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleChecklistItem(item.id)}
                    className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-900 accent-purple-500 cursor-pointer"
                  />
                  <span className={`text-sm leading-relaxed ${item.checked ? 'text-slate-500 line-through' : 'text-slate-200 group-hover:text-white'}`}>
                    {item.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-800 pt-4 mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="text-sm text-slate-400">
                <p className="text-slate-300 font-medium mb-1">Package will include:</p>
                <ul className="space-y-0.5 text-xs">
                  <li>• Title page + table of contents</li>
                  <li className={compliance.length > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                    {compliance.length > 0 ? '✓' : '○'} Compliance Matrix ({compliance.length} requirements)
                  </li>
                  {SECTION_TABS.map(tab => {
                    const has = !!drafts[tab.id]?.draft;
                    return (
                      <li key={tab.id} className={has ? 'text-emerald-400' : 'text-slate-600'}>
                        {has ? '✓' : '○'} {tab.label}{has && drafts[tab.id]?.wordCount ? ` (${drafts[tab.id]!.wordCount} words)` : ''}
                      </li>
                    );
                  })}
                  <li className="text-emerald-400">
                    ✓ Review Checklist ({checklistChecked}/{checklist.length} complete)
                  </li>
                </ul>
              </div>
              <button
                type="button"
                onClick={exportProposalPackage}
                disabled={exporting || (!hasAnyDraft && compliance.length === 0)}
                className="px-5 py-2.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium flex items-center gap-2 transition-colors"
              >
                {exporting && (
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {exporting ? 'Assembling…' : 'Export Word (.docx)'}
              </button>
            </div>

            {exportError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 mb-2">
                {exportError}
              </div>
            )}

            {!hasAnyDraft && compliance.length === 0 && !exporting && (
              <p className="text-xs text-slate-500">
                Generate at least the compliance matrix or one section before exporting.
              </p>
            )}
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {error}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Save a pursuit first</h2>
          <p className="text-slate-400">
            Use Today&apos;s Intel, Source Feed, Market Research, or Upcoming Buys to track an opportunity. Then Mindy can build a prep pack from it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
          <aside className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
                Saved Pursuit
              </label>
              <select
                value={selectedOpportunity?.id || ''}
                onChange={(event) => setSelectedId(event.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-purple-500"
              >
                {opportunities.map(opp => (
                  <option key={opp.id} value={opp.id}>{opp.title}</option>
                ))}
              </select>
            </div>

            {selectedOpportunity && (
              <div className="space-y-3 text-sm">
                <Meta label="Agency" value={selectedOpportunity.agency || 'Unknown'} />
                <Meta label="Due" value={formatDate(selectedOpportunity.response_deadline)} />
                <Meta label="NAICS" value={selectedOpportunity.naics_code || '-'} />
                <Meta label="Set-aside" value={selectedOpportunity.set_aside || '-'} />
                <Meta label="Stage" value={selectedOpportunity.stage || 'tracking'} />
              </div>
            )}
          </aside>

          {pack && (
            <main className="space-y-5">
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-purple-300 mb-2">Proposal Prep Pack V1</p>
                    <h2 className="text-xl font-semibold text-white">{pack.title}</h2>
                    <p className="text-slate-400 mt-2">{pack.summary}</p>
                  </div>
                  {selectedOpportunity?.external_url && (
                    <a
                      href={selectedOpportunity.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg"
                    >
                      View Source
                    </a>
                  )}
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <PrepSection title="Bid / No-Bid Risks" items={pack.risks} tone="amber" />
                <PrepSection title="Win Themes" items={pack.winThemes} tone="emerald" />
                <PrepSection title="Compliance Checklist" items={pack.checklist} tone="purple" />
                <PrepSection title="Questions To Ask" items={pack.questions} tone="blue" />
              </div>

              <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="font-semibold text-white mb-3">Draft Outline</h3>
                <ol className="space-y-2">
                  {pack.outline.map(item => (
                    <li key={item} className="text-sm text-slate-300">
                      <span className="text-slate-500 mr-2">-</span>{item}
                    </li>
                  ))}
                </ol>
              </section>
            </main>
          )}
        </div>
      )}
    </div>
  );
}

function buildPrepPack(opp: PipelineOpportunity) {
  const agency = opp.agency || 'the target agency';
  const setAside = opp.set_aside || 'the stated solicitation terms';
  const due = formatDate(opp.response_deadline);
  const naics = opp.naics_code || 'the opportunity NAICS';

  return {
    title: opp.title,
    summary: `${opp.title} is currently in ${opp.stage || 'tracking'} for ${agency}. Use this pack to decide bid fit, prepare customer questions, and start a compliant response outline before deeper proposal drafting.`,
    risks: [
      due !== 'No date set' ? `Deadline pressure: response is due ${due}. Confirm enough time for review, pricing, and signatures.` : 'Deadline is missing. Confirm solicitation timeline before committing resources.',
      `Scope fit: validate that ${naics} matches your strongest past performance and not just your broad capability set.`,
      `Competitive posture: identify incumbent, known primes, or likely low-price competitors before spending proposal hours.`,
      `Set-aside fit: confirm ${setAside} requirements and required certifications.`,
    ],
    winThemes: [
      `Lower buyer risk for ${agency} by tying your approach to measurable delivery outcomes.`,
      'Use relevant past performance first, then technical approach, then price story.',
      'Show how your team can start fast without adding contract administration burden.',
      opp.win_probability ? `Anchor the capture story around the ${opp.win_probability}% current win probability drivers.` : 'Document the top three reasons you should win before drafting.',
    ],
    checklist: [
      'Confirm solicitation number, due date, submission portal, and amendment status.',
      'List every required volume, attachment, certification, representation, and signature.',
      'Map each evaluation factor to an owner and evidence source.',
      'Create a compliance matrix before writing narrative sections.',
      'Schedule red-team review before final pricing and submission.',
    ],
    questions: QUESTION_PROMPTS,
    outline: [
      'Executive summary and understanding of the agency mission',
      'Technical approach mapped to each requirement',
      'Management plan, staffing, and quality controls',
      'Relevant past performance and proof points',
      'Risk mitigation and transition/startup plan',
      'Price/value narrative and required attachments',
    ],
  };
}

function PrepSection({ title, items, tone }: { title: string; items: string[]; tone: 'amber' | 'emerald' | 'purple' | 'blue' }) {
  const colors = {
    amber: 'border-amber-500/30 text-amber-300',
    emerald: 'border-emerald-500/30 text-emerald-300',
    purple: 'border-purple-500/30 text-purple-300',
    blue: 'border-blue-500/30 text-blue-300',
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className={`font-semibold mb-3 ${colors[tone]}`}>{title}</h3>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item} className="text-sm leading-relaxed text-slate-300">
            <span className="text-slate-500 mr-2">-</span>{item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-200 mt-1">{value}</div>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return 'No date set';
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}
