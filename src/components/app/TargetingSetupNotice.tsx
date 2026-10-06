'use client';

/**
 * "Finish setup" notice + typed-code confirmation — driven by /api/app/targeting-status (server truth).
 *
 * Shown when the daily-alerts gate would skip the user (`none`) or when their alerts run on the
 * unconfirmed 5-code starter set (`starter_codes`). It says WHY personalized alerts have not
 * started and links straight to setup. Nothing here changes a profile on render.
 *
 * Typed codes: NAICS codes the user wrote in their own description are OFFERED one at a time with
 * their Census title. Accept writes through the existing save path (POST /api/alerts/preferences →
 * naics_source='user_confirmed'); Reject is remembered server-side. Never applied automatically.
 * When the stored codes are the starter set, Accept is labelled as a REPLACEMENT, because merging
 * a real code into the placeholder would label the placeholder as confirmed.
 */
import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from './authHeaders';

interface Offer { code: string; title: string }
interface Status {
  state: 'none' | 'starter_codes' | 'targeted';
  alertsOn: boolean;
  notice: string | null;
  setupPath: string;
  storedNaics: string[];
  typedCodeOffers: Offer[];
}

export default function TargetingSetupNotice({ email, surface }: { email: string | null; surface: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email) return;
    try {
      const res = await authedFetch(`/api/app/targeting-status?email=${encodeURIComponent(email)}`, email);
      const j = await res.json().catch(() => null);
      // An unreadable status renders NOTHING — never a guessed "your alerts haven't started".
      setStatus(res.ok && j?.success ? j : null);
    } catch { setStatus(null); }
  }, [email]);

  useEffect(() => {
    load();
    const onSaved = () => load();
    window.addEventListener('mindy:settings-saved', onSaved);
    return () => window.removeEventListener('mindy:settings-saved', onSaved);
  }, [load]);

  if (!email || !status) return null;
  const offers = status.typedCodeOffers || [];
  if (!status.notice && offers.length === 0) return null;
  const replacesStarter = status.state === 'starter_codes';

  const accept = async (code: string) => {
    setBusy(code); setError(null);
    try {
      const naicsCodes = replacesStarter ? [code] : [...new Set([...status.storedNaics, code])];
      const res = await authedFetch('/api/alerts/preferences', email, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, naicsCodes }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || 'save failed');
      window.dispatchEvent(new CustomEvent('mindy:settings-saved'));
    } catch {
      setError(`Couldn’t add ${code} — nothing was changed. Please try again.`);
    } finally { setBusy(null); load(); }
  };

  const reject = async (code: string) => {
    setBusy(code); setError(null);
    try {
      const res = await authedFetch('/api/app/targeting-status', email, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'reject_typed_code', code }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || 'save failed');
    } catch {
      setError(`Couldn’t record that — ${code} may be offered again.`);
    } finally { setBusy(null); load(); }
  };

  return (
    <div data-targeting-notice={surface} className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      {status.notice && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl">{status.notice}</p>
          <a href={status.setupPath} className="shrink-0 rounded-md bg-amber-400 px-3 py-1.5 font-semibold text-gray-950 hover:bg-amber-300">
            Finish setup →
          </a>
        </div>
      )}
      {offers.length > 0 && (
        <div className={status.notice ? 'mt-4 border-t border-amber-500/20 pt-3' : ''}>
          <p className="font-semibold">You mentioned these NAICS codes in your description. Use them for your alerts?</p>
          <ul className="mt-2 space-y-2">
            {offers.map((o) => (
              <li key={o.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-black/20 px-3 py-2">
                <span><span className="font-mono text-amber-200">{o.code}</span> — {o.title}</span>
                <span className="flex gap-2">
                  <button disabled={!!busy} onClick={() => accept(o.code)}
                    className="rounded-md bg-emerald-500 px-3 py-1 font-semibold text-gray-950 disabled:opacity-40">
                    {replacesStarter ? `Use ${o.code} instead of the starter codes` : `Add ${o.code}`}
                  </button>
                  <button disabled={!!busy} onClick={() => reject(o.code)}
                    className="rounded-md border border-white/20 px-3 py-1 text-white/80 disabled:opacity-40">
                    Not mine
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-red-200">{error}</p>}
    </div>
  );
}
