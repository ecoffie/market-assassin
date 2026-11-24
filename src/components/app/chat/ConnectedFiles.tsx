'use client';

/**
 * Use a file from a connected Google Drive / OneDrive in Ask Mindy (CONNECTED_APPS, default off).
 *
 * Renders nothing unless GET /api/app/connected-apps answers (it is 404 when the flag is off for this user).
 * - Connect: shows what the provider grant allows (the server's access_note) BEFORE leaving for consent,
 *   then navigates to the provider. The callback returns here with ?connect=ok|error.
 * - Pick: Google's own Picker (drive.file: Mindy can open only what is picked). The pick is exchanged for a
 *   signed file handle (POST /selections), shown as a removable chip and sent with each question.
 * - OneDrive: the server reads OneDrive picks already; the OneDrive picker hand-off ships next.
 * Mindy never lists or searches the drive from here.
 */
import { useCallback, useEffect, useState } from 'react';
import { HardDrive, Loader2, X } from 'lucide-react';
import { authedFetch } from '../authHeaders';

export interface ConnectedFile {
  handle: string;
  name: string;
  provider: 'google' | 'microsoft';
}

interface Connection { id: string; provider: 'google' | 'microsoft'; connected_email: string; status: string }

const PROVIDER_LABEL = { google: 'Google Drive', microsoft: 'OneDrive' } as const;
const CONNECT_REASON: Record<string, string> = {
  access_denied: 'You cancelled the connection. Nothing was connected.',
  browser_mismatch: 'Finish connecting in the same browser window where you started. Nothing was connected.',
  invalid_state: 'That connection link expired. Please try again.',
  consent_required: 'Your organization requires an administrator to approve Mindy first.',
  not_configured: 'Connecting accounts is not set up yet.',
};
const PICK_ERROR: Record<string, string> = {
  unsupported_type: 'Mindy can read PDF, Word, Excel, text, Google Docs and Google Sheets files.',
  too_large: 'That file is larger than 15 MB.',
  reauth_needed: 'Please reconnect this account, then pick the file again.',
  picker_not_configured: 'The Google file picker is not set up yet.',
};

declare global {
  interface Window {
    gapi?: { load: (lib: string, cb: () => void) => void };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
  }
}

let pickerLoad: Promise<void> | null = null;
function loadGooglePicker(): Promise<void> {
  if (pickerLoad) return pickerLoad;
  pickerLoad = new Promise<void>((resolve, reject) => {
    const done = () => window.gapi!.load('picker', () => resolve());
    if (window.gapi) return done();
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.onload = done;
    s.onerror = () => { pickerLoad = null; reject(new Error('picker_script')); };
    document.head.appendChild(s);
  });
  return pickerLoad;
}

const PICKABLE_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
].join(',');

