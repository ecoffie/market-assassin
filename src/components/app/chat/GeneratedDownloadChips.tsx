'use client';

/**
 * Export menu for Ask Mindy create_document results (Claude / ChatGPT pattern).
 * Formats live behind one Export control in the open report pane — never as a
 * multi-chip row under the chat answer. Mint a short-lived URL on click.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, LoaderCircle } from 'lucide-react';
import { authedFetch } from '@/components/app/authHeaders';

export type GeneratedDownloadFile = {
  format: string;
  document_id: string;
  file_name?: string;
  version?: number;
};

export function labelForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === 'pdf') return 'PDF';
  if (f === 'docx') return 'Word';
  if (f === 'xlsx') return 'Excel';
  if (f === 'csv') return 'CSV';
  return format.toUpperCase();
}

export async function downloadVaultDocument(email: string, documentId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await authedFetch(
      `/api/app/vault/documents/download?email=${encodeURIComponent(email)}&id=${encodeURIComponent(documentId)}`,
      email,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.url) {
      return { ok: false, message: 'That document could not be downloaded. Refresh and try again.' };
    }
    window.location.assign(String(data.url));
    return { ok: true };
  } catch {
    return { ok: false, message: 'That document could not be downloaded. Refresh and try again.' };
  }
}

function usableFiles(files: GeneratedDownloadFile[]): GeneratedDownloadFile[] {
  const byFormat = new Map<string, GeneratedDownloadFile>();
  for (const f of files) {
    if (!f?.document_id || !f.format) continue;
    const key = f.format.toLowerCase();
    const prev = byFormat.get(key);
    if (!prev || (f.version ?? 0) >= (prev.version ?? 0)) byFormat.set(key, f);
  }
  const order = ['pdf', 'docx', 'xlsx', 'csv'];
  return [
    ...order.map((k) => byFormat.get(k)).filter(Boolean),
    ...[...byFormat.entries()].filter(([k]) => !order.includes(k)).map(([, f]) => f),
  ] as GeneratedDownloadFile[];
}

/** Export control for the open report header — one button, formats in a menu. */
export function GeneratedDownloadChips({
  email,
  files,
  pdfNote,
}: {
  email: string;
  files: GeneratedDownloadFile[];
  pdfNote?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const usable = usableFiles(files);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!usable.length) return null;

  const onDownload = async (id: string) => {
    setError(null);
    setDownloadingId(id);
    const r = await downloadVaultDocument(email, id);
    if (!r.ok) setError(r.message);
    setDownloadingId(null);
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef} data-testid="generated-downloads">
      <button
        type="button"
        data-testid="export-toggle"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        disabled={downloadingId !== null}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
      >
        {downloadingId ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Export
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1.5 min-w-[11rem] rounded-xl border border-surface bg-ground py-1 shadow-lg"
          data-testid="export-menu"
        >
          {usable.map((f) => (
            <button
              key={f.document_id}
              type="button"
              role="menuitem"
              data-testid={`download-${f.format}`}
              onClick={() => onDownload(f.document_id)}
              disabled={downloadingId !== null}
              title={f.file_name || labelForFormat(f.format)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-100 hover:bg-white/5 disabled:opacity-50"
            >
              {downloadingId === f.document_id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
              {downloadingId === f.document_id ? 'Preparing…' : labelForFormat(f.format)}
            </button>
          ))}
        </div>
      ) : null}
      {pdfNote ? (
        <p className="mt-2 text-[11px] text-amber-300/90" role="status">{pdfNote}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11px] text-red-300" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
