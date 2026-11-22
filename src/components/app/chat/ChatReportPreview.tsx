'use client';

/**
 * In-chat report pane for Ask Mindy (the /app chat). A document Mindy just saved (create_document) or a
 * packaged market report (generate_market_report) is READ here, above the answer, with no download.
 * Gold master: the Opportunity Map's report pane (opportunity-map/route.ts `repOpen` / `repOnMarketReport`).
 * Same source of truth: GET /api/app/vault/documents/preview renders the stored DocModel with the engine
 * that produced the PDF/Word, so what is on screen is exactly what the download chips contain.
 * The iframe is script-less and sandboxed; it gets the HTML by srcDoc because an iframe cannot send auth.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, Maximize2, Minimize2 } from 'lucide-react';
import { authedFetch } from '@/components/app/authHeaders';
import { GeneratedDownloadChips, type GeneratedDownloadFile } from './GeneratedDownloadChips';

export type ChatInlineReport = { html: string; title: string; url?: string | null };

/** Word first (the Map's choice), then whatever else was saved. Every generated row carries the same DocModel. */
export function previewCandidates(files: readonly GeneratedDownloadFile[]): string[] {
  const usable = files.filter((f) => f && f.document_id && f.format);
  const rank = (f: GeneratedDownloadFile) => {
    const i = ['docx', 'pdf', 'xlsx', 'csv'].indexOf(f.format.toLowerCase());
    return i < 0 ? 9 : i;
  };
  return [...usable].sort((a, b) => rank(a) - rank(b)).map((f) => f.document_id);
}

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; html: string; title: string; version: number | null; saved: boolean; url: string | null }
  | { kind: 'gone' }
  | { kind: 'error' };

/** Try each saved format until one has a stored model. 404 on all → gone; anything else → error (never invented). */
async function fetchPreview(email: string, ids: string[]): Promise<PreviewState> {
  let gone = false;
  for (const id of ids) {
    try {
      const res = await authedFetch(
        `/api/app/vault/documents/preview?email=${encodeURIComponent(email)}&id=${encodeURIComponent(id)}`,
        email,
      );
      if (res.status === 404) { gone = true; continue; }
      if (!res.ok) return { kind: 'error' };
      const j = await res.json().catch(() => null);
      if (!j?.success || typeof j.html !== 'string') return { kind: 'error' };
      return {
        kind: 'ready',
        html: j.html,
        title: String(j.title || 'Report'),
        version: typeof j.version === 'number' ? j.version : null,
        saved: true,
        url: null,
      };
    } catch {
      return { kind: 'error' };
    }
  }
  return gone ? { kind: 'gone' } : { kind: 'error' };
}

export function ChatReportPreview({
  email,
  files,
  inline,
  pdfNote,
}: {
  email: string;
  files?: readonly GeneratedDownloadFile[];
  inline?: ChatInlineReport | null;
  /** Shown under Export when PDF could not be produced. */
  pdfNote?: string | null;
}) {
  const [state, setState] = useState<PreviewState>(
    inline?.html
      ? { kind: 'ready', html: inline.html, title: inline.title || 'Report', version: null, saved: false, url: inline.url ?? null }
      : { kind: 'loading' },
  );
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const idsKey = files ? previewCandidates(files).join(',') : '';

  useEffect(() => {
    if (inline?.html || !idsKey) return;
    let cancelled = false;
    void fetchPreview(email, idsKey.split(',')).then((next) => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, [email, idsKey, inline?.html, attempt]);

  return (
    <section
      className="mb-3 overflow-hidden rounded-xl border border-emerald-500/30 bg-ground/60"
      data-testid="chat-report-preview"
      aria-label="Report"
    >
      <header className="flex items-center gap-2 border-b border-surface/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-50" data-testid="chat-report-title">
            {state.kind === 'ready' ? state.title : 'Your report'}
          </div>
          {state.kind === 'ready' && (
            <div className="text-[11px] text-faint">
              {state.saved
                ? `${state.version ? `Version ${state.version} · ` : ''}also saved in your Documents`
                : 'Packaged market report'}
            </div>
          )}
        </div>
        {state.kind === 'ready' && state.url ? (
          <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-sky-300 hover:underline">
            Open hosted link
          </a>
        ) : null}
        {!!files?.length && (
          <GeneratedDownloadChips email={email} files={[...files]} pdfNote={pdfNote} />
        )}
        {state.kind === 'ready' && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-surface px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-500/40"
            data-testid="chat-report-toggle"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {expanded ? 'Shrink' : 'Expand'}
          </button>
        )}
      </header>
      {state.kind === 'ready' && (
        <iframe
          title={state.title}
          sandbox=""
          srcDoc={state.html}
          data-testid="chat-report-frame"
          className="block w-full bg-white"
          style={{ height: expanded ? '85vh' : '520px' }}
        />
      )}
      {state.kind === 'loading' && (inline?.html || idsKey) && (
        <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-faint" data-testid="chat-report-loading">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading your report…
        </div>
      )}
      {(state.kind === 'gone' || (!inline?.html && !idsKey)) && (
        <div className="px-4 py-4 text-[13px] text-faint" data-testid="chat-report-gone">
          This report is no longer available. Ask Mindy to create it again.
        </div>
      )}
      {state.kind === 'error' && (
        <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-amber-300" role="alert" data-testid="chat-report-error">
          The report could not be loaded.
          <button
            type="button"
            onClick={() => { setState({ kind: 'loading' }); setAttempt((n) => n + 1); }}
            className="rounded-md border border-amber-400/40 px-2 py-1 text-[11px] hover:bg-amber-400/10"
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
