'use client';

/**
 * The simple Proposals page (owner pick, 2026-11-18: mockups A + B combined).
 *
 *   Home        a list of your proposals + one "New proposal" button. Nothing else.
 *   New · 1     "What are you responding to?" — drop the RFP, or pick a saved pursuit.
 *   New · 2     "Mindy will write these sections, from these sources" → Draft my proposal.
 *   then        the Word-style editor (ProposalEditor), where requirements, documents and the
 *               compliance check live as side-panel tabs.
 *
 * Presentational only: ProposalsPanel owns the state, the upload and the drafting.
 */
import { useRef } from 'react';
import { ArrowLeft, Check, ChevronDown, ExternalLink, FileText, Loader2, Upload } from 'lucide-react';
import { noticeTypeLabel, classifyNoticeType } from '@/lib/utils/notice-type';
import { ProposalStepTracker } from './ProposalSteps';

export interface HomePursuit {
  id: string;
  title: string;
  agency?: string;
  response_deadline?: string;
  stage?: string;
  notice_type?: string | null;
}

const STAGE_RANK: Record<string, number> = { bidding: 0, pursuing: 1, submitted: 2, tracking: 3 };

/** Actively-worked stages first, then soonest due date. */
export function sortPursuits<T extends HomePursuit>(list: T[]): T[] {
  const rank = (o: T) => STAGE_RANK[o.stage || 'tracking'] ?? 4;
  const due = (o: T) => (o.response_deadline ? new Date(o.response_deadline).getTime() : Infinity);
  return [...list].sort((a, b) => rank(a) - rank(b) || due(a) - due(b));
}

/** "Dec 4 · 17 days" — days only when it is due within 30 days and not past. */
export function dueLabel(iso?: string, now: Date = new Date()): { text: string; urgent: boolean } {
  if (!iso) return { text: 'No due date', urgent: false };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: 'No due date', urgent: false };
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const days = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { text: `${date} · closed`, urgent: false };
  if (days <= 30) return { text: `${date} · ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}`, urgent: days <= 14 };
  return { text: date, urgent: false };
}

function respondable(p: HomePursuit) {
  return classifyNoticeType(p.notice_type, p.title).respondability !== 'none';
}

const card = 'rounded-xl border border-hairline bg-ground';
const primaryBtn = 'h-11 px-5 rounded-lg bg-[#006aff] hover:bg-[#0057d1] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors';

/* ─────────────────────────────── Home ─────────────────────────────── */

