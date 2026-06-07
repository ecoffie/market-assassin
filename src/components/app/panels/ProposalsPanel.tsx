'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { classifyNoticeType, noticeTypeLabel, noticeTypeToDetected } from '@/lib/utils/notice-type';
import type { LoiFields } from '@/lib/proposal/loi-fields';
import { loiFieldsHaveContent } from '@/lib/proposal/loi-fields';
import { formatDodaacOffice } from '@/lib/gov-contacts/dodaac';
import ProposalChat from './ProposalChat';
import DocManifest from './DocManifest';
import { alignRequirement, priorityOf, type ReqPriority } from '@/lib/proposal/section-alignment';

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
  notice_type?: string | null;
}

function isTerminalPipelineStage(stage?: string | null): boolean {
  return ['won', 'lost', 'no_bid', 'archived'].includes(stage || '');
}

// Notice-type classification (label + respondability) lives in a shared util so
// PipelinePanel, the picker, and the workbench agree. See classifyNoticeType.

function isMissingPursuitError(error?: string | null): boolean {
  return (error || '').toLowerCase().includes('pursuit not found');
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
  source_doc?: string;  // which doc (e.g. "Amendment 0004")
  revised?: boolean;    // changed by an amendment
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

type SectionType =
  // RFP / Proposal sections
  | 'exec_summary' | 'technical' | 'management' | 'past_performance' | 'pricing'
  // LOI / market-research response sections (SS / RFI responses)
  | 'company_overview' | 'cap_past_performance' | 'capabilities' | 'differentiators' | 'poc';

const RFP_SECTION_TABS: Array<{ id: SectionType; label: string; targetWords: number }> = [
  { id: 'exec_summary', label: 'Exec Summary', targetWords: 350 },
  { id: 'technical', label: 'Technical', targetWords: 600 },
  { id: 'management', label: 'Management', targetWords: 450 },
  { id: 'past_performance', label: 'Past Performance', targetWords: 400 },
  { id: 'pricing', label: 'Pricing', targetWords: 300 },
];

// Short label for a section type (for the compliance-matrix "Drafted in" column).
function sectionLabel(s: SectionType): string {
  return RFP_SECTION_TABS.find(t => t.id === s)?.label
    || s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// LOI / market-research response tabs surface when detectedNoticeType ===
// 'sources_sought' or 'rfi'. Users attach their existing capability statement;
// Mindy drafts the cover/LOI response around the notice.
const LOI_RESPONSE_SECTION_TABS: Array<{ id: SectionType; label: string; targetWords: number }> = [
  { id: 'company_overview', label: 'LOI Opening', targetWords: 150 },
  { id: 'cap_past_performance', label: 'Relevant Experience', targetWords: 300 },
  { id: 'capabilities', label: 'Capability Fit', targetWords: 250 },
  { id: 'differentiators', label: 'Why Us', targetWords: 200 },
  { id: 'poc', label: 'Point of Contact', targetWords: 80 },
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

const SS_RFI_PACKAGE_NOTES = [
  'Attach your existing capability statement as a separate PDF if the notice asks for one.',
  'Confirm the LOI answers the specific questions or requested information in the Sources Sought / RFI.',
  'Keep the response within the notice page limit and submit using the named email, portal, or deadline.',
];

function detectNoticeTypeFromText(sourceText: string): 'rfp' | 'sources_sought' | 'rfi' | 'rfq' | 'unknown' {
  const head = sourceText.slice(0, 3000).toLowerCase();
  if (
    head.includes('sources sought') ||
    head.includes('this is not a request for proposal') ||
    head.includes('this announcement is being used for market research') ||
    head.includes('not a solicitation')
  ) {
    return 'sources_sought';
  }
  if (
    head.includes('request for information') ||
    /\brfi\b/.test(head) ||
    head.includes('responses to this rfi')
  ) {
    return 'rfi';
  }
  if (
    head.includes('request for quotation') ||
    /\brfq\b/.test(head)
  ) {
    return 'rfq';
  }
  if (
    head.includes('request for proposal') ||
    /\brfp\b/.test(head) ||
    head.includes('offerors shall')
  ) {
    return 'rfp';
  }
  return 'unknown';
}

function combineUploadedDocuments(documents: UploadedRfp[]): UploadedRfp | null {
  if (documents.length === 0) return null;
  if (documents.length === 1) return documents[0];

  const text = documents
    .map((doc, index) => [
      `DOCUMENT ${index + 1}: ${doc.fileName}`,
      '='.repeat(Math.min(80, Math.max(24, doc.fileName.length + 12))),
      doc.text,
    ].join('\n'))
    .join('\n\n');

  return {
    fileName: `${documents.length}-document-response-package.txt`,
    fileSize: documents.reduce((sum, doc) => sum + doc.fileSize, 0),
    charCount: text.length,
    pageCount: documents.reduce((sum, doc) => sum + (doc.pageCount || 0), 0) || undefined,
    text,
  };
}

export default function ProposalsPanel({ email, tier, panelContext }: ProposalsPanelProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedRfp, setUploadedRfp] = useState<UploadedRfp | null>(null);
  // Auto (one-click draft, default) vs Manual/Sport (Perplexity-style chat —
  // upload + drive the LLM yourself). PRD-proposal-manual-mode.md. Eric 2026-06.
  const [driveMode, setDriveMode] = useState<'auto' | 'manual'>('auto');
  const [sourceDocuments, setSourceDocuments] = useState<UploadedRfp[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  // The pursuit the workbench is using. Defaults to whatever the Pipeline
  // "Draft Proposal" button passed in (panelContext.pursuit_id), but can
  // also be set IN-PANEL via the "Start from a saved pursuit" picker, so
  // users who open Proposal Assist directly can still begin a draft.
  const [localPursuitId, setLocalPursuitId] = useState<string | null>(null);
  const contextPursuitId = typeof panelContext?.pursuit_id === 'string' ? panelContext.pursuit_id : null;
  const livePursuitIds = useMemo(() => new Set(opportunities.map((opp) => opp.id)), [opportunities]);
  const contextPursuitIsLive = Boolean(contextPursuitId && livePursuitIds.has(contextPursuitId));
  const activePursuitId = localPursuitId || (contextPursuitIsLive ? contextPursuitId : null);
  const staleContextPursuit = Boolean(pipelineLoaded && contextPursuitId && !contextPursuitIsLive && !localPursuitId);
  // The active pursuit's SAM notice_type (Sources Sought / RFP / RFQ / ...),
  // carried by /api/pipeline. Lets the workbench show the type up front — even
  // with no attachment to parse — so the user knows which briefing to check.
  const activePursuitNoticeType = useMemo(
    () => opportunities.find((opp) => opp.id === activePursuitId)?.notice_type ?? null,
    [opportunities, activePursuitId]
  );
  // Respondability of the active pursuit's notice type. 'none' (Special / Award
  // / Justification / Sale of Surplus) means there is nothing to submit, so the
  // workbench is blocked with an explanation instead of showing response outputs.
  const activePursuitNotice = useMemo(
    () => classifyNoticeType(activePursuitNoticeType),
    [activePursuitNoticeType]
  );
  const activePursuitDetectedType = useMemo(
    () => noticeTypeToDetected(activePursuitNoticeType),
    [activePursuitNoticeType]
  );
  const activePursuit = useMemo(
    () => opportunities.find((opp) => opp.id === activePursuitId) || null,
    [opportunities, activePursuitId]
  );

  // Vault summary — drives the "add to vault for better drafts" nudge
  // shown above the draft sections. Fetched once on mount; if user
  // is empty, the banner stays. If they have any vault content, it
  // disappears.
  const [vaultSummary, setVaultSummary] = useState<{
    past_performance: number;
    capabilities: number;
    team: number;
    hasIdentity: boolean;
  } | null>(null);
  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/vault?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return;
        setVaultSummary({
          past_performance: (d.past_performance || []).length,
          capabilities: (d.capabilities || []).length,
          team: (d.team || []).length,
          hasIdentity: Boolean(d.identity && (d.identity.legal_name || d.identity.uei || d.identity.one_liner)),
        });
      })
      .catch(() => { /* silent — nudge just doesn't show */ });
  }, [email]);

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
      const extractedText = data.text || '';
      const nextDocument: UploadedRfp = {
        fileName: data.file?.name || file.name,
        fileSize: data.file?.size ?? file.size,
        charCount: data.charCount || 0,
        pageCount: data.pageCount,
        text: extractedText,
      };
      setSourceDocuments(prev => {
        const next = [...prev, nextDocument];
        const combined = combineUploadedDocuments(next);
        setUploadedRfp(combined);
        const detected = detectNoticeTypeFromText(combined?.text || '');
        if (detected !== 'unknown') setDetectedNoticeType(detected);
        return next;
      });
    } catch (err) {
      console.error('RFP upload failed:', err);
      setUploadError('Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }, [email, getAuthHeaders]);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) void handleRfpFile(file);
    e.target.value = '';
  }, [handleRfpFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files || []);
    for (const file of files) void handleRfpFile(file);
  }, [handleRfpFile]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const clearRfp = useCallback(() => {
    setUploadedRfp(null);
    setSourceDocuments([]);
    setUploadError(null);
    setCompliance([]);
    setComplianceError(null);
    setDrafts({
      exec_summary: undefined,
      technical: undefined,
      management: undefined,
      past_performance: undefined,
      pricing: undefined,
      company_overview: undefined,
      cap_past_performance: undefined,
      capabilities: undefined,
      differentiators: undefined,
      poc: undefined,
    });
    setDraftError(null);
    setChecklist(DEFAULT_CHECKLIST.map(item => ({ ...item, checked: false })));
    setExportError(null);
  }, []);

  const startAnotherProposal = useCallback(() => {
    setLocalPursuitId(null);
    setSelectedId(opportunities[0]?.id || '');
    setAutoLoadStatus('idle');
    setAutoLoadMessage(null);
    setDetectedNoticeType('unknown');
    clearRfp();
  }, [clearRfp, opportunities]);

  // Compliance matrix
  const [compliance, setCompliance] = useState<ComplianceRequirementRow[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [complianceMeta, setComplianceMeta] = useState<{ truncated?: boolean; originalChars?: number; inputChars?: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ComplianceStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ComplianceCategory>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ReqPriority>('all');

  const generateCompliance = useCallback(async () => {
    if (!email || !uploadedRfp) return;
    setComplianceLoading(true);
    setComplianceError(null);
    try {
      const res = await fetch(`/api/app/proposal/compliance?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        // Send pipeline_id so the matrix uses MULTI-DOC extraction with amendment
        // precedence (base + amendments + Q&A) when we have a tracked pursuit;
        // falls back to the uploaded text otherwise.
        body: JSON.stringify({ text: uploadedRfp.text, fileName: uploadedRfp.fileName, pipeline_id: activePursuitId || undefined }),
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
        source_doc: r.source_doc,
        revised: r.revised,
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

  // ── Sources Sought / RFI: extract LOI fields straight from the notice text ──
  // The notice text IS the input — no document upload needed for 90% of SS.
  // We pull agency/address/solicitation #/deadline/submission method/required
  // content from the pasted (or cached) SAM text and pre-fill the LOI .docx.
  const [loiFields, setLoiFields] = useState<LoiFields | null>(null);
  const [loiFieldsLoading, setLoiFieldsLoading] = useState(false);
  const [loiFieldsError, setLoiFieldsError] = useState<string | null>(null);

  // Paste-the-notice-text path (the hero for Sources Sought). No upload — the
  // user copies the SAM.gov notice text and drops it here; we treat it as the
  // source doc so it flows through the same compliance/draft/export pipeline.
  const [pastedNotice, setPastedNotice] = useState('');
  const usePastedNotice = useCallback(() => {
    const text = pastedNotice.trim();
    if (text.length < 80) return;
    const pseudoDoc: UploadedRfp = {
      fileName: 'Pasted SAM.gov notice',
      fileSize: text.length,
      charCount: text.length,
      text,
    };
    setSourceDocuments([pseudoDoc]);
    setUploadedRfp(pseudoDoc);
    const detected = detectNoticeTypeFromText(text);
    setDetectedNoticeType(detected);
    setPastedNotice('');
    // The auto-extract effect picks it up from uploadedRfp.text.
  }, [pastedNotice]);

  const extractLoiFields = useCallback(async (text: string, fileName?: string) => {
    if (!email || !text.trim()) return;
    setLoiFieldsLoading(true);
    setLoiFieldsError(null);
    try {
      const res = await fetch(`/api/app/proposal/extract-loi-fields?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          text,
          fileName: fileName || activePursuit?.title || 'SAM.gov notice',
          agency: activePursuit?.agency,
          title: activePursuit?.title,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLoiFieldsError(data.error || 'Could not read the notice. The blank template still exports.');
        return;
      }
      setLoiFields(loiFieldsHaveContent(data.fields) ? data.fields : null);
    } catch (err) {
      console.error('LOI field extraction failed:', err);
      setLoiFieldsError('Request failed — the blank template still exports.');
    } finally {
      setLoiFieldsLoading(false);
    }
  }, [email, getAuthHeaders, activePursuit?.title, activePursuit?.agency]);

  const updateRequirement = useCallback((id: string, patch: Partial<ComplianceRequirementRow>) => {
    setCompliance(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  // Extract the SOW/PWS to a standalone .docx (send subs for pricing/bids).
  const [sowBusy, setSowBusy] = useState(false);
  const [sowError, setSowError] = useState<string | null>(null);
  const downloadSow = useCallback(async () => {
    const text = uploadedRfp?.text?.trim();
    if (!email || !text) return;
    setSowBusy(true); setSowError(null);
    try {
      const res = await fetch('/api/app/proposal/extract-sow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ email, text, fileName: uploadedRfp?.fileName || 'solicitation' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSowError(j.error || 'Could not extract the SOW.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'Statement-of-Work.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setSowError('Could not extract the SOW.');
    } finally {
      setSowBusy(false);
    }
  }, [email, uploadedRfp?.text, uploadedRfp?.fileName, getAuthHeaders]);

  const filteredCompliance = useMemo(() => {
    const rows = compliance.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (priorityFilter !== 'all' && priorityOf({ requirement: r.requirement, category: r.category, section: r.section }) !== priorityFilter) return false;
      return true;
    });
    // Sort by PRIORITY first (Eric: critical first, page-counts last), then by
    // section within a tier.
    const prRank = { critical: 0, standard: 1, final: 2 };
    const sortKey = (s?: string) => {
      if (!s) return 'zzz';
      const letter = (s.match(/^[A-Za-z]/)?.[0] || 'z').toUpperCase();
      return `${letter}:${s}`;
    };
    return [...rows].sort((a, b) => {
      const pa = prRank[priorityOf({ requirement: a.requirement, category: a.category, section: a.section })];
      const pb = prRank[priorityOf({ requirement: b.requirement, category: b.category, section: b.section })];
      if (pa !== pb) return pa - pb;
      return sortKey(a.section).localeCompare(sortKey(b.section), undefined, { numeric: true });
    });
  }, [compliance, statusFilter, categoryFilter, priorityFilter]);

  // Section drafts. Holds slots for BOTH RFP + LOI/response
  // sections; only the active tab set is shown at any time based on
  // detectedNoticeType.
  const [drafts, setDrafts] = useState<Record<SectionType, SectionDraft | undefined>>({
    exec_summary: undefined,
    technical: undefined,
    management: undefined,
    past_performance: undefined,
    pricing: undefined,
    company_overview: undefined,
    cap_past_performance: undefined,
    capabilities: undefined,
    differentiators: undefined,
    poc: undefined,
  });
  const [activeSection, setActiveSection] = useState<SectionType>('exec_summary');
  // One-one-one: for simple responses (Sources Sought / RFI), show ONE primary
  // "Draft my response" action by default and tuck the export / blank-template /
  // per-section editing behind this toggle. Eric: "give me an answer, not a wall
  // of options" (2026-06-04).
  const [showAdvancedOutputs, setShowAdvancedOutputs] = useState(false);

  // Detected notice type from the active pursuit and/or loaded doc text.
  // Sources Sought/RFI are market-research responses, so the workflow should
  // draft an LOI/response package and treat any capability statement as an
  // attachment the user already owns.
  const [detectedNoticeType, setDetectedNoticeType] = useState<'rfp' | 'sources_sought' | 'rfi' | 'rfq' | 'unknown'>('unknown');

  // Seed/reset from SAM notice_type so a Sources Sought/RFI pursuit stays in
  // the LOI response workflow even when SAM has no cached attachments. Uploaded
  // text can still refine this later.
  useEffect(() => {
    setDetectedNoticeType(noticeTypeToDetected(activePursuitNoticeType));
  }, [activePursuitId, activePursuitNoticeType]);

  // Pick the right tab set based on what we detected from the loaded
  // doc or active pursuit. SS/RFI = LOI/response tabs. Everything else
  // (RFP/RFQ/unknown) = traditional proposal tabs.
  const effectiveNoticeType = detectedNoticeType !== 'unknown' ? detectedNoticeType : activePursuitDetectedType;
  const isLoiResponseMode = effectiveNoticeType === 'sources_sought' || effectiveNoticeType === 'rfi';
  const isRfqMode = effectiveNoticeType === 'rfq';
  const isSimpleResponseMode = isLoiResponseMode || isRfqMode;
  const proposalFlowName = isLoiResponseMode ? 'LOI Response' : isRfqMode ? 'RFQ Response' : 'Proposal';
  const canUseTemplateWithoutSource = Boolean(activePursuitId && isSimpleResponseMode);
  const responseOutputsReady = Boolean(uploadedRfp || canUseTemplateWithoutSource);
  const exportContextName = useMemo(
    () => uploadedRfp?.fileName || activePursuit?.title || proposalFlowName,
    [activePursuit?.title, proposalFlowName, uploadedRfp?.fileName]
  );
  // Memoized so its identity is stable across renders (it only flips when the
  // detected mode changes). This lets the hooks below list it as a dependency
  // without re-running every render.
  const currentSectionTabs = useMemo(
    () => (isLoiResponseMode ? LOI_RESPONSE_SECTION_TABS : RFP_SECTION_TABS),
    [isLoiResponseMode]
  );

  // When the detected mode flips (e.g., user loads a different doc),
  // make sure activeSection isn't pointing to a tab that no longer
  // exists in the current set. If it isn't in currentSectionTabs,
  // default to the first available.
  useEffect(() => {
    if (!currentSectionTabs.some(t => t.id === activeSection)) {
      setActiveSection(currentSectionTabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoiResponseMode]);

  // Auto-extract LOI fields when we already HAVE the notice text (cached SAM
  // doc / upload) and we're in Sources Sought / RFI mode. Keyed on the text so
  // it runs once per distinct notice, not on every render. The paste-box path
  // calls extractLoiFields() directly instead.
  const lastExtractedTextRef = useRef<string>('');
  useEffect(() => {
    const text = uploadedRfp?.text?.trim();
    if (!isLoiResponseMode || !text || text.length < 80) return;
    if (lastExtractedTextRef.current === text) return;
    lastExtractedTextRef.current = text;
    setLoiFields(null);
    extractLoiFields(text, uploadedRfp?.fileName);
  }, [isLoiResponseMode, uploadedRfp?.text, uploadedRfp?.fileName, extractLoiFields]);

  const [draftLoading, setDraftLoading] = useState<SectionType | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftAllLoading, setDraftAllLoading] = useState(false);
  const [draftAllSummary, setDraftAllSummary] = useState<{ count: number; ms: number; errors: number } | null>(null);

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

  // Draft ALL sections at once via the two-pass /draft-all endpoint.
  // Content Reaper pattern #2 — outline + parallel write. Takes
  // ~30-60s total instead of 5+ minutes of sequential clicks.
  const generateAllDrafts = useCallback(async () => {
    if (!email || !uploadedRfp) return;
    setDraftAllLoading(true);
    setDraftError(null);
    setDraftAllSummary(null);
    try {
      const res = await fetch(`/api/app/proposal/draft-all?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: uploadedRfp.text, fileName: uploadedRfp.fileName }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDraftError(data.error || 'Could not generate the full draft.');
        return;
      }
      // Merge each returned section into the drafts state
      setDrafts(prev => {
        const next = { ...prev };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const section of (data.sections || []) as any[]) {
          next[section.section as SectionType] = {
            draft: section.draft,
            wordCount: section.wordCount,
            targetWords: section.targetWords,
            profileGrounded: section.meta?.profileGrounded,
            generatedAt: Date.now(),
          };
        }
        return next;
      });
      setDraftAllSummary({
        count: (data.sections || []).length,
        ms: data.totalProcessingMs || 0,
        errors: (data.errors || []).length,
      });
      // Auto-focus the first section
      if (data.sections?.[0]?.section) {
        setActiveSection(data.sections[0].section);
      }
    } catch (err) {
      console.error('Draft-all failed:', err);
      setDraftError('Request failed. Try again.');
    } finally {
      setDraftAllLoading(false);
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
    const meta = currentSectionTabs.find(t => t.id === sectionType);
    const label = meta?.label || sectionType;
    const safeName = (uploadedRfp?.fileName || 'proposal').replace(/[^a-z0-9-_.]/gi, '_');
    const blob = new Blob([d.draft], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}-${label.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [drafts, uploadedRfp, currentSectionTabs]);

  // Review checklist
  const [checklist, setChecklist] = useState<ChecklistItemState[]>(DEFAULT_CHECKLIST);
  const checklistChecked = useMemo(() => checklist.filter(c => c.checked).length, [checklist]);

  // Compliance referee — independent Claude check of the assembled draft vs the
  // requirements (Eric's "run the final against an independent evaluator").
  const [refereeRunning, setRefereeRunning] = useState(false);
  const [refereeResult, setRefereeResult] = useState<{ verdicts: Array<{ id: string; requirement: string; status: 'met' | 'partial' | 'missing'; evidence?: string }>; summary: { total: number; met: number; partial: number; missing: number; score: number } } | null>(null);
  const [refereeError, setRefereeError] = useState<string | null>(null);
  const runReferee = useCallback(async () => {
    if (!email) return;
    setRefereeRunning(true); setRefereeError(null);
    try {
      // Assemble the drafted sections into one document for the referee to read.
      const assembled = currentSectionTabs
        .map(t => drafts[t.id]?.draft ? `## ${t.label}\n\n${drafts[t.id]!.draft}` : '')
        .filter(Boolean).join('\n\n');
      if (!assembled) { setRefereeError('Draft at least one section first.'); setRefereeRunning(false); return; }
      if (compliance.length === 0) { setRefereeError('Generate the compliance matrix first.'); setRefereeRunning(false); return; }
      const res = await fetch(`/api/app/proposal/referee?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ requirements: compliance.map(r => ({ id: r.id, requirement: r.requirement, category: r.category, section: r.section })), draft: assembled }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setRefereeError(data.error || 'Referee check failed.'); return; }
      setRefereeResult({ verdicts: data.verdicts, summary: data.summary });
    } catch {
      setRefereeError('Referee check failed. Try again.');
    } finally {
      setRefereeRunning(false);
    }
  }, [email, currentSectionTabs, drafts, compliance, getAuthHeaders]);
  const toggleChecklistItem = useCallback((id: string) => {
    setChecklist(prev => prev.map(c => (c.id === id ? { ...c, checked: !c.checked } : c)));
  }, []);

  // Final package export
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const hasAnyDraft = useMemo(
    () => currentSectionTabs.some(t => !!drafts[t.id]?.draft),
    [drafts, currentSectionTabs]
  );

  const exportProposalPackage = useCallback(async () => {
    if (!email) return;
    if (!uploadedRfp && !isSimpleResponseMode) return;
    setExporting(true);
    setExportError(null);
    try {
      const draftsForExport: Record<string, { label: string; draft: string; wordCount?: number }> = {};
      for (const tab of currentSectionTabs) {
        const d = drafts[tab.id];
        if (d?.draft) {
          draftsForExport[tab.id] = { label: tab.label, draft: d.draft, wordCount: d.wordCount };
        }
      }

      const res = await fetch(`/api/app/proposal/export?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          fileName: (exportContextName.replace(/\.(pdf|docx|txt)$/i, '') || 'proposal') + '-package',
          rfpFileName: exportContextName,
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
          sectionOrder: currentSectionTabs.map(tab => tab.id),
          checklist: isSimpleResponseMode ? [] : checklist.map(c => ({ label: c.label, checked: c.checked })),
          packageType: isLoiResponseMode ? 'sources_sought_loi' : isRfqMode ? 'rfq_response' : 'proposal',
          // Pre-fill the LOI template from the notice text when we extracted fields.
          loiFields: isLoiResponseMode && loiFields ? loiFields : undefined,
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
      const fallback = `${exportContextName.replace(/\.(pdf|docx|txt)$/i, '') || 'proposal'}-package-${new Date().toISOString().split('T')[0]}.docx`;
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
  }, [email, uploadedRfp, isSimpleResponseMode, currentSectionTabs, drafts, getAuthHeaders, exportContextName, compliance, checklist, isLoiResponseMode, isRfqMode, loiFields]);

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

      // Proposal Assist only drafts for LIVE pursuits. Exclude every
      // terminal stage (won / lost / no_bid / archived) AND the
      // is_archived soft-delete flag — you don't write a proposal for a
      // finished or shelved pursuit. (Previously no_bid + is_archived
      // leaked through, so the picker showed non-bidding pursuits.)
      const active = (data.opportunities || []).filter((opp: PipelineOpportunity & { is_archived?: boolean }) => (
        !opp.is_archived && !isTerminalPipelineStage(opp.stage)
      ));
      setOpportunities(active);
      const activeIds = new Set(active.map((opp: PipelineOpportunity) => opp.id));
      setLocalPursuitId((current) => (current && activeIds.has(current) ? current : null));
      setSelectedId((current) => {
        if (current && activeIds.has(current)) return current;
        if (contextPursuitId && activeIds.has(contextPursuitId)) return contextPursuitId;
        return active[0]?.id || '';
      });
    } catch (err) {
      console.error('Failed to load proposal pursuits:', err);
      setError('Failed to load pursuits');
    } finally {
      setPipelineLoaded(true);
      setLoading(false);
    }
  }, [contextPursuitId, email, getAuthHeaders, tier]);

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
  // detectedNoticeType moved up near currentSectionTabs declaration
  // so we can derive the simple-response workflow before consumers need it.
  useEffect(() => {
    const pursuitId = activePursuitId;
    if (!pursuitId || !email) return;

    let cancelled = false;
    setAutoLoadStatus('loading');
    setSelectedId(pursuitId);

    fetch(`/api/app/proposal/pursuit-docs?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}`, {
      headers: getAuthHeaders(),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !data?.success) {
          return { success: false, error: data?.error || `HTTP ${r.status}` };
        }
        return data;
      })
      .then(data => {
        if (cancelled) return;
        if (!data?.success) {
          if (isMissingPursuitError(data?.error)) {
            setLocalPursuitId(null);
            setSelectedId(opportunities[0]?.id || '');
            setAutoLoadStatus('idle');
            setAutoLoadMessage(null);
            return;
          }
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
        // Load ALL extracted docs, not just the first (Eric QA 2026-06-05: a
        // pursuit with 8 PDFs only showed 1). Combine them into one package so
        // Mindy sees the full solicitation (RFP + SOW + amendments + Q&A).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loadedDocs: UploadedRfp[] = (docs as any[])
          .filter(d => d.extracted_text)
          .map(d => ({
            fileName: d.filename,
            fileSize: d.size_bytes || 0,
            charCount: d.char_count || (d.extracted_text?.length ?? 0),
            pageCount: d.page_count,
            text: d.extracted_text,
          }));
        if (loadedDocs.length > 0) {
          const combined = combineUploadedDocuments(loadedDocs);
          setSourceDocuments(loadedDocs);
          setUploadedRfp(combined);
          const detected = detectNoticeTypeFromText(combined?.text || '');
          setDetectedNoticeType(detected);
          setAutoLoadStatus('loaded');
          // Be HONEST about what couldn't be read (Eric QC: "9" vs "11" with no
          // explanation). Count docs with no text + name the unsupported types.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const skipped = (docs as any[]).filter(d => !d.extracted_text);
          const unsupported = skipped.filter(d => /unsupported/i.test(d.extraction_error || '')).length;
          const oversized = skipped.length - unsupported;
          const note = skipped.length > 0
            ? ` (${skipped.length} couldn't be read${unsupported ? `: ${unsupported} unsupported file type${unsupported > 1 ? 's' : ''} like .xlsx pricing` : ''}${oversized ? `${unsupported ? ',' : ':'} ${oversized} too large` : ''} — download from the manifest to handle manually)`
            : '';
          setAutoLoadMessage(
            loadedDocs.length > 1
              ? `Loaded ${loadedDocs.length} of ${docs.length} documents for drafting${note}.`
              : `Loaded ${loadedDocs[0].fileName} from this pursuit${note}`
          );
        } else if (docs[0]?.extraction_error) {
          setAutoLoadStatus('error');
          setAutoLoadMessage(`Could not extract text from ${docs[0].filename}: ${docs[0].extraction_error}. Upload manually below.`);
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
  }, [activePursuitId, email, getAuthHeaders, opportunities]);

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
          <p className="text-slate-400 mt-1">
            {activePursuitId
              ? `${proposalFlowName} workspace for ${activePursuit?.title || 'this pursuit'}.`
              : 'Start from a saved pursuit or upload a source document to prepare the response.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(activePursuitId || uploadedRfp) && (
            <button
              type="button"
              onClick={startAnotherProposal}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Start another
            </button>
          )}
          <button
            onClick={loadPipeline}
            disabled={loading}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded-lg transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh Pursuits'}
          </button>
        </div>
      </div>

      {activePursuit && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Current pursuit</p>
              <h2 className="text-base font-semibold text-white truncate">{activePursuit.title}</h2>
              <p className="text-xs text-slate-400 mt-1">
                {[
                  activePursuit.agency,
                  formatDodaacOffice(activePursuit.notice_id || null),
                  noticeTypeLabel(activePursuit.notice_type),
                  activePursuit.naics_code ? `NAICS ${activePursuit.naics_code}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activePursuit?.notice_id && (
                <a
                  href={`https://sam.gov/opp/${activePursuit.notice_id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 text-xs font-medium text-blue-300 hover:bg-blue-500/20"
                  title="Verify all documents + notice text on the official SAM.gov listing"
                >
                  🔎 Verify on SAM.gov ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setLocalPursuitId(null);
                  setAutoLoadStatus('idle');
                  setAutoLoadMessage(null);
                  clearRfp();
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                Switch pursuit
              </button>
            </div>
          </div>
        </section>
      )}

      {staleContextPursuit && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          That saved pursuit is no longer available. Choose another live pursuit below, or upload an RFP manually.
        </div>
      )}

      {/* Start from a saved pursuit — entry point for users who open
          Proposal Assist directly (no Pipeline click). Pick a saved
          pursuit and the workbench will extract available SAM docs. */}
      {email && !activePursuitId && opportunities.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Start here</p>
          <h2 className="text-lg font-semibold text-white mb-1">Start from a saved pursuit</h2>
          <p className="text-sm text-slate-400 mb-3">
            Pick one of your live pursuits. Mindy will pull cached SAM documents when available, then show the outputs you can generate.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="flex-1 min-w-[240px] rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
            >
              <option value="">Choose a pursuit…</option>
              {opportunities.map(opp => {
                const nt = noticeTypeLabel(opp.notice_type);
                return (
                  <option key={opp.id} value={opp.id}>
                    {opp.title}{opp.agency ? ` — ${opp.agency}` : ''}{nt ? ` · ${nt}` : ''}
                  </option>
                );
              })}
            </select>
            {(() => {
              const picked = opportunities.find(o => o.id === selectedId);
              const respondable = classifyNoticeType(picked?.notice_type).respondability !== 'none';
              return (
                <button
                  type="button"
                  onClick={() => { if (selectedId && respondable) setLocalPursuitId(selectedId); }}
                  disabled={!selectedId || !respondable}
                  title={!respondable ? 'This notice type has nothing to submit — you cannot draft a response.' : undefined}
                  className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-sm font-semibold text-white"
                >
                  Open workbench →
                </button>
              );
            })()}
          </div>
          {/* Colored notice-type cue for the highlighted pursuit. Three tiers:
              biddable (emerald), respondable-but-not-a-bid (amber: Sources
              Sought / RFI — LOI / market-research response), and not
              respondable at all (slate: Special / Award / Justification). */}
          {(() => {
            const picked = opportunities.find(o => o.id === selectedId);
            const { label, respondability } = classifyNoticeType(picked?.notice_type);
            if (!label) return null;
            const styles =
              respondability === 'bid'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : respondability === 'response'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'bg-slate-600/20 text-slate-300 border-slate-500/40';
            const hint =
              respondability === 'bid'
                ? 'Biddable solicitation — Mindy drafts a full proposal. Check the matching RFP briefing.'
                : respondability === 'response'
                ? 'Not a priced bid — Mindy drafts the LOI / response narrative; attach your capability statement separately if requested.'
                : /presol/i.test(label)
                ? 'Pre-solicitation — no response yet. Track it; you’ll be alerted when the solicitation drops.'
                : /award/i.test(label)
                ? 'Already awarded — no bid. Add the awardee to Relationships for subcontracting.'
                : 'Informational notice — there is nothing to submit for this type.';
            return (
              <div className="mt-3">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider border ${styles}`}>
                  {label}
                </span>
                <span className="ml-2 text-[11px] text-slate-400">{hint}</span>
              </div>
            );
          })()}
          <p className="text-[11px] text-slate-500 mt-2">
            Or upload documents below for an opportunity that isn&apos;t saved yet.
          </p>
        </section>
      )}

      {/* Non-respondable notice type (Special Notice, Award Notice,
          Justification, Sale of Surplus Property): you cannot write a response,
          so block the workbench with a clear, TYPE-SPECIFIC next step instead of
          letting the user draft a bid that has nowhere to go.
            - Award Notice → add the awardee to Relationships (subcontracting).
            - Everything else → use as market intel + track the real solicitation. */}
      {email && activePursuitId && activePursuitNotice.respondability === 'none' && (() => {
        const label = activePursuitNotice.label || 'Notice';
        const isAward = /award/i.test(label);
        const isPresol = /presol/i.test(label);
        return (
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="rounded-lg border border-slate-600/40 bg-slate-600/15 p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider border bg-slate-600/20 text-slate-300 border-slate-500/40">
                  {label}
                </span>
                <span className="text-sm font-medium text-slate-200">
                  {isPresol ? 'Nothing to submit yet' : 'No response to draft'}
                </span>
              </div>
              {isAward ? (
                <p className="mt-2 text-sm text-slate-400">
                  This contract has already been awarded — there&apos;s no bid to write. But it&apos;s a
                  strong <span className="text-slate-200">subcontracting lead</span>: add the awardee to
                  Relationships and reach out about teaming on the work, or track the recompete.
                </p>
              ) : isPresol ? (
                <p className="mt-2 text-sm text-slate-400">
                  A pre-solicitation is a heads-up that a solicitation is coming — you don&apos;t respond yet.
                  Keep <span className="text-slate-200">tracking this pursuit</span> so you&apos;re notified the
                  moment the solicitation posts, then come back here to draft your bid.
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-400">
                  This is an informational <span className="text-slate-200">{label}</span> —
                  nothing to submit, so Mindy can&apos;t draft a bid. Use it for market intelligence
                  (incumbent, agency, timing).
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {isAward && (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-emerald-600/20 text-emerald-200 border border-emerald-500/30">
                    → Add awardee to Relationships for subcontracting
                  </span>
                )}
                {isPresol && (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-amber-600/15 text-amber-200 border border-amber-500/30">
                    ⏱ Tracked — you&apos;ll be alerted when the solicitation drops
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => { setLocalPursuitId(null); }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200"
                >
                  ← Pick a different pursuit
                </button>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Document Workbench */}
      <section id="proposal-source-document" className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Source Documents</p>
            <h2 className="text-lg font-semibold text-white">
              Upload or extract everything for this response
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Add the notice, RFP/RFQ, PWS/SOW, amendments, Q&A, pricing schedule, or attachments. Mindy extracts the text, classifies the response type, then unlocks the outputs below.
            </p>
            {/* Auto ↔ Manual choice — at the TOP / Start Here (Eric QA: it was
                buried at the bottom; users decide their style up front). */}
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 p-1 text-sm">
              <span className="pl-2 text-xs text-slate-500">Mode:</span>
              <button
                onClick={() => setDriveMode('auto')}
                className={`px-3 py-1.5 rounded-md transition-colors ${driveMode === 'auto' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title="Mindy drafts the whole response for you"
              >
                ⚡ Auto
              </button>
              <button
                onClick={() => setDriveMode('manual')}
                className={`px-3 py-1.5 rounded-md transition-colors ${driveMode === 'manual' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title="You drive — upload files + chat to write the proposal yourself"
              >
                🏎 Manual · Sport
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {driveMode === 'auto' ? '⚡ Auto: Mindy drafts it for you (safe mode).' : '🏎 Sport: you direct Mindy with your own files.'}
            </p>
          </div>
          {/* Verify on SAM.gov — cross-check every doc + the notice text against
              the official source. Builds trust (Eric: confidence I'm not missing
              anything) + lets users download/upload as needed. */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Extract SOW/PWS to a .docx to send subs for pricing/bids. */}
            {uploadedRfp?.text && (
              <button
                type="button"
                onClick={downloadSow}
                disabled={sowBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                title="Pull the Statement of Work / PWS into its own Word doc to send subcontractors for pricing"
              >
                {sowBusy ? 'Extracting…' : '📄 SOW for subs (.docx)'}
              </button>
            )}
            {activePursuit?.notice_id && (
              <a
                href={`https://sam.gov/opp/${activePursuit.notice_id}/view`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-300 hover:bg-blue-500/20 transition-colors"
                title="Open the official SAM.gov notice to verify all documents + text"
              >
                🔎 Verify on SAM.gov ↗
              </a>
            )}
          </div>
        </div>
        {sowError && <p className="mt-1 text-xs text-amber-400/80">{sowError}</p>}

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

        {/* Doc manifest — all attachments classified + grouped, so you can hand
            the SOW/pricing/wage-det to the right person. Shows on a pursuit. */}
        {activePursuitId && email && (
          <div className="mb-4">
            <DocManifest email={email} pursuitId={activePursuitId} />
          </div>
        )}

        {!uploadedRfp && canUseTemplateWithoutSource && (
          <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
            <span className="font-semibold">✓ {proposalFlowName} template ready.</span>{' '}
            Use the built-in template below now, or upload source documents if you want Mindy to draft custom narrative from the notice.
          </div>
        )}

        {/* Notice type warning — when the loaded doc is a Sources
            Sought or RFI, switch the user into an LOI / market-research
            response workflow. Users attach their existing capability
            statement separately if the notice requests one. */}
        {uploadedRfp && isLoiResponseMode && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <div className="font-semibold mb-1">
              ⚠ This looks like a {effectiveNoticeType === 'sources_sought' ? 'Sources Sought' : 'Request for Information'}, not an RFP.
            </div>
            <div className="text-xs text-amber-200/90">
              {effectiveNoticeType === 'sources_sought'
                ? 'Sources Sought notices are market research — the agency wants to know who can do the work. Mindy drafts the LOI / response narrative. Attach your existing capability statement separately if the notice requests it.'
                : 'RFIs ask for information about your capabilities, methods, or pricing. Mindy drafts the response narrative and requested answers, not a full proposal or Section L/M compliance package.'}
            </div>
          </div>
        )}

        {/* HERO: paste the SAM.gov notice text. For Sources Sought / RFI the
            notice text IS the input — 90% have no attachments — so this is the
            primary path. Upload (below) stays for the 10% with real documents. */}
        {!uploadedRfp && (
          <div className="mb-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-purple-200">
                📋 Paste the SAM.gov notice text
              </p>
              <span className="text-[11px] text-slate-500">no upload needed</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Copy the notice body from SAM.gov (Description + Contact Information)
              and paste it here. Mindy reads the agency, solicitation number,
              deadline, submission email, and required content — then pre-fills your
              LOI / response.
            </p>
            <textarea
              value={pastedNotice}
              onChange={(e) => setPastedNotice(e.target.value)}
              placeholder="Paste the SAM.gov notice text here…"
              rows={5}
              className="w-full rounded-lg bg-slate-950/60 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-purple-500/60 focus:outline-none resize-y"
            />
            <div className="flex items-center justify-between gap-3 mt-2">
              <span className="text-[11px] text-slate-500">
                {pastedNotice.trim().length > 0
                  ? `${pastedNotice.trim().length.toLocaleString()} chars`
                  : 'Tip: include the Description and Contact Information sections'}
              </span>
              <button
                type="button"
                onClick={usePastedNotice}
                disabled={pastedNotice.trim().length < 80}
                className="px-4 py-1.5 text-sm rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use this notice
              </button>
            </div>
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
              multiple
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={onFileInputChange}
              className="hidden"
            />
            <p className="text-slate-300">
              Drop files here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-purple-300 hover:text-purple-200 underline disabled:opacity-50"
              >
                browse
              </button>
            </p>
            <p className="text-xs text-slate-500 mt-2">PDF · DOCX · TXT · max 10 MB each</p>
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
                    {sourceDocuments.length} document{sourceDocuments.length === 1 ? '' : 's'} · {(uploadedRfp.fileSize / 1024).toFixed(1)} KB · {uploadedRfp.charCount.toLocaleString()} chars
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
                  Add / replace
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

            {sourceDocuments.length > 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {sourceDocuments.map((doc) => (
                  <div key={`${doc.fileName}-${doc.charCount}`} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <p className="truncate text-xs font-medium text-slate-200">{doc.fileName}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {(doc.fileSize / 1024).toFixed(1)} KB · {doc.charCount.toLocaleString()} chars
                    </p>
                  </div>
                ))}
              </div>
            )}

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
              Extracted text is held in this session and used by each output you run below.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
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

      {/* MANUAL MODE — Perplexity-style proposal chat over your uploaded files
          + Vault. You type what you want; Mindy drafts grounded in YOUR docs. */}
      {responseOutputsReady && driveMode === 'manual' && email && (
        <ProposalChat
          email={email}
          rfpText={uploadedRfp?.text || ''}
          rfpFileName={uploadedRfp?.fileName || ''}
          hasVault={!!vaultSummary?.hasIdentity || (vaultSummary?.past_performance ?? 0) > 0 || (vaultSummary?.capabilities ?? 0) > 0}
          files={sourceDocuments.map(d => ({ fileName: d.fileName, charCount: d.charCount, pageCount: d.pageCount }))}
          onAddFile={handleRfpFile}
          onRemoveFile={(name) => {
            setSourceDocuments(prev => {
              const next = prev.filter(d => d.fileName !== name);
              setUploadedRfp(combineUploadedDocuments(next));
              return next;
            });
          }}
          uploading={uploading}
        />
      )}

      {/* SIMPLE RESPONSE (Sources Sought / RFI / RFQ) — one-one-one hero.
          ONE obvious action: "Draft my response". Export + blank template +
          per-section editing are tucked behind "More options" below. */}
      {responseOutputsReady && isSimpleResponseMode && driveMode === 'auto' && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <p className="text-xs uppercase tracking-wider text-purple-300">Your response</p>
            <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              {noticeTypeLabel(activePursuitNoticeType) || (effectiveNoticeType === 'sources_sought' ? 'Sources Sought' : effectiveNoticeType.toUpperCase())}
            </span>
          </div>
          <h2 className="text-xl font-semibold text-white">Let Mindy write your response</h2>
          <p className="text-sm text-slate-400 mt-1 mb-4">
            Mindy reads {uploadedRfp ? 'the notice' : 'this opportunity'} and your saved profile, then drafts the full {isRfqMode ? 'RFQ response' : 'letter of intent / response'} — opening, relevant experience, capability fit, and point of contact. One click.
          </p>

          {/* What Mindy pre-filled from the notice (LOI field extraction). */}
          {isLoiResponseMode && loiFields && (
            <p className="mb-4 text-xs text-emerald-300/90">
              ✓ Pre-filled from the notice:{' '}
              {[
                loiFields.solicitationNumber && 'solicitation #',
                loiFields.agencyName && 'agency',
                loiFields.submissionDeadline && 'deadline',
                loiFields.submissionMethod && 'submit-to',
                loiFields.requestedContent?.length && 'required content',
                loiFields.naicsCode && 'NAICS',
              ].filter(Boolean).join(', ') || 'available fields'}.
            </p>
          )}
          {isLoiResponseMode && loiFieldsLoading && (
            <p className="mb-4 text-xs text-purple-200 flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              Reading the notice — extracting agency, deadline, and required content…
            </p>
          )}

          {/* THE one button */}
          {!isRfqMode ? (
            <button
              onClick={generateAllDrafts}
              disabled={draftAllLoading || !!draftLoading}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white text-base font-semibold rounded-xl shadow-lg shadow-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {draftAllLoading ? '⏳ Drafting your response…' : draftAllSummary ? '✨ Redraft my response' : '✨ Draft my response'}
            </button>
          ) : (
            <button
              onClick={exportProposalPackage}
              disabled={exporting}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white text-base font-semibold rounded-xl shadow-lg disabled:opacity-50"
            >
              {exporting ? 'Assembling…' : '✨ Build my RFQ response'}
            </button>
          )}

          {draftAllSummary && !draftAllLoading && !isRfqMode && (
            <p className="text-sm text-emerald-300 mt-3">
              ✅ Drafted {draftAllSummary.count} section{draftAllSummary.count === 1 ? '' : 's'} — review and export below.
            </p>
          )}

          {/* Secondary: collapsed "more options" (export blank template, edit
              individual sections). Hidden by default — the answer comes first. */}
          <button
            type="button"
            onClick={() => setShowAdvancedOutputs(v => !v)}
            className="mt-4 text-sm text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5"
          >
            <span className={`transition-transform ${showAdvancedOutputs ? 'rotate-90' : ''}`}>▸</span>
            More options {showAdvancedOutputs ? '' : '(export .docx, blank template, edit sections)'}
          </button>
        </section>
      )}

      {responseOutputsReady && !isSimpleResponseMode && driveMode === 'auto' && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Available Outputs</p>
              <h2 className="text-lg font-semibold text-white">Choose what Mindy should produce</h2>
              <p className="text-sm text-slate-400 mt-1">
                {uploadedRfp
                  ? 'No forced order. Generate the artifact you need, review it below, then export.'
                  : 'The built-in response template is ready now. Upload the notice only if you want custom AI-drafted sections.'}
              </p>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              {noticeTypeLabel(activePursuitNoticeType) || effectiveNoticeType.toUpperCase()}
            </span>
          </div>

          {/* LOI field-extraction status — shows when Mindy has read the notice
              text and pre-filled the template. */}
          {isLoiResponseMode && (loiFieldsLoading || loiFields || loiFieldsError) && (
            <div className={`mb-3 rounded-lg border p-3 text-sm ${
              loiFieldsLoading ? 'border-purple-500/30 bg-purple-500/5 text-purple-200'
              : loiFields ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            }`}>
              {loiFieldsLoading ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  Reading the notice — extracting agency, deadline, submission method, and required content…
                </span>
              ) : loiFields ? (
                <span>
                  ✓ Pre-filled from the notice:{' '}
                  {[
                    loiFields.solicitationNumber && 'solicitation #',
                    loiFields.agencyName && 'agency',
                    loiFields.submissionDeadline && 'deadline',
                    loiFields.submissionMethod && 'submit-to',
                    loiFields.requestedContent?.length && 'required content',
                    loiFields.naicsCode && 'NAICS',
                  ].filter(Boolean).join(', ') || 'available fields'}. The LOI export fills these for you.
                </span>
              ) : (
                <span>{loiFieldsError}</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {isSimpleResponseMode ? (
              <OutputActionCard
                eyebrow={isRfqMode ? 'RFQ' : 'LOI / Market Research'}
                title={isRfqMode ? 'Export RFQ response template' : 'Export LOI response template'}
                description={isRfqMode
                  ? 'Create a Word response template with blanks for pricing, attachments, and submission details.'
                  : loiFields
                    ? 'Mindy read the notice and pre-filled the agency, solicitation number, deadline, submission method, NAICS, and required content. Export the LOI with those fields already in place.'
                    : 'Create a Word LOI from Mindy\'s curated response-template library, with blanks for anything the user must complete.'}
                status={exporting ? 'Working...' : 'Ready'}
                buttonLabel={exporting ? 'Assembling...' : isRfqMode ? 'Export RFQ .docx' : 'Export LOI .docx'}
                disabled={exporting}
                onClick={exportProposalPackage}
              />
            ) : (
              <OutputActionCard
                eyebrow="Compliance"
                title="Build compliance matrix"
                description="Extract shall / must / required clauses into a working table with owner and status fields."
                status={compliance.length > 0 ? `${compliance.length} requirements` : complianceLoading ? 'Extracting...' : 'Not generated'}
                buttonLabel={complianceLoading ? 'Extracting...' : compliance.length > 0 ? 'Regenerate matrix' : 'Generate matrix'}
                disabled={complianceLoading}
                onClick={generateCompliance}
              />
            )}

            {!isRfqMode && (
              <OutputActionCard
                eyebrow={isLoiResponseMode ? 'Narrative' : 'Draft'}
                title={isLoiResponseMode ? 'Draft LOI response sections' : 'Draft proposal sections'}
                description={!uploadedRfp
                  ? 'Upload the notice or attachments first if you want Mindy to draft custom narrative from source text.'
                  : isLoiResponseMode
                    ? 'Draft the LOI opening, relevant experience, capability fit, differentiators, and POC sections.'
                    : 'Draft the first proposal sections from the extracted documents and saved profile.'}
                status={!uploadedRfp ? 'Needs source doc' : draftAllSummary ? `${draftAllSummary.count} sections drafted` : draftAllLoading ? 'Drafting...' : 'Not generated'}
                buttonLabel={!uploadedRfp ? 'Upload docs to draft' : draftAllLoading ? 'Drafting...' : draftAllSummary ? 'Regenerate drafts' : 'Draft sections'}
                disabled={!uploadedRfp || draftAllLoading || !!draftLoading}
                onClick={generateAllDrafts}
              />
            )}

            {/* The dedicated "Export" card is only for FULL proposals, where it
                bundles the compliance matrix + drafts + checklist into one
                package. For Sources Sought / RFI the first "Export LOI .docx"
                card already produces the complete letter (template + any drafted
                sections), so a second identical button was just confusing. */}
            {!isSimpleResponseMode && (
              <OutputActionCard
                eyebrow="Export"
                title="Export Word package"
                description="Download a Word package with matrix, drafts, and checklist when available."
                status={hasAnyDraft || compliance.length > 0 ? 'Ready' : 'Needs an output'}
                buttonLabel={exporting ? 'Assembling...' : 'Export .docx'}
                disabled={exporting || (!hasAnyDraft && compliance.length === 0)}
                onClick={exportProposalPackage}
              />
            )}
          </div>
        </section>
      )}

      {/* Output · Compliance Matrix / Response Requirements */}
      {/* In simple mode this (blank template export) is a secondary option —
          only when "More options" is expanded. Full-proposal mode always shows
          the compliance-matrix variant. */}
      {responseOutputsReady && driveMode === 'auto' && (!isSimpleResponseMode || showAdvancedOutputs) && (
        <section id={isSimpleResponseMode ? 'proposal-response-template' : undefined} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          {isSimpleResponseMode ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Output · Word Response Template</p>
                  <h2 className="text-lg font-semibold text-white">
                    {isRfqMode ? 'Create RFQ response template' : 'Create LOI response template'}
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {isRfqMode
                      ? 'RFQs usually need a clean quote/response document with blanks for pricing, submission details, and attachments — not a full compliance matrix.'
                      : 'Sources Sought and RFI responses use Mindy\'s curated LOI response structure. Mindy leaves user-specific details blank and reminds the user to attach an existing capability statement only when requested.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={exportProposalPackage}
                  disabled={exporting}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors flex items-center gap-2"
                >
                  {exporting && (
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {exporting ? 'Assembling…' : isRfqMode ? 'Export RFQ Template (.docx)' : 'Export LOI Template (.docx)'}
                </button>
              </div>

              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 text-sm text-slate-400">
                <p className="text-slate-200 font-medium mb-2">Template includes blanks for:</p>
                <ul className="space-y-1">
                  <li>• Date, attention line, agency address, reference / solicitation number</li>
                  <li>• LOI opening modeled after your sample</li>
                  <li>• Submittal intention, requested response content, and attachment checklist</li>
                  <li>• Company profile, UEI, CAGE, NAICS, small-business status, and responsible contact</li>
                  <li>• Three relevant experience blocks modeled after the curated LOI response pattern</li>
                  {isRfqMode && <li>• Quote / pricing fields that the user must complete manually</li>}
                </ul>
                {!isRfqMode && (
                  <a
                    href="/templates/loi-response-template.docx"
                    className="mt-3 inline-flex text-xs font-medium text-purple-300 underline decoration-purple-400/50 underline-offset-4 hover:text-purple-200"
                  >
                    View source LOI template
                  </a>
                )}
              </div>

              {exportError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 mt-3">
                  {exportError}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Output · Compliance Matrix</p>
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
                  {/* Calming priority summary (Eric: 172 raw rows is intimidating;
                      lead with what MATTERS — critical first, page-counts last). */}
                  {(() => {
                    const crit = compliance.filter(r => priorityOf({ requirement: r.requirement, category: r.category, section: r.section }) === 'critical').length;
                    const fin = compliance.filter(r => priorityOf({ requirement: r.requirement, category: r.category, section: r.section }) === 'final').length;
                    const std = compliance.length - crit - fin;
                    return (
                      <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4 mb-4">
                        <p className="text-sm text-slate-200 mb-3">
                          Mindy pulled <span className="font-semibold text-white">{compliance.length}</span> requirements from this solicitation. Don&apos;t let the number scare you — here&apos;s the order to tackle them:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <button onClick={() => setPriorityFilter('critical')} className={`text-left rounded-lg border p-2.5 transition-colors ${priorityFilter === 'critical' ? 'border-red-500/60 bg-red-500/10' : 'border-red-500/25 bg-red-500/[0.04] hover:bg-red-500/10'}`}>
                            <div className="font-semibold text-red-300">🔴 {crit} Critical</div>
                            <div className="text-slate-400 mt-0.5">Do these first — deadlines, required plans, certs. Miss one and you&apos;re out.</div>
                          </button>
                          <button onClick={() => setPriorityFilter('standard')} className={`text-left rounded-lg border p-2.5 transition-colors ${priorityFilter === 'standard' ? 'border-amber-500/60 bg-amber-500/10' : 'border-amber-500/25 bg-amber-500/[0.04] hover:bg-amber-500/10'}`}>
                            <div className="font-semibold text-amber-300">🟡 {std} Standard</div>
                            <div className="text-slate-400 mt-0.5">The real content — your technical, management, past performance.</div>
                          </button>
                          <button onClick={() => setPriorityFilter('final')} className={`text-left rounded-lg border p-2.5 transition-colors ${priorityFilter === 'final' ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-emerald-500/25 bg-emerald-500/[0.04] hover:bg-emerald-500/10'}`}>
                            <div className="font-semibold text-emerald-300">🟢 {fin} Final polish</div>
                            <div className="text-slate-400 mt-0.5">Save for last — page limits, fonts, formatting. After the draft is done.</div>
                          </button>
                        </div>
                        {priorityFilter !== 'all' && (
                          <button onClick={() => setPriorityFilter('all')} className="text-[11px] text-purple-400 hover:text-purple-300 mt-2">← Show all priorities</button>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                    <span className="text-slate-500">{compliance.length} requirement{compliance.length === 1 ? '' : 's'}</span>
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
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-20">ID</th>
                      <th className="text-left px-3 py-2 font-medium min-w-[280px]">Requirement</th>
                      <th className="text-left px-3 py-2 font-medium w-28">Category</th>
                      <th className="text-left px-3 py-2 font-medium w-24">Section</th>
                      <th className="text-left px-3 py-2 font-medium w-36">Drafted in</th>
                      <th className="text-left px-3 py-2 font-medium w-40">Owner</th>
                      <th className="text-left px-3 py-2 font-medium w-32">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompliance.map((r, i) => {
                      const cat = CATEGORY_LABELS[r.category] || CATEGORY_LABELS.other;
                      // Section group header when the top-level section changes.
                      const sectionGroup = (s?: string) => (s ? `Section ${(s.match(/^[A-Za-z]/)?.[0] || '?').toUpperCase()}` : 'Unsectioned');
                      const grp = sectionGroup(r.section);
                      const showGroup = i === 0 || sectionGroup(filteredCompliance[i - 1].section) !== grp;
                      return (
                        <Fragment key={r.id}>
                        {showGroup && (
                          <tr className="bg-slate-900/70">
                            <td colSpan={7} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-300 border-t border-slate-700">{grp}</td>
                          </tr>
                        )}
                        <tr className="border-t border-slate-800 hover:bg-slate-800/30 align-top">
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.id}</td>
                          <td className="px-3 py-2 text-slate-200">
                            {r.requirement}
                            {r.revised && (
                              <span className="ml-2 inline-block rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" title={`This requirement was revised by ${r.source_doc || 'an amendment'} — the current value is shown`}>
                                ⚠️ revised by {r.source_doc || 'amendment'}
                              </span>
                            )}
                            {!r.revised && r.source_doc && /Amendment/i.test(r.source_doc) && (
                              <span className="ml-2 text-[10px] text-blue-400/70" title="New requirement added by this amendment">+ {r.source_doc}</span>
                            )}
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
                          <td className="px-3 py-2 text-xs">
                            {(() => {
                              // Section alignment: which draft section answers
                              // this requirement, and is it drafted yet?
                              const aligned = alignRequirement({ requirement: r.requirement, category: r.category, section: r.section });
                              if (aligned === 'all') return <span className="text-slate-600" title="Cross-cutting (format / evaluation) — applies across the response">all sections</span>;
                              const hasDraft = !!drafts[aligned as SectionType]?.draft;
                              const label = sectionLabel(aligned as SectionType);
                              return (
                                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${hasDraft ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/10 text-amber-300/80'}`} title={hasDraft ? 'A draft exists for this section' : 'Not drafted yet'}>
                                  {hasDraft ? '✓' : '○'} {label}
                                </span>
                              );
                            })()}
                          </td>
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
                        </Fragment>
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
            </>
          )}
        </section>
      )}

      {/* Output · Draft Sections — in simple mode, show once the user has
          drafted (to review/edit individual sections) or expanded More options.
          The hero "Draft my response" button above is the primary entry. */}
      {uploadedRfp && !isRfqMode && driveMode === 'auto' && (!isSimpleResponseMode || showAdvancedOutputs || !!draftAllSummary || hasAnyDraft) && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">
                Output · {isLoiResponseMode ? 'Review & edit sections' : 'Draft Sections'}
              </p>
              <h2 className="text-lg font-semibold text-white">
                {isLoiResponseMode
                  ? 'LOI drafts grounded in the notice + your profile'
                  : 'First drafts grounded in the RFP + your profile'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isLoiResponseMode
                  ? 'Pick a section. Mindy uses the Sources Sought / RFI text and your saved profile to draft the letter of intent / response narrative. Attach your existing capability statement separately when the notice asks for one.'
                  : 'Pick a section. Mindy uses the source doc and your saved profile (NAICS, set-asides, target agencies) to write a first pass with [placeholders] for facts it shouldn\'t invent.'}
              </p>
            </div>
            {/* Draft Entire Proposal — two-pass generation. Outlines all
                sections in one cheap call, then parallel-writes them.
                Drops ~5min of sequential clicking into ~30s. */}
            <button
              onClick={generateAllDrafts}
              disabled={draftAllLoading || !!draftLoading}
              className="px-4 py-2 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white text-sm font-semibold rounded-lg shadow-lg shadow-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              title="Outline + write all sections in parallel — ~30 seconds for the entire proposal"
            >
              {draftAllLoading
                ? <>⏳ Drafting all sections…</>
                : <>✨ Draft Entire {isLoiResponseMode ? 'LOI Response' : 'Proposal'}</>}
            </button>
          </div>

          {draftAllSummary && !draftAllLoading && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 mb-3 text-sm">
              <span className="text-emerald-200">
                ✅ Drafted {draftAllSummary.count} section{draftAllSummary.count === 1 ? '' : 's'} in {Math.round(draftAllSummary.ms / 1000)}s
                {draftAllSummary.errors > 0 && ` (${draftAllSummary.errors} section${draftAllSummary.errors === 1 ? '' : 's'} failed — try those individually)`}
              </span>
            </div>
          )}

          {draftError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 mb-3">
              {draftError}
            </div>
          )}

          {/* Vault empty-state nudge — fires when user has no vault
              data so drafts will use [placeholders] for facts they
              could have stored. Lock-in tee-up. */}
          {vaultSummary &&
            !vaultSummary.hasIdentity &&
            vaultSummary.past_performance === 0 &&
            vaultSummary.capabilities === 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 mb-3 flex items-start gap-3">
                <span className="text-2xl">🗂️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-200">
                    Want drafts that cite YOUR real past performance + capabilities?
                  </p>
                  <p className="text-xs text-amber-100/70 mt-0.5">
                    Add your past contracts, capabilities, and team to <span className="font-medium">My Vault</span> (Account → My Vault, ~2 min).
                    Mindy will weave them in instead of using [bracketed placeholders].
                  </p>
                </div>
              </div>
            )}

          {/* Section tabs — RFP set OR LOI/response set
              based on detected notice type. */}
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 mb-4 -mx-1 px-1">
            {currentSectionTabs.map(tab => {
              const hasDraft = !!drafts[tab.id];
              const isActive = activeSection === tab.id;
              // How many compliance requirements this section must cover (align).
              const reqCount = compliance.filter(r =>
                alignRequirement({ requirement: r.requirement, category: r.category, section: r.section }) === tab.id
              ).length;
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
                  title={reqCount > 0 ? `Covers ${reqCount} compliance requirement${reqCount === 1 ? '' : 's'}` : undefined}
                >
                  {tab.label}
                  {reqCount > 0 && <span className="ml-1.5 text-[10px] text-amber-300/80" title={`${reqCount} requirements map here`}>{reqCount}</span>}
                  {hasDraft && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                </button>
              );
            })}
          </div>

          {/* Active section pane */}
          {(() => {
            const meta = currentSectionTabs.find(t => t.id === activeSection)!;
            // Safety: if activeSection isn't in the current set
            // (race between mode-switch effect + render), bail.
            if (!meta) return null;
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
            Edits live in this session only. Use Export Package below to bundle the package as a Word doc.
          </p>
        </section>
      )}

      {/* Output · Review Checklist + Export */}
      {uploadedRfp && !isRfqMode && driveMode === 'auto' && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Output · Review &amp; Export</p>
              <h2 className="text-lg font-semibold text-white">
                {isLoiResponseMode
                  ? 'Export LOI response package'
                  : 'Final compliance review + Word export'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isLoiResponseMode
                  ? 'Export the LOI / Sources Sought response draft. If the notice asks for a capability statement, attach your existing capability statement as a separate document.'
                  : 'Walk the checklist before you ship. Then export a single .docx containing the compliance matrix, drafted sections, and the checklist appendix.'}
              </p>
            </div>
            {!isLoiResponseMode && (
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{checklistChecked}<span className="text-slate-500 text-base font-normal">/{checklist.length}</span></div>
                <div className="text-xs text-slate-500">items confirmed</div>
              </div>
            )}
          </div>

          {/* Compliance Referee — independent Claude check (Eric's vision). */}
          {!isLoiResponseMode && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 mb-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">⚖️ Independent Compliance Check</h3>
                  <p className="text-xs text-slate-400 mt-0.5">A separate AI reviewer checks your draft against every requirement — catches gaps before a Contracting Officer does.</p>
                </div>
                <button
                  onClick={runReferee}
                  disabled={refereeRunning}
                  className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
                >
                  {refereeRunning ? 'Checking…' : refereeResult ? 'Re-check' : 'Run check'}
                </button>
              </div>
              {refereeError && <div className="text-xs text-red-300 mt-2">{refereeError}</div>}
              {refereeResult && (
                <div className="mt-3">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="text-2xl font-bold text-white">{refereeResult.summary.score}%<span className="text-xs font-normal text-slate-500 ml-1">compliant</span></div>
                    <div className="flex gap-3 text-xs">
                      <span className="text-emerald-400">✓ {refereeResult.summary.met} met</span>
                      <span className="text-amber-400">◐ {refereeResult.summary.partial} partial</span>
                      <span className="text-red-400">✗ {refereeResult.summary.missing} missing</span>
                    </div>
                  </div>
                  {/* Show the gaps first — what needs fixing before submission. */}
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {[...refereeResult.verdicts]
                      .sort((a, b) => ({ missing: 0, partial: 1, met: 2 }[a.status] - { missing: 0, partial: 1, met: 2 }[b.status]))
                      .map(v => (
                        <div key={v.id} className="flex gap-2 text-xs">
                          <span className={`shrink-0 ${v.status === 'met' ? 'text-emerald-400' : v.status === 'partial' ? 'text-amber-400' : 'text-red-400'}`}>
                            {v.status === 'met' ? '✓' : v.status === 'partial' ? '◐' : '✗'}
                          </span>
                          <div>
                            <span className="text-slate-300">{v.requirement}</span>
                            {v.evidence && <span className="text-slate-500"> — {v.evidence}</span>}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isLoiResponseMode ? (
            <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 mb-4">
              <p className="text-sm font-medium text-slate-200 mb-2">Before submitting:</p>
              <ul className="space-y-1 text-sm text-slate-400">
                {SS_RFI_PACKAGE_NOTES.map(note => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </div>
          ) : (
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
          )}

          <div className="border-t border-slate-800 pt-4 mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="text-sm text-slate-400">
                <p className="text-slate-300 font-medium mb-1">Package will include:</p>
                <ul className="space-y-0.5 text-xs">
                  <li>• Title page + table of contents</li>
                  {!isLoiResponseMode && (
                    <li className={compliance.length > 0 ? 'text-emerald-400' : 'text-slate-600'}>
                      {compliance.length > 0 ? '✓' : '○'} Compliance Matrix ({compliance.length} requirements)
                    </li>
                  )}
                  {currentSectionTabs.map(tab => {
                    const has = !!drafts[tab.id]?.draft;
                    return (
                      <li key={tab.id} className={has ? 'text-emerald-400' : 'text-slate-600'}>
                        {has ? '✓' : '○'} {tab.label}{has && drafts[tab.id]?.wordCount ? ` (${drafts[tab.id]!.wordCount} words)` : ''}
                      </li>
                    );
                  })}
                  {isLoiResponseMode ? (
                    <li className="text-slate-400">• Attach existing capability statement separately if required</li>
                  ) : (
                    <li className="text-emerald-400">
                      ✓ Review Checklist ({checklistChecked}/{checklist.length} complete)
                    </li>
                  )}
                </ul>
              </div>
              <button
                type="button"
                onClick={exportProposalPackage}
                disabled={exporting || (!hasAnyDraft && (!compliance.length || isLoiResponseMode))}
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

            {!hasAnyDraft && (isLoiResponseMode || compliance.length === 0) && !exporting && (
              <p className="text-xs text-slate-500">
                {isLoiResponseMode
                  ? 'Draft at least one LOI response section before exporting.'
                  : 'Generate at least the compliance matrix or one section before exporting.'}
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

      {!activePursuitId && !uploadedRfp && (opportunities.length === 0 ? (
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
      ))}
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

function OutputActionCard({
  eyebrow,
  title,
  description,
  status,
  buttonLabel,
  disabled,
  onClick,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  buttonLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex min-h-52 flex-col justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-300">{eyebrow}</p>
          <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
            {status}
          </span>
        </div>
        <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="mt-4 w-full rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        {buttonLabel}
      </button>
    </div>
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
