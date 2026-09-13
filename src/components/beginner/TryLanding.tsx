'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BeginnerOpportunityCard } from '@/components/beginner/BeginnerOpportunityCard';
import {
  ctaLabel,
  type CtaVariant,
  type HiddenMarketLandingView,
  type RevealState,
} from '@/lib/beginner';

const EMPTY_VIEW: HiddenMarketLandingView = {
  outcome: 'need_followup',
  classification: 'need_followup',
  followUpPrompt: null,
  message: null,
  reveal: null,
  directCards: [],
  uncoveredCards: [],
  ctaVariant: 'more',
  classificationPath: 'need_followup',
};

const ANON_KEY = 'mindy_anon_id';
const CTA_KEY = 'mindy_try_cta_variant';

function anonId(): string {
  try {
    let v = localStorage.getItem(ANON_KEY);
    if (!v) {
      v =
        'anon:' +
        (crypto?.randomUUID
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
            }));
      localStorage.setItem(ANON_KEY, v);
    }
    return v;
  } catch {
    return '';
  }
}

function stickyCtaVariant(revealState: RevealState | undefined): CtaVariant {
  if (revealState !== 'strong') return 'more';
  try {
    let v = localStorage.getItem(CTA_KEY);
    if (v !== 'more' && v !== 'full_market') {
      v = Math.random() < 0.5 ? 'more' : 'full_market';
      localStorage.setItem(CTA_KEY, v);
    }
    return v as CtaVariant;
  } catch {
    return 'more';
  }
}

function track(action: string, extra: Record<string, unknown> = {}) {
  try {
    const token = localStorage.getItem('mi_beta_auth_token') || '';
    const memberEmail = (localStorage.getItem('mi_beta_email') || '').toLowerCase().trim();
    const signedIn = Boolean(token && memberEmail.includes('@'));
    const email = signedIn ? memberEmail : anonId();
    if (!email) return;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signedIn) headers['x-mi-auth-token'] = token;
    void fetch('/api/app/engagement', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        eventType: 'tool_use',
        eventSource: 'beginner_try',
        metadata: {
          action,
          signedIn,
          ...extra,
        },
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* telemetry must never break the aha */
  }
}

function RevealHero({ view }: { view: HiddenMarketLandingView }) {
  const reveal = view.reveal;
  if (view.outcome === 'need_followup' && view.message) {
    return <p className="text-lg text-ink">{view.message}</p>;
  }
  if (!reveal) return null;

  const direct = reveal.directMatchCount;
  const expanded = reveal.expandedMatchCount;
  const total = reveal.totalUniqueCount;

  switch (reveal.revealState) {
    case 'strong':
      return (
        <p className="text-lg text-ink">
          {total == null ? (
            <>
              You&apos;d have found <strong>{direct}</strong>. Mindy found{' '}
              <strong>{expanded}</strong> more that those words missed.
            </>
          ) : (
            <>
              You&apos;d have found <strong>{direct}</strong>. Mindy found <strong>{total}</strong>.
            </>
          )}{' '}
          Government buyers describe this work in ways most people would never search.
        </p>
      );
    case 'expanded_only':
      return (
        <p className="text-lg text-ink">
          Your words didn&apos;t match open solicitations directly — but Mindy translated what you
          do and found <strong>{expanded}</strong> in related government buying categories.
        </p>
      );
    case 'direct_only':
      return (
        <p className="text-lg text-ink">
          Government buys this. Mindy found <strong>{direct}</strong> current{' '}
          {direct === 1 ? 'opportunity' : 'opportunities'} matching what you described.
        </p>
      );
    case 'thin':
      return (
        <p className="text-lg text-ink">
          Government buys this — the open market is small right now. Here is what we found.
        </p>
      );
    case 'unavailable':
      return (
        <p className="text-lg text-ink">Mindy couldn&apos;t measure the broader market right now.</p>
      );
  }
}