export function ProposalsHome({
  pursuits, loading, lastDraftName, onNew, onOpenPursuit, onContinueDraft, onAllTools,
}: {
  pursuits: HomePursuit[];
  loading: boolean;
  /** The file name of the last saved draft, when one was restored. */
  lastDraftName?: string | null;
  onNew: () => void;
  onOpenPursuit: (id: string) => void;
  onContinueDraft?: () => void;
  onAllTools: () => void;
}) {
  const list = sortPursuits(pursuits).filter(respondable);
  return (
    <div className="p-6 space-y-6 max-w-5xl" data-testid="proposals-home">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Proposals</h1>
          <p className="text-sm text-muted mt-1">Pick a pursuit to write its proposal, or start a new one.</p>
        </div>
        <button type="button" onClick={onNew} className={primaryBtn} data-testid="new-proposal">+ New proposal</button>
      </div>

      {lastDraftName && onContinueDraft && (
        <button type="button" onClick={onContinueDraft} className={`${card} w-full text-left p-4 flex items-center gap-3 hover:border-[#006aff]/60`}>
          <span className="h-10 w-10 rounded-lg bg-[#006aff]/10 text-[#006aff] inline-flex items-center justify-center shrink-0"><FileText className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Continue your last draft</span>
            <span className="block text-xs text-muted truncate">{lastDraftName}</span>
          </span>
          <span className="text-sm font-semibold text-[#006aff]">Open →</span>
        </button>
      )}

      <section className={`${card} overflow-hidden`} aria-label="Your pursuits">
        <div className="hidden sm:grid grid-cols-[minmax(0,3fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-faint border-b border-hairline">
          <span>Pursuit</span><span>Due</span><span>Stage</span>
        </div>
        {loading && list.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading your pursuits…</p>
        ) : list.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-ink-soft">No saved pursuits yet.</p>
            <p className="text-sm text-muted mt-1">Start a new proposal and drop in the RFP — or save an opportunity from the map first.</p>
          </div>
        ) : (
          <ul>
            {list.map((p) => {
              const due = dueLabel(p.response_deadline);
              const nt = noticeTypeLabel(p.notice_type);
              return (
                <li key={p.id} className="border-b border-hairline last:border-b-0">
                  <button type="button" onClick={() => onOpenPursuit(p.id)}
                    className="w-full grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-1 sm:gap-4 items-center px-5 py-4 text-left hover:bg-surface/60">
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink truncate">{p.title}</span>
                      <span className="block text-xs text-muted truncate">{[p.agency, nt].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className={`text-sm ${due.urgent ? 'text-amber-500 font-semibold' : 'text-ink-soft'}`}>{due.text}</span>
                    <span className="text-sm text-ink-soft capitalize">{p.stage || 'tracking'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted">
        Need the full toolkit (bid/no-bid, requirement filters, SOW export, Manual mode)?{' '}
        <button type="button" onClick={onAllTools} className="underline hover:no-underline">Open all tools</button>
      </p>
    </div>
  );
}

/* ─────────────────────────────── New · step 1 ─────────────────────────────── */

export function NewProposalStart({
  pursuits, uploading, uploadError, onFiles, onPickPursuit, onBack,
}: {
  pursuits: HomePursuit[];
  uploading: boolean;
  uploadError?: string | null;
  onFiles: (files: File[]) => void;
  onPickPursuit: (id: string) => void;
  onBack: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = sortPursuits(pursuits).filter(respondable).slice(0, 5);
  return (
    <div className="p-6 flex flex-col items-center gap-8" data-testid="new-proposal-step-1">
      <div className="w-full max-w-3xl flex flex-col items-center gap-4">
        <button type="button" onClick={onBack} className="self-start text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"><ArrowLeft className="h-4 w-4" />All proposals</button>
        <ProposalStepTracker step={1} />
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-bold text-ink">What are you responding to?</h1>
        <p className="text-base text-muted mt-2">Drop the RFP, or pick one of your saved pursuits.</p>
      </div>
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFiles(Array.from(e.dataTransfer.files || [])); }}
          className="rounded-2xl border-2 border-dashed border-hairline bg-ground hover:border-[#006aff]/60 transition-colors py-10 px-6 flex flex-col items-center gap-3 text-center"
        >
          {uploading ? <Loader2 className="h-9 w-9 text-[#006aff] animate-spin" /> : <Upload className="h-9 w-9 text-[#006aff]" strokeWidth={1.8} />}
          <p className="text-base font-semibold text-ink">{uploading ? 'Mindy is reading your file…' : 'Drop your RFP here'}</p>
          <p className="text-xs text-muted">PDF, Word or text · you can add more documents later</p>
          <button type="button" onClick={() => input.current?.click()} disabled={uploading}
            className="h-11 px-5 rounded-lg border border-hairline bg-surface hover:bg-input text-sm font-medium text-ink disabled:opacity-60">Choose files</button>
          <input ref={input} type="file" multiple className="hidden"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        </div>
        {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}
        {list.length > 0 && (
          <>
            <p className="text-center text-xs text-muted">or pick a saved pursuit</p>
            <ul className="flex flex-col gap-2">
              {list.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPickPursuit(p.id)}
                    className={`${card} w-full min-h-14 px-4 py-3 flex items-center justify-between gap-3 text-left hover:border-[#006aff]/60`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink truncate">{p.title}</span>
                      {p.agency && <span className="block text-xs text-muted truncate">{p.agency}</span>}
                    </span>
                    <span className="text-xs text-muted shrink-0">{dueLabel(p.response_deadline).text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── New · step 2 ─────────────────────────────── */

export function NewProposalReady({
  title, subtitle, documentNames, documents, samUrl, onOpenDoc, loadingDocs, loadMessage, sectionLabels, requirementCount,
  hasSource, canDraft, drafting, elapsedSec, draftError, cancelled,
  onDraft, onStop, onOpenEditor, onAddFiles, onBack, onAllTools,
}: {
  title: string;
  subtitle?: string;
  documentNames: string[];
  /** The documents Mindy read, for the "where is this from?" list. docId = pulled from SAM.gov. */
  documents?: { name: string; docId?: string }[];
  /** The solicitation on SAM.gov, so the user can check the source. */
  samUrl?: string | null;
  onOpenDoc?: (docId: string) => void;
  loadingDocs: boolean;
  loadMessage?: string | null;
  sectionLabels: string[];
  requirementCount: number;
  /** Solicitation text is loaded. */
  hasSource: boolean;
  /** Mindy can draft every section from it (Auto mode, not an RFQ). */
  canDraft: boolean;
  drafting: boolean;
  elapsedSec: number;
  draftError?: string | null;
  cancelled?: boolean;
  onDraft: () => void;
  onStop: () => void;
  onOpenEditor: () => void;
  onAddFiles: (files: File[]) => void;
  onBack: () => void;
  onAllTools: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // All sections come back in one pass, so the bar follows time (about a minute), never claiming 100%.
  const pct = Math.min(92, Math.round((elapsedSec / 70) * 92));
  return (
    <div className="p-6 flex flex-col items-center gap-8" data-testid="new-proposal-step-2">
      <div className="w-full max-w-3xl flex flex-col items-center gap-4">
        <button type="button" onClick={onBack} className="self-start text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"><ArrowLeft className="h-4 w-4" />Back</button>
        <ProposalStepTracker step={2} />
      </div>

      <div className={`${card} w-full max-w-2xl p-8 flex flex-col gap-6`}>
        <div>
          {loadingDocs ? (
            <p className="text-sm text-muted inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{loadMessage || 'Mindy is pulling the solicitation documents…'}</p>
          ) : documentNames.length > 0 ? (
            // Owner, 2026-11-24: show WHICH documents and the SAM.gov page, so people can verify the source.
            <details className="group" data-testid="source-documents">
              <summary className="cursor-pointer list-none text-sm font-semibold text-emerald-500 inline-flex items-center gap-1.5 min-h-[44px]">
                <Check className="h-4 w-4" />Mindy read {documentNames.length === 1 ? documentNames[0] : `${documentNames.length} documents`}
                <span className="text-xs font-medium text-muted underline">Show sources</span>
                <ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="mt-2 rounded-lg border border-hairline divide-y divide-hairline text-sm">
                {(documents ?? documentNames.map((name) => ({ name, docId: undefined as string | undefined }))).map((d, i) => (
                  <li key={`${d.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="inline-flex items-center gap-2 min-w-0 text-ink"><FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" /><span className="truncate">{d.name}</span></span>
                    {d.docId && onOpenDoc ? (
                      <button type="button" onClick={() => onOpenDoc(d.docId!)} className="shrink-0 min-h-[36px] px-2 text-xs font-semibold text-[#006aff] hover:underline">Open</button>
                    ) : (
                      <span className="shrink-0 text-xs text-muted">Uploaded by you</span>
                    )}
                  </li>
                ))}
                {samUrl && (
                  <li className="px-3 py-2">
                    <a href={samUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#006aff] hover:underline min-h-[36px]">
                      View the solicitation on SAM.gov<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </li>
                )}
              </ul>
            </details>
          ) : (
            <p className="text-sm text-amber-500">{loadMessage || 'No documents yet — add the RFP so Mindy has something to write from.'}</p>
          )}
          <h1 className="text-2xl font-bold text-ink mt-2">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
        </div>

        <dl className="rounded-lg bg-surface/60 p-4 text-sm text-ink-soft flex flex-col gap-2">
          <div><dt className="inline font-semibold text-ink">Mindy will write: </dt><dd className="inline">{sectionLabels.join(', ')}</dd></div>
          <div><dt className="inline font-semibold text-ink">Using: </dt><dd className="inline">the solicitation + your Vault (company profile, past projects)</dd></div>
          {requirementCount > 0 && <div><dt className="inline font-semibold text-ink">Requirements found: </dt><dd className="inline">{requirementCount}</dd></div>}
        </dl>

        {drafting ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="flex justify-between text-sm"><span className="font-semibold text-ink">Mindy is writing your proposal…</span><span className="text-muted">{elapsedSec}s</span></div>
            <div className="h-2.5 rounded-full bg-surface overflow-hidden"><div className="h-full bg-[#006aff] transition-all" style={{ width: `${Math.max(8, pct)}%` }} /></div>
            <p className="text-xs text-muted">Usually about a minute. The editor opens when it&apos;s done.</p>
            <button type="button" onClick={onStop} className="self-start text-xs font-semibold text-red-500 hover:underline">Stop</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {canDraft ? (
              <button type="button" onClick={onDraft} className={primaryBtn} data-testid="draft-my-proposal">Draft my proposal</button>
            ) : hasSource ? (
              <button type="button" onClick={onOpenEditor} className={primaryBtn}>Open the editor</button>
            ) : (
              <button type="button" onClick={() => input.current?.click()} disabled={loadingDocs} className={primaryBtn}><Upload className="h-4 w-4" />Add the RFP</button>
            )}
            {(canDraft || !hasSource) && (
              <button type="button" onClick={onOpenEditor} className="h-11 px-4 rounded-lg border border-hairline bg-surface hover:bg-input text-sm font-medium text-ink">Write it myself</button>
            )}
            {hasSource && (
              <button type="button" onClick={() => input.current?.click()} className="text-sm text-muted hover:text-ink underline">Add more documents</button>
            )}
          </div>
        )}
        {cancelled && !drafting && <p className="text-sm text-muted">Drafting stopped. Sections already written are kept.</p>}
        {draftError && !drafting && <p className="text-sm text-red-500">{draftError}</p>}
        <input ref={input} type="file" multiple className="hidden"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={(e) => { onAddFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>

      <button type="button" onClick={onAllTools} className="text-xs text-muted underline hover:no-underline">Open all tools for this pursuit</button>
    </div>
  );
}
