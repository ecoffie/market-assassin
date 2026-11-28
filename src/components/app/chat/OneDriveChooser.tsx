'use client';

/**
 * Mindy's OneDrive file chooser (CONNECTED_APPS). Browses or searches the customer's OWN OneDrive through the
 * server (POST /api/app/connected-apps/browse, on the existing Files.Read grant). Only folders and files Mindy
 * can read are listed. Picking a file exchanges it for a signed file handle (POST /selections), exactly like a
 * Google Picker pick. The Microsoft token never reaches the browser.
 */
import { useCallback, useEffect, useState, useRef } from 'react';
import { ChevronRight, FileText, Folder, Loader2, Search, X } from 'lucide-react';
import { authedFetch } from '../authHeaders';
import type { ConnectedFile } from './ConnectedFiles';

interface Entry { id: string; name: string; kind: 'folder' | 'file'; size: number | null; modified: string | null }
interface Crumb { id: string | null; name: string }

const ERR: Record<string, string> = {
  reauth_needed: 'Please reconnect OneDrive, then try again.',
  unsupported_type: 'Mindy can read PDF, Word, Excel and text files.',
  too_large: 'That file is larger than 15 MB.',
  no_access: 'Mindy does not have permission to open files in this OneDrive. Reconnect it to allow file access.',
  file_permission_needed: 'Mindy does not have permission to open files in this OneDrive. Reconnect it to allow file access.',
};

export function OneDriveChooser({ email, connectionId, account, onPicked, onClose, onNoFileAccess }: {
  email: string;
  connectionId: string;
  account: string;
  onPicked: (f: ConnectedFile) => void;
  onClose: () => void;
  /** The grant cannot read files (403): the parent offers "Reconnect to allow file access" instead of the chooser. */
  onNoFileAccess?: () => void;
}) {
  // A ref, so the parent's inline callback never re-triggers the listing effect.
  const noAccessRef = useRef(onNoFileAccess);
  noAccessRef.current = onNoFileAccess;
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: 'My files' }]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [items, setItems] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const folder = path[path.length - 1];

  const post = useCallback((url: string, body: Record<string, unknown>) => authedFetch(url, email, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, connection_id: connectionId, ...body }),
  }), [email, connectionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await post('/api/app/connected-apps/browse', activeQuery ? { q: activeQuery } : folder.id ? { folder_id: folder.id } : {});
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setItems([]);
          if (j.error === 'file_permission_needed' || j.error === 'no_access') { noAccessRef.current?.(); }
          setError(ERR[j.error] || 'OneDrive did not respond. Please try again.');
          return;
        }
        setItems(j.items || []);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [post, folder.id, activeQuery]);

  const pick = useCallback(async (e: Entry) => {
    setLoading(true); setError(null);
    try {
      const res = await post('/api/app/connected-apps/selections', { file_id: e.id });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.file_handle) {
        if (j.error === 'file_permission_needed' || j.error === 'no_access') { noAccessRef.current?.(); }
        setError(ERR[j.error] || 'That file could not be used.');
        return;
      }
      onPicked({ handle: j.file_handle, name: j.file?.name || e.name, provider: 'microsoft' });
      onClose();
    } finally { setLoading(false); }
  }, [post, onPicked, onClose]);

  return (
    <div role="dialog" aria-label="Pick a file from OneDrive" className="mt-1 w-full max-w-md rounded-lg border border-hairline bg-surface p-2 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-white">OneDrive <span className="text-faint">({account})</span></span>
        <button type="button" aria-label="Close" className="text-faint hover:text-white" onClick={onClose}><X className="w-4 h-4" /></button>
      </div>
      <form className="mb-2 flex items-center gap-1.5" onSubmit={(ev) => { ev.preventDefault(); setActiveQuery(query.trim()); }}>
        <Search className="w-3.5 h-3.5 text-faint" />
        <input value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Search your OneDrive by file name" maxLength={100}
          className="flex-1 rounded border border-hairline bg-ground px-2 py-1 text-white placeholder-faint outline-none focus:border-purple-500" />
        {activeQuery && <button type="button" className="text-faint hover:text-white" onClick={() => { setQuery(''); setActiveQuery(''); }}>Clear</button>}
      </form>
      {!activeQuery && (
        <div className="mb-1 flex flex-wrap items-center gap-0.5 text-faint">
          {path.map((c, i) => (
            <span key={`${c.id}-${i}`} className="inline-flex items-center">
              {i > 0 && <ChevronRight className="w-3 h-3" />}
              <button type="button" className="hover:text-white" disabled={i === path.length - 1} onClick={() => setPath(path.slice(0, i + 1))}>{c.name}</button>
            </span>
          ))}
        </div>
      )}
      <div className="max-h-64 overflow-y-auto">
        {loading && <div className="flex items-center gap-2 px-2 py-2 text-faint"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…</div>}
        {!loading && items && items.length === 0 && !error && <div className="px-2 py-2 text-faint">{activeQuery ? 'No readable files match that name.' : 'No folders or readable files here.'}</div>}
        {!loading && items?.map((e) => (
          <button key={e.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-white hover:bg-white/5"
            onClick={() => (e.kind === 'folder' ? (setActiveQuery(''), setQuery(''), setPath([...path, { id: e.id, name: e.name }])) : pick(e))}>
            {e.kind === 'folder' ? <Folder className="w-3.5 h-3.5 text-faint" /> : <FileText className="w-3.5 h-3.5 text-faint" />}
            <span className="truncate">{e.name}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-faint" role="status">{error}</p>}
    </div>
  );
}
