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
import BidDecisionGate from './BidDecisionGate';
import { alignRequirement, priorityOf, type ReqPriority } from '@/lib/proposal/section-alignment';
import { Zap, Gauge } from 'lucide-react';

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

const COMPLIANCE_PROGRESS_MESSAGES = [
  'Reading the solicitation text…',
  'Scanning instructions to offerors (Section L)…',
  'Extracting every shall / must / required clause…',
  'Pulling evaluation factors (Section M)…',
  'Checking submission deadlines and page limits…',
  'Organizing requirements into your matrix…',
] as const;

// Steps shown while Mindy drafts the response (generateAllDrafts is one server
// call, so this is a believable timed narration of the work — Eric, Jun 26:
// "show something on screen so users know what's going on, like the aha moment").
const DRAFT_PROGRESS_MESSAGES = [
  'Reading the solicitation and your uploaded documents…',
  'Mapping the requirements to each section…',
  'Pulling your past performance and capabilities from your profile…',
  'Drafting your cover letter…',
  'Writing your relevant experience and capability fit…',
  'Tailoring the language to this agency and notice…',
  'Checking it addresses every requirement…',
  'Assembling your response package…',
] as const;

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
  const [pursuitSearch, setPursuitSearch] = useState('');   // #45 searchable picker
  const [pickerOpen, setPickerOpen] = useState(false);
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
  // Sources Sought response: arrived from the dashboard "🔥 Hot right now" card's
  // "Respond to this Sources Sought" button — frame the draft around that notice.
  const contextNoticeTitle = typeof panelContext?.title === 'string' && panelContext?.isSourcesSought
    ? panelContext.title
    : null;
  const contextNoticeAgency = typeof panelContext?.agency === 'string' ? panelContext.agency : null;
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
  const activePursuitTitle = useMemo(
    () => opportunities.find((opp) => opp.id === activePursuitId)?.title ?? null,
    [opportunities, activePursuitId]
  );
  const activePursuitNotice = useMemo(
    // Pass the title too: an OTA "Request for Project Proposal" filed as a Special
    // Notice IS biddable — the classifier checks the title for proposal-request intent.
    () => classifyNoticeType(activePursuitNoticeType, activePursuitTitle),
    [activePursuitNoticeType, activePursuitTitle]
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

  // Load workspace teammates so requirements can be assigned to real people
  // (the assignee field suggests them). Falls back to free-text for solo users.
  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.success || !Array.isArray(d.members)) return;
        // mi_beta_team_members rows carry user_email (the joined member) and/or
        // invited_email (the invite). Collect both so every teammate shows up.
        const emails = d.members
          .flatMap((m: Record<string, unknown>) => [String(m.user_email || ''), String(m.invited_email || '')])
          .filter(Boolean);
        // include self so you can assign to yourself
        setTeamMembers(Array.from(new Set([email, ...emails])));
      })
      .catch(() => {});
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
  const [complianceProgressIdx, setComplianceProgressIdx] = useState(0);
  const [complianceElapsedSec, setComplianceElapsedSec] = useState(0);
  const complianceSectionRef = useRef<HTMLElement | null>(null);
  const complianceStartedAtRef = useRef<number | null>(null);
  // Workspace teammates (for the assignee dropdown) + a "my items" filter.
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [myItemsOnly, setMyItemsOnly] = useState(false);
  // Pagination for large matrices (200+ requirement RFPs).
  const COMPLIANCE_PAGE_SIZE = 50;
  const [compliancePage, setCompliancePage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | ComplianceStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ComplianceCategory>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | ReqPriority>('all');
  const [bidProceeded, setBidProceeded] = useState(false); // Step-1 bid decision made

  // Pre-submission compliance scan — "will this proposal get thrown out?".
  // Checks the current drafts against the compliance matrix for DQ mistakes.
  type ScanFinding = { rule: string; severity: 'dq' | 'warning' | 'info'; title: string; detail: string; requirement?: string; section?: string };
  const [scanResult, setScanResult] = useState<{ findings: ScanFinding[]; counts: { dq: number; warning: number; info: number }; atRisk: boolean } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const generateCompliance = useCallback(async () => {
    if (!email || !uploadedRfp) return;
    setComplianceLoading(true);
    setComplianceError(null);
    setComplianceProgressIdx(0);
    setComplianceElapsedSec(0);
    complianceStartedAtRef.current = Date.now();
    requestAnimationFrame(() => {
      complianceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
      // Persist the matrix to the pursuit so it survives reload + is team-shared.
      // The route preserves any owner/status already set on unchanged rows, so a
      // re-extraction is non-destructive. Best-effort.
      if (activePursuitId && rows.length) {
        fetch(`/api/app/proposal/compliance-state?email=${encodeURIComponent(email)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ pipeline_id: activePursuitId, requirements: rows.map(r => ({ req_key: r.id, requirement: r.requirement, category: r.category, section: r.section, source_quote: r.source_quote, source_doc: r.source_doc, revised: r.revised })) }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Compliance generation failed:', err);
      setComplianceError('Request failed. Try again.');
    } finally {
      setComplianceLoading(false);
      complianceStartedAtRef.current = null;
    }
  }, [email, uploadedRfp, getAuthHeaders, activePursuitId]);

  // Load the SAVED compliance matrix when a pursuit opens — fixes "it re-runs and
  // resets every time" and surfaces teammates' owner/status. Only loads when the
  // matrix isn't already populated (don't clobber an in-progress generation).
  useEffect(() => {
    if (!email || !activePursuitId) return;
    let cancelled = false;
    fetch(`/api/app/proposal/compliance-state?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(activePursuitId)}`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.success || !data.saved) return;
        const rows: ComplianceRequirementRow[] = (data.requirements || []).map((r: Record<string, unknown>) => ({
          id: String(r.req_key || ''),
          requirement: String(r.requirement || ''),
          category: (r.category as ComplianceCategory) || 'other',
          section: (r.section as string) || undefined,
          source_quote: (r.source_quote as string) || undefined,
          source_doc: (r.source_doc as string) || undefined,
          revised: Boolean(r.revised),
          owner: String(r.owner || ''),
          status: (r.status as ComplianceStatus) || 'open',
        }));
        // Only hydrate if we don't already have a (freshly generated) matrix.
        setCompliance(prev => (prev.length > 0 ? prev : rows));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // activePursuitId is the trigger; intentionally not depending on `compliance`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, activePursuitId, getAuthHeaders]);

  useEffect(() => {
    if (!complianceLoading) {
      setComplianceElapsedSec(0);
      return;
    }
    const tick = setInterval(() => {
      if (complianceStartedAtRef.current) {
        setComplianceElapsedSec(Math.floor((Date.now() - complianceStartedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [complianceLoading]);

  useEffect(() => {
    if (!complianceLoading) return;
    const interval = setInterval(() => {
      setComplianceProgressIdx(i => (i + 1) % COMPLIANCE_PROGRESS_MESSAGES.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [complianceLoading]);


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
    // Persist owner/status changes (the team check-off) so they survive reload
    // and are visible to teammates. Best-effort — a save failure doesn't block
    // the optimistic UI update. Only when working a saved pursuit.
    if (email && activePursuitId && ('owner' in patch || 'status' in patch)) {
      fetch(`/api/app/proposal/compliance-state?email=${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ pipeline_id: activePursuitId, req_key: id, owner: patch.owner, status: patch.status }),
      }).catch(() => {});
    }
  }, [email, activePursuitId, getAuthHeaders]);

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
        // Send pipeline_id so the export pulls the CLASSIFIED SOW doc, not the
        // combined 11-doc blob (Eric QC: was extracting a 507-page mashup).
        body: JSON.stringify({ email, text, fileName: uploadedRfp?.fileName || 'solicitation', pipeline_id: activePursuitId || undefined }),
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
    const me = (email || '').toLowerCase();
    const rows = compliance.filter(r => {
      if (myItemsOnly && (r.owner || '').toLowerCase() !== me) return false;
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
  }, [compliance, statusFilter, categoryFilter, priorityFilter, myItemsOnly, email]);

  // Pagination: a 200-requirement RFP shouldn't render as one giant scroll.
  const complianceTotalPages = Math.max(1, Math.ceil(filteredCompliance.length / COMPLIANCE_PAGE_SIZE));
  const safePage = Math.min(compliancePage, complianceTotalPages - 1);
  const pagedCompliance = useMemo(
    () => filteredCompliance.slice(safePage * COMPLIANCE_PAGE_SIZE, safePage * COMPLIANCE_PAGE_SIZE + COMPLIANCE_PAGE_SIZE),
    [filteredCompliance, safePage],
  );
  // Reset to page 0 whenever the filtered set changes (filter/regenerate).
  useEffect(() => { setCompliancePage(0); }, [statusFilter, categoryFilter, priorityFilter, myItemsOnly, compliance.length]);

  // Team progress roll-up across the WHOLE matrix (not just the filtered view).
  const complianceProgress = useMemo(() => {
    const total = compliance.length;
    const done = compliance.filter(r => r.status === 'done').length;
    const inProgress = compliance.filter(r => r.status === 'in_progress').length;
    const na = compliance.filter(r => r.status === 'n_a').length;
    const open = total - done - inProgress - na;
    const assignable = total - na;
    const pct = assignable > 0 ? Math.round((done / assignable) * 100) : 0;
    const unassigned = compliance.filter(r => !r.owner?.trim() && r.status !== 'n_a').length;
    return { total, done, inProgress, na, open, pct, unassigned };
  }, [compliance]);

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
  // Show the compliance-matrix variant of the output section whenever we're in a
  // full-proposal flow OR the user has elected to build a matrix in a simple flow
  // (RFQ/LOI). The matrix is an always-available option (Eric, Jun 26).
  // The compliance matrix is overkill for a Sources Sought / RFI — it's market
  // research, not a solicitation with shall/must clauses (Eric, Jun 26: "hide by
  // default for sources sought"). Show the matrix for full proposals + RFQ, but
  // never auto-surface it for LOI mode even if one was generated.
  const showComplianceMatrix = !isSimpleResponseMode || (!isLoiResponseMode && (compliance.length > 0 || complianceLoading));
  // User-facing label for the notice type. Prefer SAM's authoritative
  // classification (e.g. "Combined Synopsis") over the internal simple-mode flag,
  // so a Combined Synopsis/Solicitation that cites an "RFQ ####" in its body isn't
  // mislabeled "RFQ" (Eric, Jun 26). Falls back to the mode label when SAM gives
  // nothing. The internal isRfqMode flag still drives the flow — this is display only.
  const noticeDisplayLabel = noticeTypeLabel(activePursuitNoticeType)
    || (isRfqMode ? 'RFQ' : isLoiResponseMode ? (effectiveNoticeType === 'rfi' ? 'RFI' : 'Sources Sought') : 'Proposal');
  const proposalFlowName = isLoiResponseMode ? 'LOI Response' : isRfqMode ? `${noticeDisplayLabel} Response` : 'Proposal';
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

  // Pre-submission scan: check the current drafts against the compliance matrix
  // for DQ mistakes (missing required plan, over page limit, unaddressed eval
  // factor, deadline/portal/eligibility reminders). Deterministic + fast.
  const runComplianceScan = useCallback(async () => {
    if (!email || compliance.length === 0) {
      setScanError('Generate the compliance matrix first — the scan checks your draft against it.');
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const sections = currentSectionTabs
        .map(tab => ({ label: tab.label, text: drafts[tab.id]?.draft || '' }))
        .filter(s => s.text.trim());
      const draftText = sections.map(s => s.text).join('\n\n');
      if (!draftText.trim()) {
        setScanError('No drafted sections to scan yet. Draft your response, then run the check.');
        setScanning(false);
        return;
      }
      const res = await fetch(`/api/app/proposal/scan?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          requirements: compliance.map(c => ({ id: c.id, requirement: c.requirement, category: CATEGORY_LABELS[c.category]?.label || c.category, section: c.section })),
          draftText,
          sections,
          // Bidder set-asides aren't loaded in this panel; omit so the scanner
          // surfaces set-aside as a "confirm it's active" reminder rather than
          // risking a false DQ. (The vault knows the certs; a later pass can pass them.)
          bidderSetAsides: [],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setScanError(data?.error || 'Scan failed. Try again.');
        return;
      }
      setScanResult({ findings: data.findings || [], counts: data.counts || { dq: 0, warning: 0, info: 0 }, atRisk: !!data.atRisk });
    } catch {
      setScanError('Request failed. Try again.');
    } finally {
      setScanning(false);
    }
  }, [email, compliance, currentSectionTabs, drafts, getAuthHeaders]);

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
  const [draftAllProgressIdx, setDraftAllProgressIdx] = useState(0);
  const [draftAllElapsedSec, setDraftAllElapsedSec] = useState(0);
  const draftAllStartedAtRef = useRef<number | null>(null);
  // Lets the user STOP a running "Draft all" — aborts the in-flight fetch so the
  // request is genuinely cancelled (not just visually), and the button unlocks.
  const draftAllAbortRef = useRef<AbortController | null>(null);
  const [draftAllCancelled, setDraftAllCancelled] = useState(false);
  const reviewSectionRef = useRef<HTMLElement | null>(null);

  // Drive the drafting progress card (elapsed timer + cycling step) — same engine
  // as the compliance matrix progress so "Draft my response" shows visible work
  // instead of sitting silent (Eric, Jun 26).
  useEffect(() => {
    if (!draftAllLoading) {
      setDraftAllElapsedSec(0);
      return;
    }
    const tick = setInterval(() => {
      if (draftAllStartedAtRef.current) {
        setDraftAllElapsedSec(Math.floor((Date.now() - draftAllStartedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [draftAllLoading]);

  useEffect(() => {
    if (!draftAllLoading) return;
    const interval = setInterval(() => {
      setDraftAllProgressIdx(i => (i + 1) % DRAFT_PROGRESS_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [draftAllLoading]);

  const scrollToReview = useCallback(() => {
    setShowAdvancedOutputs(true);
    requestAnimationFrame(() => {
      reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const generateDraft = useCallback(async (sectionType: SectionType) => {
    if (!email || !uploadedRfp) return;
    setDraftLoading(sectionType);
    setDraftError(null);
    try {
      const res = await fetch(`/api/app/proposal/draft?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text: uploadedRfp.text, fileName: uploadedRfp.fileName, sectionType, requirements: compliance.map(c => ({ id: c.id, requirement: c.requirement, category: CATEGORY_LABELS[c.category]?.label || c.category, section: c.section })) }),
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
  }, [email, uploadedRfp, getAuthHeaders, compliance]);

  // Draft ALL sections at once via the two-pass /draft-all endpoint.
  // Content Reaper pattern #2 — outline + parallel write. Takes
  // ~30-60s total instead of 5+ minutes of sequential clicks.
  const generateAllDrafts = useCallback(async () => {
    if (!email) return;
    // Be HONEST when there's no source text instead of dead-clicking
    // (Eric QC 2026-06-13: "click, nothing happens"). The notice-body
    // fallback in /api/app/proposal/pursuit-docs should populate uploadedRfp
    // for Sources Sought notices with no attachments, but if it's still
    // empty, tell the user what to do rather than silently returning.
    if (!uploadedRfp || !uploadedRfp.text?.trim()) {
      setDraftError('No notice text loaded yet. Paste the SAM notice text or upload the solicitation below, then draft.');
      return;
    }
    setDraftAllLoading(true);
    setDraftError(null);
    setDraftAllSummary(null);
    setDraftAllProgressIdx(0);
    setDraftAllElapsedSec(0);
    setDraftAllCancelled(false);
    draftAllStartedAtRef.current = Date.now();
    const controller = new AbortController();
    draftAllAbortRef.current = controller;
    try {
      const res = await fetch(`/api/app/proposal/draft-all?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        signal: controller.signal,
        body: JSON.stringify({
          text: uploadedRfp.text,
          fileName: uploadedRfp.fileName,
          // Match the tabs the user sees (LOI vs RFP) — don't rely on text
          // heuristics alone or drafts land under the wrong section keys.
          sectionTypes: currentSectionTabs.map(tab => tab.id),
          // #5: send the compliance matrix so each drafted section is told which
          // requirements it must cover. Empty when no matrix yet — drafting still works.
          requirements: compliance.map(c => ({ id: c.id, requirement: c.requirement, category: CATEGORY_LABELS[c.category]?.label || c.category, section: c.section })),
        }),
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
      setShowAdvancedOutputs(true);
      requestAnimationFrame(() => {
        reviewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err) {
      // A user-initiated Stop shows a neutral notice, not a scary error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        setDraftAllCancelled(true);
      } else {
        console.error('Draft-all failed:', err);
        setDraftError('Request failed. Try again.');
      }
    } finally {
      draftAllAbortRef.current = null;
      setDraftAllLoading(false);
    }
  }, [email, uploadedRfp, getAuthHeaders, currentSectionTabs, compliance]);

  // Stop a running "Draft all" — aborts the fetch so it's genuinely cancelled.
  // Sections already returned before Stop stay in place (nothing to undo); the
  // request in flight is dropped and the UI unlocks immediately.
  const cancelDraftAll = useCallback(() => {
    draftAllAbortRef.current?.abort();
  }, []);

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

    // Word .doc (HTML-based) — people want Word, not markdown (Eric, Jun 26). An
    // HTML doc with the msword MIME opens natively in Word + Google Docs, no server
    // round-trip. Light markdown → HTML so headings/bold/bullets carry over.
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (s: string) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>');
    const out: string[] = [];
    let inList = false;
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    for (const raw of (d.draft || '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line.trim()) { closeList(); continue; }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const b = line.match(/^[-*]\s+(.*)$/);
      if (b) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(b[1])}</li>`); continue; }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    closeList();
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${esc(label)}</title></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;"><h2>${esc(label)}</h2>${out.join('')}</body></html>`;

    const blob = new Blob(['﻿', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}-${label.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.doc`;
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
  // LOI on-screen preview (review before exporting .docx) — Eric QC: "drafted the
  // LOI but no button to open and review."
  const [loiPreview, setLoiPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const hasAnyDraft = useMemo(
    () => currentSectionTabs.some(t => !!drafts[t.id]?.draft),
    [drafts, currentSectionTabs]
  );

  const exportProposalPackage = useCallback(async (opts?: { idiq?: boolean; rfp?: boolean }) => {
    if (!email) return;
    // The IDIQ package is built from the compliance matrix, so it needs that
    // (not an uploaded RFP / simple-response mode). Other exports keep their guard.
    if (opts?.idiq || opts?.rfp) {
      if (compliance.length === 0) { setExportError('Generate the compliance matrix first — the response structure is built from it.'); return; }
    } else if (!uploadedRfp && !isSimpleResponseMode) {
      return;
    }
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
          // Real solicitation body — lets the RFP export detect Section L/M /
          // volume structure (filename alone never carries those signals).
          rfpSourceText: uploadedRfp?.text || undefined,
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
          packageType: opts?.idiq ? 'idiq_proposal' : opts?.rfp ? 'rfp_response' : isLoiResponseMode ? 'sources_sought_loi' : isRfqMode ? 'rfq_response' : 'proposal',
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

  // Preview the assembled LOI on-screen (?format=text) BEFORE exporting .docx.
  const previewLoi = useCallback(async () => {
    if (!email) return;
    setPreviewing(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/app/proposal/export?email=${encodeURIComponent(email)}&format=text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          packageType: 'sources_sought_loi',
          loiFields: loiFields || undefined,
          rfpFileName: exportContextName,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.letter) {
        setExportError(data?.error || 'Could not generate the preview. Try again.');
        return;
      }
      setLoiPreview(data.letter as string);
    } catch (err) {
      console.error('LOI preview failed:', err);
      setExportError('Request failed. Try again.');
    } finally {
      setPreviewing(false);
    }
  }, [email, getAuthHeaders, loiFields, exportContextName]);

  const exportComplianceExcel = useCallback(() => {
    if (compliance.length === 0) return;
    // True Excel (.xls) via an Excel-openable HTML table — Eric wants the matrix as
    // Excel, separate from the Word package (Jun 26). HTML-table .xls opens natively
    // in Excel + Google Sheets with no library/bundle bloat, and keeps a named tab.
    const headers = ['ID', 'Requirement', 'Category', 'Section', 'Owner', 'Status', 'Source'];
    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = compliance.map(r => `<tr>`
      + `<td>${esc(r.id)}</td>`
      + `<td>${esc(r.requirement)}</td>`
      + `<td>${esc(CATEGORY_LABELS[r.category]?.label || r.category)}</td>`
      + `<td>${esc(r.section || '')}</td>`
      + `<td>${esc(r.owner)}</td>`
      + `<td>${esc(STATUS_LABELS[r.status])}</td>`
      + `<td>${esc(r.source_quote || '')}</td>`
      + `</tr>`).join('');
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'>`
      + `<head><meta charset='utf-8'>`
      + `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Compliance Matrix</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->`
      + `</head><body><table border="1"><thead><tr>${headers.map(h => `<th style="background:#eee">${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const blob = new Blob(['﻿', html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (uploadedRfp?.fileName || 'rfp').replace(/[^a-z0-9-_.]/gi, '_');
    link.download = `compliance-${safeName}-${new Date().toISOString().split('T')[0]}.xls`;
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
      const activeRaw = (data.opportunities || []).filter((opp: PipelineOpportunity & { is_archived?: boolean }) => (
        !opp.is_archived && !isTerminalPipelineStage(opp.stage)
      ));
      // Dedupe — the same notice can be saved to the pipeline more than once,
      // which made the picker list it twice (Eric). Key by notice_id, else title.
      const seenKeys = new Set<string>();
      const active = (activeRaw as PipelineOpportunity[]).filter((opp) => {
        const key = (opp.notice_id || opp.title || opp.id || '').toLowerCase().trim();
        if (!key || seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
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
  //
  // Extracted into a callback (not an inline effect) so the "Retry" button on a
  // stuck/failed auto-load can re-run it without a full panel reload — e.g. when
  // SAM attachments are still downloading (docs_status='fetching'). Returns a
  // cleanup fn that cancels the in-flight request.
  const loadPursuitDocs = useCallback((): (() => void) => {
    const pursuitId = activePursuitId;
    if (!pursuitId || !email) return () => {};

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

  // Auto-load when the active pursuit changes; cleanup cancels any in-flight call.
  useEffect(() => {
    const cleanup = loadPursuitDocs();
    return cleanup;
  }, [loadPursuitDocs]);

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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white">Proposal Assist</h1>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-purple-500/20 text-purple-300 border border-purple-500/30">
              BETA
            </span>
          </div>
          <p className="text-slate-400 mt-1">
            {activePursuitId
              ? `${proposalFlowName} workspace for ${activePursuit?.title || 'this pursuit'}.`
              : 'Start from a saved pursuit or upload a source document to prepare the response.'}
          </p>
          <p className="text-xs text-amber-300/80 mt-1.5">
            A starting draft, not a finished submission — review, edit, and add your own proof before you submit.
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

      {complianceLoading && (
        <ComplianceMatrixProgress
          charCount={uploadedRfp?.charCount || uploadedRfp?.text?.length || 0}
          elapsedSec={complianceElapsedSec}
          messageIdx={complianceProgressIdx}
          hasPursuit={!!activePursuitId}
          compact
        />
      )}

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
          <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">① Start here</p>
          <h2 className="text-lg font-semibold text-white mb-1">Start from a saved pursuit</h2>
          <p className="text-sm text-slate-400 mb-3">
            Pick one of your live pursuits and click <span className="text-purple-300 font-medium">Open workbench</span> — Mindy pulls the cached SAM documents and opens your workbench below. (No pursuit? Skip to ② and upload a document directly.)
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {/* Searchable pursuit picker (#45) — the native <select> piled up
                into an unscannable list. Search + a clean dropdown with notice-
                type chip + agency. */}
            <div className="relative flex-1 min-w-[260px]">
              <input
                value={pickerOpen ? pursuitSearch : (opportunities.find(o => o.id === selectedId)?.title || '')}
                onChange={(e) => { setPursuitSearch(e.target.value); setPickerOpen(true); }}
                onFocus={() => { setPickerOpen(true); setPursuitSearch(''); }}
                placeholder={`Search ${opportunities.length} saved pursuits…`}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
              />
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                    {(() => {
                      const q = pursuitSearch.trim().toLowerCase();
                      const matches = (o: PipelineOpportunity) =>
                        !q || `${o.title} ${o.agency || ''} ${noticeTypeLabel(o.notice_type) || ''}`.toLowerCase().includes(q);

                      // Rank: actively-worked stages first, then by soonest deadline
                      // (#56 — Eric: users bid 3-8 at a time but save many; show the
                      // few they're working, search reveals the rest).
                      const STAGE_RANK: Record<string, number> = { bidding: 0, pursuing: 1, submitted: 2, tracking: 3 };
                      const rank = (o: PipelineOpportunity) => STAGE_RANK[o.stage || 'tracking'] ?? 4;
                      const deadline = (o: PipelineOpportunity) => o.response_deadline ? new Date(o.response_deadline).getTime() : Infinity;
                      const sorted = [...opportunities].sort((a, b) => rank(a) - rank(b) || deadline(a) - deadline(b));

                      const renderRow = (opp: PipelineOpportunity) => {
                        const nt = noticeTypeLabel(opp.notice_type);
                        const active = opp.stage === 'bidding' || opp.stage === 'pursuing';
                        return (
                          <button
                            key={opp.id}
                            type="button"
                            onClick={() => { setSelectedId(opp.id); setPickerOpen(false); setPursuitSearch(''); }}
                            className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-800 ${selectedId === opp.id ? 'bg-purple-500/10' : ''}`}
                          >
                            {nt && <span className="mt-0.5 shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">{nt}</span>}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-slate-200">{opp.title}</span>
                              {opp.agency && <span className="block truncate text-[11px] text-slate-500">{opp.agency}</span>}
                            </span>
                            {active && <span className="mt-0.5 shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 capitalize">{opp.stage}</span>}
                          </button>
                        );
                      };

                      // No search → show ACTIVE group first (the short list users work),
                      // then a divider, then the rest. With a search → flat filtered list.
                      if (!q) {
                        const active = sorted.filter(o => o.stage === 'bidding' || o.stage === 'pursuing');
                        const rest = sorted.filter(o => !(o.stage === 'bidding' || o.stage === 'pursuing'));
                        return (
                          <>
                            {active.length > 0 && (
                              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-emerald-400/70">Active ({active.length})</div>
                            )}
                            {active.map(renderRow)}
                            {active.length > 0 && rest.length > 0 && (
                              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-600 border-t border-slate-800">All saved ({rest.length}) — type to search</div>
                            )}
                            {rest.map(renderRow)}
                          </>
                        );
                      }
                      const filtered = sorted.filter(matches);
                      if (filtered.length === 0) return <div className="px-3 py-3 text-xs text-slate-500">No pursuit matches “{pursuitSearch}”.</div>;
                      return filtered.map(renderRow);
                    })()}
                  </div>
                </>
              )}
            </div>
            {(() => {
              const picked = opportunities.find(o => o.id === selectedId);
              const respondable = classifyNoticeType(picked?.notice_type, picked?.title).respondability !== 'none';
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
            const { label, respondability } = classifyNoticeType(picked?.notice_type, picked?.title);
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
        {/* Step cue (#55 — Eric: the start screen looked like Open workbench did
            nothing because the docs section sat below it with no relationship).
            Make it an explicit numbered step that reflects whether a pursuit is
            open yet. */}
        <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${activePursuitId ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300' : 'border-purple-500/30 bg-purple-500/[0.06] text-purple-200'}`}>
          {activePursuitId
            ? '✓ Workbench open — add or extract your documents below, then generate the outputs.'
            : '② This is your workbench. Pick a pursuit above and click “Open workbench”, or upload a document right here to start — Mindy reads it either way.'}
        </div>
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
            <div data-tour="proposals-mode" className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 p-1 text-sm">
              <span className="pl-2 text-xs text-slate-500">Mode:</span>
              <button
                onClick={() => setDriveMode('auto')}
                className={`px-3 py-1.5 rounded-md transition-colors ${driveMode === 'auto' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title="Mindy drafts a first pass of each section — you review, fill placeholders, and finalize"
              >
                <Zap className="w-3.5 h-3.5 inline" strokeWidth={2} /> Auto
              </button>
              <button
                onClick={() => setDriveMode('manual')}
                className={`px-3 py-1.5 rounded-md transition-colors ${driveMode === 'manual' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title="You drive — upload files + chat to write the proposal yourself"
              >
                <Gauge className="w-3.5 h-3.5 inline" strokeWidth={2} /> Manual · Sport
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {driveMode === 'auto' ? 'Auto: Mindy drafts it for you (safe mode).' : 'Sport: you direct Mindy with your own files.'}
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

        {/* Sources Sought response banner — appears when the user clicked
            "Respond to this Sources Sought" on the dashboard hot card. Frames the
            draft around that notice; they paste/upload the SS text below to begin. */}
        {contextNoticeTitle && !uploadedRfp && (
          <div className="mb-4 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 text-sm text-purple-100">
            <span className="font-semibold">Responding to a Sources Sought:</span>{' '}
            {contextNoticeTitle}
            {contextNoticeAgency && <span className="text-purple-300/80"> · {contextNoticeAgency}</span>}
            <p className="mt-1 text-xs text-purple-300/80">
              Paste or upload the notice text below and Mindy will draft your Sources Sought response.
            </p>
          </div>
        )}

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
            {(autoLoadStatus === 'no-docs' || autoLoadStatus === 'error') && (
              <button
                onClick={() => loadPursuitDocs()}
                className="ml-2 underline underline-offset-2 font-semibold hover:opacity-80"
              >
                Retry
              </button>
            )}
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
          pipelineId={activePursuitId}
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
            Mindy reads {uploadedRfp ? 'the notice' : 'this opportunity'} and your saved profile, then drafts the full {isRfqMode ? 'response' : 'letter of intent / response'} — opening, relevant experience, capability fit, and point of contact. One click.
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

          {/* Primary + secondary actions in ONE aligned row — the compliance button
              used to be a bare text link tacked underneath, looking like an
              afterthought (Eric, Jun 26). */}
          <div className="flex flex-wrap items-center gap-3">
            {/* THE one button. ALWAYS draft via the LLM first (RFQ used to skip
                drafting and export a blank template — Eric QC 2026-06-25). */}
            <button
              onClick={generateAllDrafts}
              disabled={draftAllLoading || !!draftLoading}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white text-base font-semibold rounded-xl shadow-lg shadow-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {draftAllLoading ? '⏳ Drafting your response…' : draftAllSummary ? '✨ Redraft my response' : '✨ Draft my response'}
            </button>

            {/* Compliance matrix — an ALIGNED secondary action (same height as the
                primary). Hidden for Sources Sought / RFI: it's market research with
                no shall/must clauses, so the matrix is overkill (Eric, Jun 26). */}
            {uploadedRfp && !draftAllLoading && !isLoiResponseMode && (
              <button
                type="button"
                onClick={generateCompliance}
                disabled={complianceLoading}
                className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-700 bg-slate-800/60 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                <span>📋</span>
                {complianceLoading
                  ? 'Building compliance matrix…'
                  : compliance.length > 0
                    ? `Compliance matrix · ${compliance.length} (rebuild)`
                    : 'Build compliance matrix'}
              </button>
            )}
          </div>

          {/* Show the work while drafting — a believable step-by-step narration so
              the button doesn't just sit silent (Eric, Jun 26). */}
          {draftAllLoading && (
            <div className="mt-4 space-y-3">
              <ComplianceMatrixProgress
                charCount={uploadedRfp?.charCount || uploadedRfp?.text?.length || 0}
                elapsedSec={draftAllElapsedSec}
                messageIdx={draftAllProgressIdx}
                hasPursuit={!!activePursuitId}
                compactTitle="Mindy is writing your response…"
                fullTitle="Mindy is writing your response"
                messages={DRAFT_PROGRESS_MESSAGES}
              />
              {/* Real per-section status + a working Stop. All sections write in
                  one server pass, so they resolve together — the checklist shows
                  what's queued and flips to ✓ as drafts land. */}
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-xs font-medium text-slate-300">
                    Drafting {currentSectionTabs.length} section{currentSectionTabs.length === 1 ? '' : 's'} · {draftAllElapsedSec}s
                  </p>
                  <button
                    type="button"
                    onClick={cancelDraftAll}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white transition-colors"
                  >
                    ■ Stop
                  </button>
                </div>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                  {currentSectionTabs.map(tab => {
                    const done = !!drafts[tab.id];
                    return (
                      <li key={tab.id} className="flex items-center gap-2 text-xs">
                        {done ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <span className="inline-block w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                        )}
                        <span className={done ? 'text-emerald-200' : 'text-slate-400'}>{tab.label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {draftAllCancelled && !draftAllLoading && (
            <p className="mt-4 text-sm text-slate-300 bg-slate-500/10 border border-slate-500/30 rounded-lg px-4 py-3">
              Drafting stopped. Any sections already written are kept below — press “Draft my response” to run the rest.
            </p>
          )}

          {/* Surface draft errors HERE in the hero card — the other draftError
              render is below the fold behind "More options", so a hero-button
              failure was invisible (Eric QC 2026-06-13: "click, nothing happens"). */}
          {draftError && !draftAllLoading && (
            <p className="mt-4 text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-4 py-3">
              {draftError}
            </p>
          )}

          {draftAllSummary && !draftAllLoading && !isRfqMode && (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3">
              <p className="text-sm text-emerald-200">
                ✅ Drafted {draftAllSummary.count} section{draftAllSummary.count === 1 ? '' : 's'}
                {draftAllSummary.errors > 0 && ` (${draftAllSummary.errors} failed — retry those individually below)`}
                . Review each section, edit if needed, then export.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={scrollToReview}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                >
                  Review my draft
                </button>
                <button
                  type="button"
                  onClick={() => exportProposalPackage()}
                  disabled={exporting || !hasAnyDraft}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-2"
                >
                  {exporting && (
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {exporting ? 'Assembling…' : isLoiResponseMode ? 'Export LOI (.docx)' : 'Export Word (.docx)'}
                </button>
              </div>
            </div>
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

      {/* Step 1 — Bid/No-Bid gate (Eric: decide before the matrix). Shown until
          the user makes a decision, then the outputs unlock. */}
      {responseOutputsReady && !isSimpleResponseMode && driveMode === 'auto' && !bidProceeded && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <BidDecisionGate onProceed={() => setBidProceeded(true)} email={email || undefined} pipelineId={activePursuitId} />
        </section>
      )}

      {responseOutputsReady && !isSimpleResponseMode && driveMode === 'auto' && bidProceeded && (
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
            {isSimpleResponseMode && (
              <OutputActionCard
                eyebrow={isRfqMode ? noticeDisplayLabel : 'LOI / Market Research'}
                title={isRfqMode ? 'Export response template' : 'Export LOI response template'}
                description={isRfqMode
                  ? 'Create a Word response template with blanks for pricing, attachments, and submission details.'
                  : loiFields
                    ? 'Mindy read the notice and pre-filled the agency, solicitation number, deadline, submission method, NAICS, and required content. Export the LOI with those fields already in place.'
                    : 'Create a Word LOI from Mindy\'s curated response-template library, with blanks for anything the user must complete.'}
                status={exporting ? 'Working...' : 'Ready'}
                buttonLabel={exporting ? 'Assembling...' : isRfqMode ? 'Export response .docx' : 'Export LOI .docx'}
                disabled={exporting}
                onClick={() => exportProposalPackage()}
                secondaryLabel={!isRfqMode ? (previewing ? 'Loading preview…' : '👁 Preview LOI') : undefined}
                onSecondary={!isRfqMode ? previewLoi : undefined}
                secondaryDisabled={previewing}
              />
            )}
            {/* Compliance matrix is ALWAYS available — the user can elect to use it
                in any mode, including RFQ (Eric, Jun 26: "make the compliance matrix
                option available all the time, even with RFQ"). */}
            <OutputActionCard
              eyebrow="Compliance"
              title="Build compliance matrix"
              description={isSimpleResponseMode
                ? 'Optional — pull every shall / must / required clause into a working table with owner and status. Useful even for an RFQ.'
                : 'Extract shall / must / required clauses into a working table with owner and status fields.'}
              status={compliance.length > 0 ? `${compliance.length} requirements` : complianceLoading ? 'Extracting...' : 'Optional'}
              buttonLabel={complianceLoading ? 'Extracting...' : compliance.length > 0 ? 'Regenerate matrix' : 'Generate matrix'}
              disabled={complianceLoading || !uploadedRfp}
              onClick={generateCompliance}
            />

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
                onClick={() => exportProposalPackage()}
              />
            )}

            {/* Full 4-volume IDIQ/MACC proposal skeleton — the deterministic
                Volume I–IV structure derived from the compliance matrix. The
                format people can't build themselves; placeholders show what goes
                where. Needs a compliance matrix (the structure is driven by it). */}
            {!isSimpleResponseMode && (
              <OutputActionCard
                eyebrow="Export · RFP Response"
                title="Export RFP response skeleton"
                description="A single-award RFP response sized to THIS solicitation — a focused commercial response by default, or the full Section L/M volume structure when the RFP calls for it. Pre-filled from your vault, with placeholders for the rest."
                status={compliance.length > 0 ? 'Ready' : 'Generate the compliance matrix first'}
                buttonLabel={exporting ? 'Assembling...' : 'Export RFP response (.docx)'}
                disabled={exporting || compliance.length === 0}
                onClick={() => exportProposalPackage({ rfp: true })}
              />
            )}

            {!isSimpleResponseMode && (
              <OutputActionCard
                eyebrow="Export · IDIQ / MACC"
                title="Export 4-volume proposal skeleton"
                description="The full Volume I–IV structure (Technical · Past Performance · Pricing · Solicitation & Award) laid out from the solicitation's requirements, pre-filled from your vault, with labeled placeholders for the rest."
                status={compliance.length > 0 ? 'Ready' : 'Generate the compliance matrix first'}
                buttonLabel={exporting ? 'Assembling...' : 'Export IDIQ package (.docx)'}
                disabled={exporting || compliance.length === 0}
                onClick={() => exportProposalPackage({ idiq: true })}
              />
            )}

            {/* Pre-submission compliance check — "will this get thrown out?".
                Checks the current drafts against the compliance matrix for the
                DQ mistakes that lose proposals (missing required plan, over page
                limit, unaddressed eval factor, deadline/portal/eligibility). */}
            <OutputActionCard
              eyebrow="Pre-submission check"
              title="Will this get thrown out?"
              description="Scan your drafted response against the solicitation for the mistakes that disqualify a proposal — missing required plans, page-limit overruns, unaddressed evaluation factors, deadline / portal / eligibility gaps."
              status={compliance.length > 0 ? 'Ready' : 'Generate the compliance matrix first'}
              buttonLabel={scanning ? 'Scanning...' : 'Run compliance check'}
              disabled={scanning || compliance.length === 0}
              onClick={() => runComplianceScan()}
            />
          </div>

          {/* LOI on-screen preview (review before .docx). Same text the export renders. */}
          {loiPreview && (
            <div className="mt-4 rounded-xl border border-purple-500/30 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm font-semibold text-purple-200">📄 LOI preview — review before you export</p>
                <button
                  type="button"
                  onClick={() => setLoiPreview(null)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Close ✕
                </button>
              </div>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-4 font-mono text-[13px] leading-relaxed text-slate-200">
{loiPreview}
              </pre>
              <p className="mt-2 text-xs text-slate-500">
                Text in <span className="text-slate-300">[brackets]</span> is a placeholder for you to fill in. Happy with it? Use “Export LOI .docx” above.
              </p>
            </div>
          )}

          {/* Scan findings */}
          {scanError && (
            <p className="mt-3 text-sm text-amber-300">{scanError}</p>
          )}
          {scanResult && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-sm font-semibold ${scanResult.atRisk ? 'text-red-400' : 'text-emerald-400'}`}>
                  {scanResult.atRisk
                    ? `⚠️ ${scanResult.counts.dq} disqualifying issue${scanResult.counts.dq === 1 ? '' : 's'} found`
                    : '✓ No disqualifying issues found'}
                </span>
                <span className="text-xs text-slate-400">
                  {scanResult.counts.warning} warning{scanResult.counts.warning === 1 ? '' : 's'} · {scanResult.counts.info} note{scanResult.counts.info === 1 ? '' : 's'}
                </span>
              </div>
              {scanResult.findings.length === 0 ? (
                <p className="text-sm text-slate-400">Nothing flagged. Still verify the submission deadline and method before you send.</p>
              ) : (
                <ul className="space-y-2">
                  {scanResult.findings.map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className={
                        f.severity === 'dq' ? 'text-red-400 font-semibold shrink-0'
                        : f.severity === 'warning' ? 'text-amber-300 shrink-0'
                        : 'text-slate-400 shrink-0'
                      }>
                        {f.severity === 'dq' ? 'DQ' : f.severity === 'warning' ? '!' : 'i'}
                      </span>
                      <span>
                        <span className="text-white font-medium">{f.title}</span>
                        {f.section ? <span className="text-slate-500"> ({f.section})</span> : null}
                        <span className="block text-slate-400">{f.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* Output · Compliance Matrix / Response Requirements */}
      {/* In simple mode this (blank template export) is a secondary option —
          only when "More options" is expanded. Full-proposal mode always shows
          the compliance-matrix variant. */}
      {responseOutputsReady && driveMode === 'auto' && (showComplianceMatrix || showAdvancedOutputs) && (
        <section
          id={showComplianceMatrix ? 'proposal-compliance-section' : 'proposal-response-template'}
          ref={complianceSectionRef}
          className="bg-slate-900 border border-slate-800 rounded-xl p-5"
        >
          {!showComplianceMatrix ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Output · Word Response Template</p>
                  <h2 className="text-lg font-semibold text-white">
                    {isRfqMode ? 'Create response template' : 'Create LOI response template'}
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {isRfqMode
                      ? 'RFQs usually need a clean quote/response document with blanks for pricing, submission details, and attachments — not a full compliance matrix.'
                      : 'Sources Sought and RFI responses use Mindy\'s curated LOI response structure. Mindy leaves user-specific details blank and reminds the user to attach an existing capability statement only when requested.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => exportProposalPackage()}
                  disabled={exporting}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors flex items-center gap-2"
                >
                  {exporting && (
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  {exporting ? 'Assembling…' : isRfqMode ? 'Export Response Template (.docx)' : 'Export LOI Template (.docx)'}
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
                      onClick={exportComplianceExcel}
                      className="px-3 py-2 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      Export Excel
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

              {complianceLoading && (
                <ComplianceMatrixProgress
                  charCount={uploadedRfp?.charCount || uploadedRfp?.text?.length || 0}
                  elapsedSec={complianceElapsedSec}
                  messageIdx={complianceProgressIdx}
                  hasPursuit={!!activePursuitId}
                />
              )}

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
                <div className={complianceLoading ? 'opacity-40 pointer-events-none select-none' : ''}>
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
                  {/* Team progress roll-up — done / in-progress / open across the
                      whole matrix, with a completion bar and an unassigned nudge. */}
                  {compliance.length > 0 && (
                    <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-slate-300 font-medium">{complianceProgress.pct}% complete</span>
                        <span className="text-slate-500">
                          {complianceProgress.done} done · {complianceProgress.inProgress} in progress · {complianceProgress.open} open
                          {complianceProgress.na ? ` · ${complianceProgress.na} N/A` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${complianceProgress.pct}%` }} />
                      </div>
                      {complianceProgress.unassigned > 0 && (
                        <p className="text-[11px] text-amber-300/80 mt-1.5">
                          {complianceProgress.unassigned} requirement{complianceProgress.unassigned === 1 ? '' : 's'} unassigned — assign an owner so nothing falls through.
                        </p>
                      )}
                    </div>
                  )}
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
                <button
                  type="button"
                  onClick={() => setMyItemsOnly(v => !v)}
                  className={`rounded px-2 py-1 border transition-colors ${myItemsOnly ? 'border-purple-500 bg-purple-500/15 text-purple-200' : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'}`}
                  title="Show only requirements assigned to you"
                >
                  My items
                </button>
                <span className="text-slate-500 ml-auto">
                  Showing {filteredCompliance.length} of {compliance.length}
                </span>
              </div>

              {/* Teammate suggestions for the per-requirement assignee inputs. */}
              {teamMembers.length > 0 && (
                <datalist id="proposal-team-members">
                  {teamMembers.map(m => <option key={m} value={m} />)}
                </datalist>
              )}
              {/* On a phone the full 7-col grid is 820px wide → horizontal swipe.
                  Hide the three least-actionable columns (ID / Category / Section)
                  below sm so the columns that matter — Requirement, Owner, Status
                  — fit the viewport. Min-width only kicks in at sm+. CSS only,
                  no change to the data or the owner/status edit logic. */}
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-sm sm:min-w-[820px]">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="hidden sm:table-cell text-left px-3 py-2 font-medium w-20">ID</th>
                      <th className="text-left px-3 py-2 font-medium min-w-[160px] sm:min-w-[280px]">Requirement</th>
                      <th className="hidden sm:table-cell text-left px-3 py-2 font-medium w-28">Category</th>
                      <th className="hidden sm:table-cell text-left px-3 py-2 font-medium w-24">Section</th>
                      <th className="hidden sm:table-cell text-left px-3 py-2 font-medium w-36">Drafted in</th>
                      <th className="text-left px-3 py-2 font-medium w-28 sm:w-40">Owner</th>
                      <th className="text-left px-3 py-2 font-medium w-24 sm:w-32">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedCompliance.map((r, i) => {
                      const cat = CATEGORY_LABELS[r.category] || CATEGORY_LABELS.other;
                      // Section group header when the top-level section changes.
                      const sectionGroup = (s?: string) => (s ? `Section ${(s.match(/^[A-Za-z]/)?.[0] || '?').toUpperCase()}` : 'Unsectioned');
                      const grp = sectionGroup(r.section);
                      const showGroup = i === 0 || sectionGroup(pagedCompliance[i - 1].section) !== grp;
                      return (
                        <Fragment key={r.id}>
                        {showGroup && (
                          <tr className="bg-slate-900/70">
                            <td colSpan={7} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-300 border-t border-slate-700">{grp}</td>
                          </tr>
                        )}
                        <tr className="border-t border-slate-800 hover:bg-slate-800/30 align-top">
                          <td className="hidden sm:table-cell px-3 py-2 font-mono text-xs text-slate-500">{r.id}</td>
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
                          <td className="hidden sm:table-cell px-3 py-2">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-medium rounded border ${cat.color}`}>
                              {cat.label}
                            </span>
                          </td>
                          <td className="hidden sm:table-cell px-3 py-2 text-xs text-slate-400 font-mono">{r.section || '—'}</td>
                          <td className="hidden sm:table-cell px-3 py-2 text-xs">
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
                              list="proposal-team-members"
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

              {/* Pager — only when the filtered matrix exceeds one page. */}
              {complianceTotalPages > 1 && (
                <div className="flex items-center justify-between gap-2 mt-3 text-xs">
                  <span className="text-slate-500">
                    Rows {safePage * COMPLIANCE_PAGE_SIZE + 1}–{Math.min((safePage + 1) * COMPLIANCE_PAGE_SIZE, filteredCompliance.length)} of {filteredCompliance.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCompliancePage(p => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="rounded px-2 py-1 border border-slate-700 bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >← Prev</button>
                    <span className="text-slate-400 px-2">Page {safePage + 1} of {complianceTotalPages}</span>
                    <button
                      type="button"
                      onClick={() => setCompliancePage(p => Math.min(complianceTotalPages - 1, p + 1))}
                      disabled={safePage >= complianceTotalPages - 1}
                      className="rounded px-2 py-1 border border-slate-700 bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >Next →</button>
                  </div>
                </div>
              )}

                  <p className="text-xs text-slate-500 mt-3">
                    {activePursuitId
                      ? 'Owner and status are saved to this pursuit and shared with your workspace. CSV export captures the full table.'
                      : 'Open this from a saved pursuit to share owner/status with your team. CSV export captures the full table.'}
                  </p>
                </div>
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
        <section
          ref={reviewSectionRef}
          id="proposal-review-section"
          className="bg-slate-900 border border-slate-800 rounded-xl p-5"
        >
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
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 mb-2 -mx-1 px-1">
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

          {/* Legend — explains the tab badges (only meaningful once a matrix exists). */}
          {compliance.length > 0 && (
            <p className="mb-4 text-[11px] leading-snug text-slate-500">
              <span className="font-semibold text-amber-300/80">amber number</span> = compliance requirements mapped to that section
              <span className="mx-1.5 text-slate-700">·</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 align-middle" /> = section drafted
            </p>
          )}

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
                          Download Word
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => generateDraft(activeSection)}
                      disabled={isLoading || draftAllLoading}
                      title={draftAllLoading ? 'Drafting all sections — please wait or Stop above' : undefined}
                      className="px-4 py-1.5 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center gap-2"
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
      {responseOutputsReady && !isRfqMode && driveMode === 'auto' && (
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
                onClick={() => exportProposalPackage()}
                disabled={exporting}
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

            {!hasAnyDraft && !exporting && (
              <p className="text-xs text-slate-500">
                Exports a fill-in template now — or click <span className="font-semibold text-slate-300">&ldquo;Draft my response&rdquo;</span> first to have Mindy write the sections for you.
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

function ComplianceMatrixProgress({
  charCount,
  elapsedSec,
  messageIdx,
  hasPursuit,
  compact = false,
  compactTitle = 'Building compliance matrix…',
  fullTitle = 'Mindy is building your compliance matrix',
  messages = COMPLIANCE_PROGRESS_MESSAGES,
}: {
  charCount: number;
  elapsedSec: number;
  messageIdx: number;
  hasPursuit: boolean;
  compact?: boolean;
  compactTitle?: string;
  fullTitle?: string;
  messages?: readonly string[];
}) {
  const message = messages[messageIdx % messages.length];
  const estSections = Math.max(1, Math.ceil(charCount / 14000));
  const timeHint = charCount > 120000
    ? 'Large packages can take 1–3 minutes — Mindy reads each section separately.'
    : charCount > 40000
      ? 'Usually 30–90 seconds for documents this size.'
      : 'Usually 15–45 seconds.';

  if (compact) {
    return (
      <div className="overflow-hidden rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block w-4 h-4 border-2 border-purple-300 border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-purple-100">{compactTitle}</p>
            <p key={messageIdx} className="text-xs text-purple-200/80 truncate animate-[complianceFadeIn_0.3s_ease-out]">
              {message} ({elapsedSec}s — still working)
            </p>
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/3 animate-[complianceBar_1.8s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-purple-500 via-indigo-400 to-purple-500" />
        </div>
        <style jsx>{`
          @keyframes complianceBar {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(400%); }
          }
          @keyframes complianceFadeIn {
            from { opacity: 0; transform: translateY(2px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-purple-500/10 p-5 mb-4">
      <div className="flex items-start gap-3">
        <span className="relative inline-flex h-4 w-4 mt-0.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-purple-500" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-purple-100">{fullTitle}</p>
          <p key={messageIdx} className="mt-1 text-sm text-slate-200 animate-[complianceFadeIn_0.3s_ease-out]">
            {message}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {timeHint}
            {hasPursuit && estSections > 1
              ? ` Checking pursuit documents and amendments (${estSections}+ sections).`
              : estSections > 1
                ? ` Reading the document in ${estSections} sections.`
                : ''}
            {' '}
            <span className="text-purple-300/90">Elapsed {elapsedSec}s — not stuck, still calculating.</span>
          </p>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full w-1/3 animate-[complianceBar_1.8s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-purple-500 via-indigo-400 to-purple-500" />
      </div>
      <style jsx>{`
        @keyframes complianceBar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes complianceFadeIn {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
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
  secondaryLabel,
  onSecondary,
  secondaryDisabled,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  buttonLabel: string;
  disabled?: boolean;
  onClick: () => void;
  // Optional secondary action (e.g. "Preview" before export).
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
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
      <div className="mt-4 space-y-2">
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            disabled={secondaryDisabled}
            className="w-full rounded-lg border border-purple-500/40 bg-transparent px-3 py-2 text-sm font-semibold text-purple-200 transition-colors hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="w-full rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {buttonLabel}
        </button>
      </div>
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
