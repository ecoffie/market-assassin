'use client';

/**
 * Layout fixture for Ask Mindy (Mindy Chat). Local and preview builds only — the design-fixtures layout
 * returns 404 in production and the page is never indexed.
 *
 * Renders the REAL MindyChatPanel under the same top-bar markup /app uses (and, with ?banner=1, the real
 * TrialOfferBanner a free account sees above it), so responsive checks measure the actual interface.
 * The panel's API calls (/api/app/chat-sessions, /api/app/chat, /api/app/chat/suggestions) are served by
 * the test (Playwright route interception); nothing here talks to production.
 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Menu } from 'lucide-react';
import MindyChatPanel from '@/components/app/panels/MindyChatPanel';
import TrialOfferBanner from '@/components/app/TrialOfferBanner';

function Fixture() {
  const params = useSearchParams();
  const banner = params.get('banner') === '1';
  return (
    <div className="min-h-screen bg-ground-deep text-white">
      <main>
        {banner && <TrialOfferBanner />}
        {/* Same top bar as /app (src/app/app/page.tsx). */}
        <header className="sticky top-0 z-30 bg-ground-deep/90 backdrop-blur border-b border-surface px-4 md:px-6 py-3 md:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button className="md:hidden p-2 -ml-2 text-muted rounded-lg" aria-label="Open menu">
                <Menu className="w-5 h-5" strokeWidth={1.75} />
              </button>
              <span className="hidden lg:inline text-sm text-muted truncate">Logged in as <span className="text-white">fixture@example.com</span></span>
            </div>
            <div className="h-9 w-40 rounded-lg bg-surface" aria-hidden />
          </div>
        </header>
        <MindyChatPanel email="fixture@example.com" tier="pro" onPanelChange={() => {}} />
      </main>
    </div>
  );
}

export default function AskMindyFixturePage() {
  return (
    <Suspense>
      <Fixture />
    </Suspense>
  );
}
