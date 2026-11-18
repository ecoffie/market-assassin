'use client';

/**
 * Attach documents to an Ask Mindy conversation. Each file is saved privately to the user's Vault
 * (POST /api/app/chat/documents → doc_class='reference'), and the conversation's documents ground
 * Mindy's answers. Shown only when /api/app/vault/doc-access says so (VAULT_ASK_MINDY_UPLOADS: 'true' or 'allowlist'); the upload route re-checks.
 *
 * Free: attaching, listing and removing never use credits.
 * A refused file (classification/CUI marking, unreadable, too large) shows the server's reason and
 * nothing was saved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Lock, X, Loader2 } from 'lucide-react';
import { authedFetch } from '../authHeaders';

export interface AttachedDoc {
  id: string;
  filename: string;
  page_count?: number | null;
}

export const ATTACH_ACCEPT = '.pdf,.docx,.txt,.xlsx,.xls,.csv';
export const ATTACH_MAX_MB = 4;

export function ChatAttachments({
  email,
  sessionId,
  ensureSessionId,
  disabled,
  compact = false,
}: {
  email: string;
  /** The current conversation id, or null for a new conversation. */
  sessionId: string | null;
  /** Returns the conversation id to attach to, creating a new one if there is none yet. */
  ensureSessionId: () => string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [docs, setDocs] = useState<AttachedDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const url = (sid: string, extra = '') =>
    `/api/app/chat/documents?email=${encodeURIComponent(email)}&session_id=${encodeURIComponent(sid)}${extra}`;

  // Reload when the conversation changes (new chat → empty; reopening a chat → its documents).
  useEffect(() => {
    setError(null);
    if (!sessionId || !email) { setDocs([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(url(sessionId), email);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(data.documents)) setDocs(data.documents);
      } catch { /* listing is a convenience; the upload itself reports errors */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, email]);

  const onPick = useCallback(async (file: File) => {
    setError(null);
    if (file.size > ATTACH_MAX_MB * 1024 * 1024) {
      setError(`Files can be up to ${ATTACH_MAX_MB} MB here. Larger files can be added from the Vault.`);
      return;
    }
    const sid = ensureSessionId();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authedFetch(url(sid), email, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(String(data?.message || data?.error || 'The file could not be attached. Nothing was saved.'));
        return;
      }
      const d = data.document as AttachedDoc;
      setDocs((prev) => [...prev, { id: d.id, filename: d.filename, page_count: d.page_count ?? null }]);
    } catch {
      setError('The file could not be attached. Nothing was saved. Try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, ensureSessionId]);

  const remove = useCallback(async (id: string) => {
    if (!sessionId) return;
    const before = docs;
    setDocs((prev) => prev.filter((d) => d.id !== id)); // optimistic
    try {
      const res = await authedFetch(url(sessionId, `&id=${encodeURIComponent(id)}`), email, { method: 'DELETE' });
      if (!res.ok) { setDocs(before); setError('Could not remove that file. Try again.'); }
    } catch {
      setDocs(before);
      setError('Could not remove that file. Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, docs, email]);

  return (
    <div data-testid="chat-attachments" className={compact ? 'mb-1.5' : 'mb-2'}>
      {(docs.length > 0 || error) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {docs.map((d) => (
            <span key={d.id} data-testid="attached-doc" className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-hairline bg-ground px-2 py-1 text-[12px] text-ink-soft">
              <Paperclip className="h-3 w-3 shrink-0 text-faint" aria-hidden />
              <span className="truncate" title={d.filename}>{d.filename}</span>
              <button type="button" onClick={() => remove(d.id)} aria-label={`Remove ${d.filename} from this conversation`} className="shrink-0 rounded p-0.5 text-faint hover:text-white">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {error && <span role="alert" data-testid="attach-error" className="text-[12px] text-red-300">{error}</span>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={ATTACH_ACCEPT}
          className="hidden"
          data-testid="attach-input"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f); }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-[12px] text-ink-soft hover:bg-surface disabled:opacity-50"
          aria-label="Attach a document"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Paperclip className="h-3.5 w-3.5" aria-hidden />}
          {busy ? 'Attaching…' : 'Attach'}
        </button>
        <span className="inline-flex items-center gap-1 text-[11px] text-faint">
          <Lock className="h-3 w-3" aria-hidden />
          Saved privately to your Vault
        </span>
      </div>
    </div>
  );
}
