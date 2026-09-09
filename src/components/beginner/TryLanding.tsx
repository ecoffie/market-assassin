'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BeginnerOpportunityCard } from '@/components/beginner/BeginnerOpportunityCard';
import type { BeginnerLandingView } from '@/lib/beginner';

const EMPTY_VIEW: BeginnerLandingView = {
  outcome: 'need_followup',
  classification: 'need_followup',
  followUpPrompt: null,
  message: null,
  reveal: [],
  cards: [],
  foundCount: null,
};

export function TryLanding() {
  const [description, setDescription] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<BeginnerLandingView | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [member, setMember] = useState<boolean | null>(null);

  useEffect(() => {
    setMember(
      Boolean(
        localStorage.getItem('mi_beta_auth_token') ||
          localStorage.getItem('mi_beta_2fa_token') ||
          localStorage.getItem('mi_beta_email'),
      ),
    );
  }, []);

  const showFollowUp = view?.outcome === 'need_followup';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setRequestError(null);
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
      const data = (await res.json()) as BeginnerLandingView & { ok?: boolean };
      if (!res.ok || data.ok === false) {
        setView({
          ...EMPTY_VIEW,
          outcome: 'unavailable',
          classification: 'unavailable',
          message: "We couldn't check opportunities right now. Try again in a moment.",
        });
        return;
      }
      setView(data);
    } catch {
      setView({
        ...EMPTY_VIEW,
        outcome: 'unavailable',
        classification: 'unavailable',
        message: "We couldn't check opportunities right now. Try again in a moment.",
      });
    } finally {
      setLoading(false);
    }
  }

  const ctaHref = member ? '/app' : '/signup';
  const showCta =
    member !== null && (view?.outcome === 'results' || view?.outcome === 'empty');

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
          >
            {view.reveal.length > 0 && (
              <div className="space-y-2 rounded-xl border border-hairline bg-surface p-5">
                {view.reveal.map((line) => (
                  <p key={line} className="text-lg text-ink">
                    {line}
                  </p>
                ))}
              </div>
            )}

            {view.outcome === 'empty' && <p className="text-ink-soft">{view.message}</p>}

            {view.outcome === 'unavailable' && <p className="text-warn">{view.message}</p>}

            {view.cards.length > 0 && (
              <div className="space-y-4">
                {view.cards.map((card) => (
                  <BeginnerOpportunityCard
                    key={card.samUrl || card.referenceNumber || card.title}
                    card={card}
                    tone="aha"
                  />
                ))}
              </div>
            )}

            {showCta && (
              <p className="pt-2">
                <Link
                  href={ctaHref}
                  className="inline-flex w-full justify-center rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:bg-accent-hover sm:w-auto"
                >
                  See more opportunities with Mindy
                </Link>
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
