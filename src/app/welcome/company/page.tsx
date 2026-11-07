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

import { Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DECLARABLE_CERTIFICATIONS, describeWorkIssue, type CertificationAnswer } from '@/lib/profile/company-setup-input';
import { postSignupPath } from '@/lib/mindy/post-signup-destination';
import { signInHref } from '@/lib/mindy/sign-in-return';
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
  // A 401 save said "Sign in…" with nothing to click. Sign-in now returns to THIS page (and its
  // own ?next=), so the user lands back here instead of on /app.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // Screen 1's own problems (an unusable description, a lookup that failed). ALWAYS rendered —
  // the button is never silently disabled (2026-10-10: "Roofing" disabled it with no message).
  const [formError, setFormError] = useState<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

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

  /** Where leaving should land when the server cannot be asked: the SAME pure resolver the
   *  destination route wraps, so a dropped request still honours ?next=/learn instead of
   *  falling through to the Map. */
  const localDestination = () => postSignupPath({
    next: params.get('next'), intent: params.get('intent'), purchaseNext: params.get('purchase_next'),
  });

  /** Leave setup without writing anything, honouring the original intent. */
  const leave = async () => {
    const res = await fetch(`/api/company-setup/destination?${params.toString()}`).catch(() => null);
    const j = await res?.json().catch(() => null);
    window.location.href = j?.path || localDestination();
  };

  const seeMarket = async () => {
    const issue = describeWorkIssue(description);
    if (issue) { setFormError(issue); descRef.current?.focus(); return; }
    setFormError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/suggest-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      }).catch(() => null);
      const j = await r?.json().catch(() => null);
      // A failed lookup stays on this screen and SAYS so. It used to throw out of try/finally
      // into nowhere: the button flashed "Looking…" and then did nothing at all.
      if (!r || !r.ok || !j || j.success === false) {
        setFormError((j && typeof j.error === 'string' && j.error)
          || 'Mindy couldn\u2019t look up your market right now \u2014 nothing was saved. Try again, or skip for now.');
        return;
      }
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
    setNeedsSignIn(false);
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
        setNeedsSignIn(!email || r?.status === 401);
        setSaveError(!email || r?.status === 401
          ? 'Sign in to save your selections — nothing was saved.'
          : 'We couldn\u2019t save your selections — nothing was saved. Please try again.');
        return;
      }
      window.location.href = j?.path || localDestination();
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
    <main className="min-h-dvh bg-(--mp-navy-wash)/50 px-6 pb-16 pt-6 text-(--mp-ink)">
      <div className="mx-auto max-w-2xl">
        {/* Skip is ALWAYS reachable, on both screens, and states its consequence. */}
        <div className="flex justify-end">
          <button onClick={leave} className="text-sm text-(--mp-muted) underline underline-offset-4 hover:text-(--mp-ink)">
            Skip for now →
          </button>
        </div>

        {step === 1 ? (
          <>
            <h1 className="mt-4 font-(family-name:--mp-font-serif) text-[32px] font-normal leading-[1.15] tracking-[-0.015em] sm:text-[40px]">Help Mindy understand your company</h1>
            <p className="mt-3 text-(--mp-body)">
              A few details make your market, alerts and recommendations sharper. You can change any of this later.
            </p>

            <label className="mt-8 block text-sm font-semibold">Company name</label>
            <input
              value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              className="mt-2 w-full rounded-xl border-[1.5px] border-(--mp-line) bg-(--mp-surface) px-4 py-3 text-(--mp-ink) outline-none focus:border-(--mp-navy) focus:shadow-[0_0_0_3px_rgba(27,58,107,0.15)]"
              placeholder="Acme Roofing LLC"
            />

            <label className="mt-6 block text-sm font-semibold">What does your company do?</label>
            <p className="text-sm text-(--mp-muted)">In your own words — no codes needed.</p>
            <textarea
              ref={descRef} id="describeWork" aria-describedby="descHint"
              aria-invalid={formError ? true : undefined}
              value={description} onChange={(e) => { setDescription(e.target.value); if (formError) setFormError(null); }} rows={3}
              className="mt-2 w-full rounded-xl border-[1.5px] border-(--mp-line) bg-(--mp-surface) px-4 py-3 text-(--mp-ink) outline-none focus:border-(--mp-navy) focus:shadow-[0_0_0_3px_rgba(27,58,107,0.15)]"
              placeholder="We do commercial roofing and building envelope repair for military bases."
            />
            <p id="descHint" className="mt-1 text-xs text-(--mp-muted)">{'A word or two is enough \u2014 for example, \u201cRoofing\u201d. More detail sharpens the match.'}</p>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-sm font-semibold">Certifications</span>
              <span className="text-xs uppercase tracking-wide text-(--mp-muted)">optional</span>
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
              <span className="text-xs uppercase tracking-wide text-(--mp-muted)">optional</span>
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
                className="mt-3 w-full rounded-xl border-[1.5px] border-(--mp-line) bg-(--mp-surface) px-4 py-3 text-(--mp-ink) outline-none focus:border-(--mp-navy) focus:shadow-[0_0_0_3px_rgba(27,58,107,0.15)]" />
            )}

            {formError && (
              <p role="alert" className="mt-6 rounded-lg border border-(--mp-warn-line) bg-(--mp-warn-bg) px-4 py-3 text-sm text-(--mp-warn)">
                {formError}
              </p>
            )}

            <div className="mt-10 flex justify-end">
              <button onClick={seeMarket} disabled={busy}
                className="rounded-full bg-(--mp-navy) px-7 py-3.5 font-semibold text-white hover:bg-(--mp-navy-hover) disabled:opacity-40">
                {busy ? 'Looking…' : 'Show me my market →'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 font-(family-name:--mp-font-serif) text-[32px] font-normal leading-[1.15] tracking-[-0.015em] sm:text-[40px]">Here&apos;s what Mindy found</h1>
            <p className="mt-3 text-(--mp-body)">
              Based on what you told us. <span className="font-semibold text-(--mp-ink)">Nothing is saved yet</span> —
              remove anything that doesn&apos;t fit.
            </p>

            {/* SUGGESTIONS PANEL — dashed + tinted + labelled, so it can never read as
                a confirmed profile. This separation is the point of the screen. */}
            <section className="mt-8 rounded-2xl border-2 border-dashed border-(--mp-warn-line) bg-(--mp-warn-bg) p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-(--mp-warn)">
                Mindy&apos;s suggestions · not saved yet
              </p>

              <h2 className="mt-4 text-sm font-semibold text-(--mp-ink)">Likely NAICS codes</h2>
              <ul className="mt-2 space-y-2">
                {rankedNaics.map((s) => (
                  <li key={s.code} className="flex items-start justify-between rounded-xl border border-(--mp-line) bg-(--mp-surface) px-4 py-3">
                    <span>
                      <span className="font-(family-name:--mp-font-mono) text-sm text-(--mp-navy)">{s.code}</span>{' '}
                      <span className="text-sm">{s.name}</span>
                      {/* Dollars are SECONDARY grounding — small, muted, never the ranking. */}
                      {groundingLabel(s) && (
                        <span className="mt-1 block text-xs text-(--mp-muted)">{groundingLabel(s)}</span>
                      )}
                    </span>
                    <button onClick={() => setNaics((p) => p.filter((x) => x.code !== s.code))}
                      className="ml-3 shrink-0 text-(--mp-muted) hover:text-(--mp-ink)" aria-label={`Remove ${s.code}`}>✕</button>
                  </li>
                ))}
                {!rankedNaics.length && <li className="text-sm text-(--mp-muted)">No codes retained.</li>}
              </ul>

              {!!keywords.length && (
                <>
                  <h2 className="mt-5 text-sm font-semibold text-(--mp-ink)">Keywords we&apos;ll watch for</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {keywords.map((k) => (
                      <span key={k} className="inline-flex items-center gap-2 rounded-full border border-(--mp-line) bg-(--mp-surface) px-3 py-1 text-sm">
                        {k}
                        <button onClick={() => setKeywords((p) => p.filter((x) => x !== k))}
                          className="text-(--mp-muted) hover:text-(--mp-ink)" aria-label={`Remove ${k}`}>✕</button>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            {typed.length > 0 && (
              <section className="mt-6 rounded-2xl border border-(--mp-line) bg-(--mp-wash) p-5">
                <p className="text-xs font-bold uppercase tracking-widest text-(--mp-body)">Codes you typed · not added yet</p>
                <p className="mt-1 text-sm text-(--mp-muted)">You wrote these NAICS codes in your description. Add the ones you want Mindy to use.</p>
                <ul className="mt-3 space-y-2">
                  {typed.map((t) => {
                    const added = typedAdded.includes(t.code);
                    return (
                      <li key={t.code} className="flex items-center justify-between gap-3 rounded-xl border border-(--mp-line) bg-(--mp-surface) px-4 py-3">
                        <span><span className="font-(family-name:--mp-font-mono) text-sm text-(--mp-navy)">{t.code}</span> <span className="text-sm">{t.title}</span></span>
                        <span className="flex shrink-0 gap-2">
                          <button onClick={() => setTypedAdded((p) => added ? p.filter((c) => c !== t.code) : [...p, t.code])}
                            aria-pressed={added}
                            className={added ? 'rounded-full bg-(--mp-navy) px-3 py-1 text-sm font-semibold text-white' : 'rounded-full border border-(--mp-line) px-3 py-1 text-sm text-(--mp-ink) hover:border-(--mp-navy)'}>
                            {added ? 'Added ✓' : 'Add'}
                          </button>
                          <button onClick={() => { setTyped((p) => p.filter((x) => x.code !== t.code)); setTypedAdded((p) => p.filter((c) => c !== t.code)); }}
                            className="text-sm text-(--mp-muted) hover:text-(--mp-ink)" aria-label={`Not mine: ${t.code}`}>Not mine</button>
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
                className="rounded-full bg-(--mp-navy) px-7 py-3.5 font-semibold text-white hover:bg-(--mp-navy-hover) disabled:opacity-40">
                Confirm selections
              </button>
              <button onClick={() => finish('accept_all')} disabled={busy}
                className="rounded-full border border-(--mp-line) bg-(--mp-surface) px-7 py-3.5 font-semibold text-(--mp-ink) hover:border-(--mp-navy) disabled:opacity-40">
                Use Mindy&apos;s suggestions
              </button>
            </div>

            {saveError && (
              <p role="alert" className="mt-4 rounded-lg border border-(--mp-warn-line) bg-(--mp-warn-bg) px-4 py-3 text-sm text-(--mp-warn)">
                {saveError}{' '}
                {needsSignIn && (
                  <>
                    <a
                      href={signInHref(typeof window === 'undefined' ? null : window.location.pathname + window.location.search)}
                      className="font-semibold underline underline-offset-4"
                    >
                      Sign in
                    </a>
                    {' · '}
                  </>
                )}
                <button onClick={leave} className="underline underline-offset-4">Continue without saving</button>
              </p>
            )}

            <button onClick={() => finish('skip')} disabled={busy}
              className="mt-4 text-sm text-(--mp-muted) underline underline-offset-4 hover:text-(--mp-ink)">
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
   on ? 'border border-(--mp-navy) bg-(--mp-navy-wash) font-semibold text-(--mp-navy)'
      : 'border border-(--mp-line) bg-(--mp-surface) text-(--mp-body) hover:border-(--mp-navy)'].join(' ');

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
    <Suspense fallback={<main className="min-h-dvh bg-(--mp-surface)" />}>
      <CompanySetupInner />
    </Suspense>
  );
}