export function TryLanding() {
  const [description, setDescription] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<HiddenMarketLandingView | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [member, setMember] = useState<boolean | null>(null);
  const [ctaVariant, setCtaVariant] = useState<CtaVariant>('more');
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    setMember(
      Boolean(
        localStorage.getItem('mi_beta_auth_token') ||
          localStorage.getItem('mi_beta_2fa_token') ||
          localStorage.getItem('mi_beta_email'),
      ),
    );
  }, []);

  useEffect(() => {
    if (!view || loading) return;
    const key = `${view.outcome}:${view.classificationPath}:${view.reveal?.revealState ?? ''}`;
    if (shownFor.current === key) return;
    shownFor.current = key;
    const reveal = view.reveal;
    const meta = {
      revealState: reveal?.revealState ?? null,
      directMatchCount: reveal?.directMatchCount ?? null,
      expandedMatchCount: reveal?.expandedMatchCount ?? null,
      totalUniqueCount: reveal?.totalUniqueCount ?? null,
      classificationPath: view.classificationPath,
    };
    track('beginner_reveal_shown', meta);
    if (reveal?.revealState === 'strong' || reveal?.revealState === 'expanded_only') {
      track('beginner_hidden_market_shown', meta);
    }
  }, [view, loading]);

  const showFollowUp = view?.outcome === 'need_followup';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setRequestError(null);
    shownFor.current = null;
    track('beginner_search_started', { classificationPath: null });
    try {
      const res = await fetch('/api/beginner/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          followUp: showFollowUp ? followUp : undefined,
        }),
      });
      if (res.status === 429) {
        setView(null);
        setRequestError("We couldn't check opportunities right now. Try again in a moment.");
        return;
      }
      const data = (await res.json()) as HiddenMarketLandingView & { ok?: boolean };
      if (!res.ok || data.ok === false) {
        setView({
          ...EMPTY_VIEW,
          outcome: 'unavailable',
          classification: 'unavailable',
          classificationPath: 'unavailable',
          message: "We couldn't check opportunities right now. Try again in a moment.",
          reveal: {
            directMatchCount: null,
            expandedMatchCount: null,
            totalUniqueCount: null,
            directLabel: 'Matches what you described',
            expandedLabel: 'Opportunities Mindy uncovered',
            revealState: 'unavailable',
            explanation: "Mindy couldn't measure the broader market right now.",
          },
        });
        return;
      }
      const variant = stickyCtaVariant(data.reveal?.revealState);
      setCtaVariant(variant);
      setView(data);
    } catch {
      setView({
        ...EMPTY_VIEW,
        outcome: 'unavailable',
        classification: 'unavailable',
        classificationPath: 'unavailable',
        message: "We couldn't check opportunities right now. Try again in a moment.",
        reveal: {
          directMatchCount: null,
          expandedMatchCount: null,
          totalUniqueCount: null,
          directLabel: 'Matches what you described',
          expandedLabel: 'Opportunities Mindy uncovered',
          revealState: 'unavailable',
          explanation: "Mindy couldn't measure the broader market right now.",
        },
      });
    } finally {
      setLoading(false);
    }
  }

  const ctaHref = member ? '/app' : '/signup';
  const showCta = member !== null && (view?.outcome === 'results' || view?.outcome === 'empty');
  const reveal = view?.reveal ?? null;
  const showUncovered =
    (reveal?.revealState === 'strong' || reveal?.revealState === 'expanded_only') &&
    (view?.uncoveredCards.length ?? 0) > 0;
  const showTerms =
    showUncovered && (reveal?.translatedTerms?.length ?? 0) > 0 && reveal?.translatedTerms;

  return (
    <main className="min-h-screen bg-ground-deep px-4 py-12 text-ink">
      <div className="mx-auto w-full max-w-2xl">
        <p className="mb-8 text-sm text-muted">
          <Link href="/" className="text-accent hover:underline">
            Mindy
          </Link>
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          See where the government buys what you sell
        </h1>
        <p className="mt-3 text-lg text-ink-soft">
          Describe your business in plain English. No codes required.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label htmlFor="business-do" className="block text-sm font-medium text-ink-soft">
            What does your business do?
          </label>
          <textarea
            id="business-do"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="I clean office buildings"
            rows={3}
            maxLength={400}
            required
            className="w-full rounded-xl border border-hairline bg-surface px-4 py-3 text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
          />
          {showFollowUp && (
            <div>
              <label htmlFor="business-followup" className="block text-sm font-medium text-ink-soft">
                {view?.followUpPrompt || 'What do you actually do for customers?'}
              </label>
              <textarea
                id="business-followup"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                rows={2}
                maxLength={400}
                className="mt-2 w-full rounded-xl border border-hairline bg-surface px-4 py-3 text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !description.trim()}
            className="w-full rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Looking…' : 'Show me where the government buys this'}
          </button>
        </form>

        {loading && (
          <p className="mt-8 text-muted" role="status">
            Looking for where the government buys this…
          </p>
        )}

        {requestError && !loading && (
          <p className="mt-8 text-warn" role="status">
            {requestError}
          </p>
        )}

        {view && !loading && (
          <section
            className="mt-10 space-y-6"
            data-outcome={view.outcome}
            data-classification={view.classification}
            data-reveal-state={reveal?.revealState ?? ''}
          >
            {view.outcome !== 'need_followup' && (
              <div className="space-y-2 rounded-xl border border-hairline bg-surface p-5">
                <RevealHero view={view} />
                {showTerms && (
                  <p className="text-sm text-ink-soft">
                    Government calls this work things like:{' '}
                    <strong>{showTerms.join(' · ')}</strong>
                  </p>
                )}
                {reveal?.agencies && reveal.agencies.count >= 2 && (
                  <p className="text-sm text-muted">
                    Listings from {reveal.agencies.count} agencies.
                  </p>
                )}
              </div>
            )}

            {view.outcome === 'empty' && <p className="text-ink-soft">{view.message}</p>}

            {view.directCards.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  {reveal?.directLabel || 'Matches what you described'}
                </h2>
                {view.directCards.map((card) => (
                  <BeginnerOpportunityCard
                    key={card.samUrl || card.referenceNumber || card.title}
                    card={card}
                    tone="aha"
                    onOpen={() =>
                      track('beginner_opportunity_opened', {
                        revealState: reveal?.revealState ?? null,
                        classificationPath: view.classificationPath,
                        group: 'direct',
                      })
                    }
                  />
                ))}
              </div>
            )}

            {showUncovered && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  {reveal?.expandedLabel || 'Opportunities Mindy uncovered'}
                </h2>
                {view.uncoveredCards.map((card) => (
                  <BeginnerOpportunityCard
                    key={card.samUrl || card.referenceNumber || card.title}
                    card={card}
                    tone="aha"
                    onOpen={() =>
                      track('beginner_opportunity_opened', {
                        revealState: reveal?.revealState ?? null,
                        classificationPath: view.classificationPath,
                        group: 'uncovered',
                      })
                    }
                  />
                ))}
              </div>
            )}

            {showCta && (
              <p className="pt-2">
                <Link
                  href={ctaHref}
                  className="inline-flex w-full justify-center rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:bg-accent-hover sm:w-auto"
                  onClick={() =>
                    track('beginner_signup_clicked', {
                      revealState: reveal?.revealState ?? null,
                      directMatchCount: reveal?.directMatchCount ?? null,
                      expandedMatchCount: reveal?.expandedMatchCount ?? null,
                      totalUniqueCount: reveal?.totalUniqueCount ?? null,
                      classificationPath: view.classificationPath,
                      ctaVariant,
                    })
                  }
                >
                  {ctaLabel(ctaVariant, reveal?.revealState ?? 'direct_only')}
                </Link>
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