export function ConnectedFiles({ email, files, onChange, disabled }: {
  email: string;
  files: ConnectedFile[];
  onChange: (next: ConnectedFile[]) => void;
  disabled?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Array<{ provider: 'google' | 'microsoft'; available: boolean }>>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingConnect, setPendingConnect] = useState<{ provider: 'google' | 'microsoft'; url: string; note: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/app/connected-apps?email=${encodeURIComponent(email)}`, email);
      if (!res.ok) { setEnabled(false); return; }
      const j = await res.json();
      setEnabled(true);
      setConnections((j.connections || []).filter((c: Connection) => c.status === 'connected' || c.status === 'reauth_needed'));
      setProviders(j.providers || []);
    } catch { setEnabled(false); }
  }, [email]);

  useEffect(() => { if (email) void load(); }, [email, load]);

  // Back from the provider: say what happened once, then clean the address bar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    const status = u.searchParams.get('connect');
    if (!status) return;
    const reason = u.searchParams.get('reason') || '';
    const provider = u.searchParams.get('provider') as 'google' | 'microsoft' | null;
    setMessage(status === 'ok'
      ? `${provider ? PROVIDER_LABEL[provider] : 'Your account'} is connected. Pick a file to use it in this conversation.`
      : CONNECT_REASON[reason] || 'The account could not be connected. Please try again.');
    for (const k of ['connect', 'reason', 'provider', 'connection']) u.searchParams.delete(k);
    window.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
  }, []);

  const startConnect = useCallback(async (provider: 'google' | 'microsoft') => {
    setBusy(true); setMessage(null);
    try {
      const res = await authedFetch('/api/app/connected-apps/start', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, provider, capabilities: ['file'], returnTo: window.location.pathname + window.location.search }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.authorize_url) { setMessage(CONNECT_REASON[j.error] || 'Connecting is not available right now.'); return; }
      // Show what the grant allows before leaving Mindy; the customer chooses to continue.
      setPendingConnect({ provider, url: j.authorize_url, note: j.access_note || '' });
    } finally { setBusy(false); }
  }, [email]);

  const pickGoogle = useCallback(async (c: Connection) => {
    setBusy(true); setMessage(null); setOpen(false);
    try {
      const res = await authedFetch('/api/app/connected-apps/picker-token', email, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, connection_id: c.id }),
      });
      const t = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(PICK_ERROR[t.error] || 'The file picker could not open.'); return; }
      await loadGooglePicker();
      const g = window.google.picker;
      const view = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(false).setMimeTypes(PICKABLE_MIME);
      const picker = new g.PickerBuilder()
        .addView(view)
        .setOAuthToken(t.access_token)
        .setDeveloperKey(t.developer_key)
        .setAppId(t.app_id)
        .setTitle('Pick a file for Mindy to read')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .setCallback(async (data: any) => {
          if (data[g.Response.ACTION] !== g.Action.PICKED) return;
          const doc = data[g.Response.DOCUMENTS]?.[0];
          if (!doc) return;
          setBusy(true);
          try {
            const sel = await authedFetch('/api/app/connected-apps/selections', email, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, connection_id: c.id, file_id: doc[g.Document.ID] }),
            });
            const s = await sel.json().catch(() => ({}));
            if (!sel.ok || !s.file_handle) { setMessage(PICK_ERROR[s.error] || 'That file could not be used.'); return; }
            if (!files.some((f) => f.handle === s.file_handle)) onChange([...files, { handle: s.file_handle, name: s.file?.name || 'file', provider: 'google' as const }].slice(-5));
          } finally { setBusy(false); }
        })
        .build();
      picker.setVisible(true);
    } catch {
      setMessage('The file picker could not open.');
    } finally { setBusy(false); }
  }, [email, files, onChange]);

  if (!enabled) return null;
  const connectedProviders = new Set(connections.map((c) => c.provider));

  return (
    <div className="mb-2 text-[12.5px]" data-testid="connected-files">
      {files.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span key={f.handle} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-ground px-2 py-1 text-white">
              <HardDrive className="w-3.5 h-3.5 text-faint" />
              <span className="max-w-[220px] truncate" title={`${f.name} (${PROVIDER_LABEL[f.provider]})`}>{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="text-faint hover:text-white" onClick={() => onChange(files.filter((x) => x.handle !== f.handle))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {pendingConnect ? (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-purple-100">
          <p className="mb-2">{pendingConnect.note}</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-md bg-purple-600 px-2.5 py-1 text-white hover:bg-purple-500" onClick={() => window.location.assign(pendingConnect.url)}>
              Continue to {pendingConnect.provider === 'google' ? 'Google' : 'Microsoft'}
            </button>
            <button type="button" className="rounded-md px-2.5 py-1 text-faint hover:text-white" onClick={() => setPendingConnect(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="relative inline-block">
          <button type="button" disabled={disabled || busy} onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-faint hover:text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}
            Use a file from Drive or OneDrive
          </button>
          {open && (
            <div className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-lg border border-hairline bg-surface p-1 shadow-lg">
              {connections.map((c) => (
                c.status === 'reauth_needed' ? (
                  <button key={c.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-white hover:bg-white/5" onClick={() => startConnect(c.provider)}>
                    Reconnect {PROVIDER_LABEL[c.provider]} ({c.connected_email})
                  </button>
                ) : c.provider === 'google' ? (
                  <button key={c.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-white hover:bg-white/5" onClick={() => pickGoogle(c)}>
                    Pick from Google Drive ({c.connected_email})
                  </button>
                ) : (
                  <div key={c.id} className="px-2 py-1.5 text-faint">OneDrive ({c.connected_email}): file picking is coming next</div>
                )
              ))}
              {providers.filter((p) => p.available && !connectedProviders.has(p.provider)).map((p) => (
                <button key={p.provider} type="button" className="block w-full rounded px-2 py-1.5 text-left text-white hover:bg-white/5" onClick={() => startConnect(p.provider)}>
                  Connect {PROVIDER_LABEL[p.provider]}
                </button>
              ))}
              {!connections.length && !providers.some((p) => p.available) && (
                <div className="px-2 py-1.5 text-faint">Connecting accounts is not set up yet.</div>
              )}
            </div>
          )}
        </div>
      )}
      {message && <p className="mt-1 text-faint" role="status">{message}</p>}
    </div>
  );
}
