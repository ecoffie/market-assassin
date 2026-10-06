/**
 * COMPANY SETUP — Screen 1 (tell us) and Screen 2 (confirm what Mindy found).
 *
 * ── CONSTRAINTS THIS SCREEN IS BUILT TO (Eric, 2026-08-25) ─────────────────────────────
 *  · clearly skippable at every step — Skip is present on BOTH screens, always visible
 *  · NO progress bar, step counter or percentage: nothing may imply a mandatory wizard
 *  · Screen 1 reads "help Mindy understand you", never "complete your profile"
 *  · Screen 2 keeps MINDY'S SUGGESTIONS visibly separate from a confirmed profile —
 *    a dashed, tinted panel labelled "not saved yet", not a pre-filled form
 *  · the three outcomes are visually unambiguous, and the two SAVE actions are equal
 *    weight so neither reads as the safe default
 *  · no /app links or fallbacks anywhere
 *  · after any outcome the destination follows the ORIGINAL intent via postSignupPath
 *
 * ⚠️ ALL write semantics live in company-setup-outcome.ts, which is locked and tested.
 * This component decides nothing about provenance — it names an action and passes the
 * retained selection. Skip therefore cannot write, by construction rather than by care.
 */
'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DECLARABLE_CERTIFICATIONS, type CertificationAnswer } from '@/lib/profile/company-setup-input';
import { rankSuggestions, groundingLabel } from '@/lib/profile/suggestion-ranking';
import type { SetupAction } from '@/lib/profile/company-setup-outcome';
import { authedFetch, storedMIEmail } from '@/components/app/authHeaders';
import { typedCodeOffers, type TypedCodeOffer } from '@/lib/profile/typed-codes';

type Suggestion = { code: string; name: string; reason?: string };

