'use client';

/**
 * In-chat download chips for Ask Mindy create_document results.
 * Gold master: Market Research emerald chip row + VaultPanel signed-download flow.
 * Mint a short-lived URL on click — never paste vault links into the answer.
 */
import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { authedFetch } from '@/components/app/authHeaders';

export type GeneratedDownloadFile = {
  format: string;
  document_id: string;
  file_name?: string;
  version?: number;
};

export function labelForFormat(format: string): string {
  const f = format.toLowerCase();
  if (f === 'pdf') return 'Download PDF';
  if (f === 'docx') return 'Download Word';
  if (f === 'xlsx') return 'Download Excel';
  if (f === 'csv') return 'Download CSV';
  return `Download ${format.toUpperCase()}`;
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

export function GeneratedDownloadChips({
  email,
  files,
  pdfNote,
}: {
  email: string;
  files: GeneratedDownloadFile[];
  pdfNote?: string | null;
}) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usable = files.filter((f) => f.document_id && f.format);
  if (!usable.length) return null;

  const onDownload = async (id: string) => {
    setError(null);
    setDownloadingId(id);
    const r = await downloadVaultDocument(email, id);
    if (!r.ok) setError(r.message);
    setDownloadingId(null);
  };

  return (
    <div className="mt-3 pt-3 border-t border-surface/50" data-testid="generated-downloads">
      <div className="text-[10px] font-semibold tracking-wider text-faint mb-1.5">DOWNLOAD</div>
      <div className="flex flex-wrap gap-2">
        {usable.map((f) => (
          <button
            key={f.document_id}
            type="button"
            data-testid={`download-${f.format}`}
            onClick={() => onDownload(f.document_id)}
            disabled={downloadingId !== null}
            title={f.file_name || labelForFormat(f.format)}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
          >
            {downloadingId === f.document_id
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />}
            {downloadingId === f.document_id ? 'Preparing…' : labelForFormat(f.format)}
          </button>
        ))}
      </div>
      {pdfNote ? (
        <p className="mt-2 text-[12px] text-amber-300/90" role="status">{pdfNote}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[12px] text-red-300" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