function CompanySetupInner() {
  const params = useSearchParams();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  // A failed SAVE is shown, never turned into a redirect that looks like success.
  const [saveError, setSaveError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [description, setDescription] = useState('');
  // null = unanswered. [] = declared "None of these". Different answers, kept different.
  const [certs, setCerts] = useState<CertificationAnswer>(null);
  const [nationwide, setNationwide] = useState(true);
  const [states, setStates] = useState('');

  const [naics, setNaics] = useState<Suggestion[]>([]);
  // Codes the user TYPED in their description: validated + titled, shown apart from Mindy's
  // inferences, and NOT selected until the user adds each one. Never applied automatically.
  const [typed, setTyped] = useState<TypedCodeOffer[]>([]);
  const [typedAdded, setTypedAdded] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);

  const leadTerm = useMemo(() => description.trim().split(/\s+/).find((w) => w.length > 3) || null, [description]);
  const rankedNaics = useMemo(() => rankSuggestions(naics, { leadTerm }), [naics, leadTerm]);

  /** Leave setup without writing anything, honouring the original intent. */
  const leave = async () => {
    const res = await fetch(`/api/company-setup/destination?${params.toString()}`).catch(() => null);
    const j = await res?.json().catch(() => null);
    window.location.href = j?.path || '/opportunity-map';
  };

  const seeMarket = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/suggest-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const j = await r.json();
      const typedOffers = typedCodeOffers([description]);
      const typedSet = new Set(typedOffers.map((t) => t.code));
      setTyped(typedOffers);
      setTypedAdded([]);
      // A code the user typed is theirs to confirm — it is not also listed as Mindy's suggestion.
      setNaics(((j?.naicsSuggestions || []) as Suggestion[]).filter((s) => !typedSet.has(s.code)));
      setKeywords((j?.keywords || []).length ? j.keywords : deriveDisplayKeywords(description));
      setStep(2);
    } finally { setBusy(false); }
  };

  /** Every outcome goes through the same endpoint; only the ACTION differs. */
  const finish = async (action: SetupAction) => {
    setBusy(true);
    setSaveError(null);
    try {
      // The route only writes the caller's OWN profile and takes strong auth, so the request
      // must NAME the account and carry its session token. It used to send neither: every
      // call got 401 "Email required" and the page redirected anyway, so no confirmed setup
      // was ever saved from here (Learn repair board P0-E, 2026-09-26).
      const email = storedMIEmail();
      const r = await authedFetch('/api/company-setup', email, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          action,
          companyName, description,
          certifications: certs,
          states: nationwide ? null : states.split(',').map((s) => s.trim()).filter(Boolean),
          selection: { naicsCodes: [...new Set([...rankedNaics.map((s) => s.code), ...typedAdded])], keywords },
          next: params.get('next'), intent: params.get('intent'),
        }),
      }).catch(() => null);
      const j = await r?.json().catch(() => null);
      const saved = !!(r && r.ok && j?.success);
      // Skip saves nothing the user asked to keep, so it always moves on. A SAVE that did not
      // land stays on this screen and says so — moving on would read as success.
      if (!saved && action !== 'skip') {
        setSaveError(!email || r?.status === 401
          ? 'Sign in to save your selections — nothing was saved.'
          : 'We couldn\u2019t save your selections — nothing was saved. Please try again.');
        return;
      }
      window.location.href = j?.path || '/opportunity-map';
    } finally { setBusy(false); }
  };

  const toggleCert = (c: string) => {
    setCerts((prev) => {
      const cur = prev ?? [];
      const next = cur.includes(c as never) ? cur.filter((x) => x !== c) : [...cur, c as never];
      return next as CertificationAnswer;
    });
  };

  return (
    <main className="min-h-dvh bg-[#0b1020] px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl">
        {/* Skip is ALWAYS reachable, on both screens, and states its consequence. */}
        <div className="flex justify-end">
          <button onClick={leave} className="text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">
            Skip for now →
          </button>
        </div>

        {step === 1 ? (
          <>
            <h1 className="mt-4 text-3xl font-bold tracking-tight">Help Mindy understand your company</h1>
            <p className="mt-3 text-slate-300">
              A few details make your market, alerts and recommendations sharper. You can change any of this later.
            </p>

            <label className="mt-8 block text-sm font-semibold">Company name</label>
            <input
              value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-emerald-400"
              placeholder="Acme Roofing LLC"
            />

            <label className="mt-6 block text-sm font-semibold">What does your company do?</label>
            <p className="text-sm text-slate-400">In your own words — no codes needed.</p>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-emerald-400"
              placeholder="We do commercial roofing and building envelope repair for military bases."
            />

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-sm font-semibold">Certifications</span>
              <span className="text-xs uppercase tracking-wide text-slate-500">optional</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {DECLARABLE_CERTIFICATIONS.map((c) => (
                <button key={c} onClick={() => toggleCert(c)}
                  className={chip((certs ?? []).includes(c))}>{c}</button>
              ))}
              {/* A declared "none" is a real answer and must be distinguishable from silence. */}
              <button onClick={() => setCerts(certs && certs.length === 0 ? null : [])}
                className={chip(Array.isArray(certs) && certs.length === 0)}>None of these</button>
            </div>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-sm font-semibold">Where do you want to work?</span>
              <span className="text-xs uppercase tracking-wide text-slate-500">optional</span>
            </div>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={nationwide} onChange={() => setNationwide(true)} /> Nationwide
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={!nationwide} onChange={() => setNationwide(false)} /> Specific states
              </label>
            </div>
            {!nationwide && (
              <input value={states} onChange={(e) => setStates(e.target.value)} placeholder="VA, MD, DC"
                className="mt-3 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 outline-none focus:border-emerald-400" />
            )}

            <div className="mt-10 flex justify-end">
              <button onClick={seeMarket} disabled={busy || description.trim().length < 8}
                className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-[#06120c] disabled:opacity-40">
                {busy ? 'Looking…' : 'Show me my market →'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-bold tracking-tight">Here&apos;s what Mindy found</h1>
            <p className="mt-3 text-slate-300">
              Based on what you told us. <span className="font-semibold text-white">Nothing is saved yet</span> —
              remove anything that doesn&apos;t fit.
            </p>

            {/* SUGGESTIONS PANEL — dashed + tinted + labelled, so it can never read as
                a confirmed profile. This separation is the point of the screen. */}
            <section className="mt-8 rounded-2xl border-2 border-dashed border-amber-400/40 bg-amber-400/[0.06] p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
                Mindy&apos;s suggestions · not saved yet
              </p>

              <h2 className="mt-4 text-sm font-semibold text-slate-200">Likely NAICS codes</h2>
              <ul className="mt-2 space-y-2">
                {rankedNaics.map((s) => (
                  <li key={s.code} className="flex items-start justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <span>
                      <span className="font-mono text-sm text-emerald-300">{s.code}</span>{' '}
                      <span className="text-sm">{s.name}</span>
                      {/* Dollars are SECONDARY grounding — small, muted, never the ranking. */}
                      {groundingLabel(s) && (
                        <span className="mt-1 block text-xs text-slate-500">{groundingLabel(s)}</span>
                      )}
                    </span>
                    <button onClick={() => setNaics((p) => p.filter((x) => x.code !== s.code))}
                      className="ml-3 shrink-0 text-slate-500 hover:text-white" aria-label={`Remove ${s.code}`}>✕</button>
                  </li>
                ))}
                {!rankedNaics.length && <li className="text-sm text-slate-400">No codes retained.</li>}
              </ul>

              {!!keywords.length && (
                <>
                  <h2 className="mt-5 text-sm font-semibold text-slate-200">Keywords we&apos;ll watch for</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {keywords.map((k) => (
                      <span key={k} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-sm">
                        {k}
                        <button onClick={() => setKeywords((p) => p.filter((x) => x !== k))}
                          className="text-slate-500 hover:text-white" aria-label={`Remove ${k}`}>✕</button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            {typed.length > 0 && (
              <section className="mt-6 rounded-2xl border border-white/15 bg-white/[0.03] p-5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Codes you typed · not added yet</p>
                <p className="mt-1 text-sm text-slate-400">You wrote these NAICS codes in your description. Add the ones you want Mindy to use.</p>
                <ul className="mt-3 space-y-2">
                  {typed.map((t) => {
                    const added = typedAdded.includes(t.code);
                    return (
                      <li key={t.code} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
                        <span><span className="font-mono text-sm text-emerald-300">{t.code}</span> <span className="text-sm">{t.title}</span></span>
                        <span className="flex shrink-0 gap-2">
                          <button onClick={() => setTypedAdded((p) => added ? p.filter((c) => c !== t.code) : [...p, t.code])}
                            aria-pressed={added}
                            className={added ? 'rounded-lg bg-emerald-500 px-3 py-1 text-sm font-semibold text-[#06120c]' : 'rounded-lg border border-white/25 px-3 py-1 text-sm'}>
                            {added ? 'Added ✓' : 'Add'}
                          </button>
                          <button onClick={() => { setTyped((p) => p.filter((x) => x.code !== t.code)); setTypedAdded((p) => p.filter((c) => c !== t.code)); }}
                            className="text-sm text-slate-500 hover:text-white" aria-label={`Not mine: ${t.code}`}>Not mine</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* The two SAVE actions are equal size and adjacent — neither is the safe path. */}
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <button onClick={() => finish('confirm')} disabled={busy}
                className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-[#06120c] disabled:opacity-40">
                Confirm selections
              </button>
              <button onClick={() => finish('accept_all')} disabled={busy}
                className="rounded-xl border border-white/25 px-6 py-3 font-semibold text-white disabled:opacity-40">
                Use Mindy&apos;s suggestions
              </button>
            </div>

            {saveError && (
              <p role="alert" className="mt-4 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {saveError}{' '}
                <button onClick={leave} className="underline underline-offset-4">Continue without saving</button>
              </p>
            )}

            <button onClick={() => finish('skip')} disabled={busy}
              className="mt-4 text-sm text-slate-400 underline underline-offset-4 hover:text-slate-200">
              Skip for now — don&apos;t save any of this
            </button>
          </>
        )}
      </div>
    </main>
  );
}

const chip = (on: boolean) =>
  ['rounded-full px-4 py-2 text-sm transition',
   on ? 'border border-emerald-400 bg-emerald-400/15 text-emerald-200'
      : 'border border-white/15 bg-white/[0.04] text-slate-300 hover:border-white/30'].join(' ');

/** A readable fallback when the API returns no keyword list. Display only — the API's
 *  own derivation is preferred, and nothing here reaches the profile without an action. */
function deriveDisplayKeywords(desc: string): string[] {
  return [...new Set(desc.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 4))].slice(0, 6);
}

/**
 * `useSearchParams()` opts the component into client-side rendering, and Next requires a
 * Suspense boundary to prerender the route shell around it. Without this the production
 * build fails outright — caught by `npm run build`, not by any test.
 */
export default function CompanySetupPage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-[#0b1020]" />}>
      <CompanySetupInner />
    </Suspense>
  );
}
