'use client';
/**
 * The TWO-AUDIENCE split on Today's Intel (Eric 2026-08-15).
 *
 *   RETURNING  → "Continue where you left off" — their saved searches / recent markets, each with
 *                its own door back into the map. This is Zillow's "Continue searching for: Belle
 *                Glade, FL" idea, which translates directly: habit is the goal.
 *   FIRST-TIME → four entry points into the same platform. NOT Zillow's illustrated "Buy a home /
 *                Finance a home / Sell a home" marketing cards — those explain a product. These
 *                are doors into one.
 *
 * Signed-out users are never shown a blank wall or a login gate here: the aggregate numbers above
 * already proved the value, and these four doors let them act on it. Data behind glass.
 *
 * Reads the same MI token the rest of /app uses; no session → the first-time view. Rendering
 * decisions happen after mount so a signed-in user is never briefly shown the wrong variant.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Compass, Building2, Users, FileText } from 'lucide-react';

type Recent = { label: string; href: string; detail: string; freshCount: number | null };

const ENTRY_POINTS = [
  {
    icon: Compass,
    title: 'Find opportunities',
    detail: 'Browse what agencies are buying, on a map',
    href: '/opportunity-map',
  },
  {
    icon: Building2,
    title: 'Research a market',
    detail: 'Who buys your service, and how much they spend',
    href: '/app?panel=research',
  },
  {
    icon: Users,
    title: 'Explore buyers',
    detail: 'The contracting officers behind the notices',
    href: '/opportunity-map?mode=buyers',
  },
  {
    icon: FileText,
    title: 'Win contracts',
    detail: 'Turn a solicitation into a compliant draft',
    href: '/app?panel=proposals',
  },
];

export default function ContinueExploring() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [recents, setRecents] = useState<Recent[]>([]);

  useEffect(() => {
    let token = '';
    try { token = localStorage.getItem('mi_beta_auth_token') || ''; } catch { /* private mode */ }
    if (!token) { setSignedIn(false); return; }
    setSignedIn(true);

    // Saved searches ARE "where you left off" — the markets this user already told us they care
    // about. A failed/empty read simply renders no row; we never invent a recent market.
    // NOTE: this route requires the email as a QUERY PARAM (it 400s on the token alone), and it
    // returns { searches: [...] } with a NOT NULL `name` column — verified against the route and
    // the 20260725_saved_searches migration rather than assumed.
    let email = '';
    try {
      const seg = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      const padded = seg + '='.repeat((4 - (seg.length % 4)) % 4);
      email = String(JSON.parse(atob(padded))?.email || '').toLowerCase();
    } catch { /* unreadable token → fall through to the entry points */ }
    if (!email) return;

    // TWO calls, deliberately. The list gives the saved searches; `?badge=1` gives the per-search
    // count of matches the user has NOT yet seen. Eric 2026-08-15: "it should remind me why I
    // care… That feels like something has changed since yesterday." The old `detail` line was a
    // literal template ("open search") — it restated the mode and told the user nothing.
    //
    // The count comes from the EXISTING badge endpoint, which runs the SAME shared
    // `applyMapFilters` engine the saved-search alert cron uses — so the number on the card and
    // the number in the alert email can never disagree. It also already carries the honest guard:
    // a search that was never baselined reports 0 rather than flashing its whole match set as new.
    Promise.all([
      fetch(`/api/app/saved-searches?email=${encodeURIComponent(email)}`, {
        headers: { 'x-mi-auth-token': token, 'x-user-email': email },
      }).then((r) => r.json()).catch(() => null),
      fetch(`/api/app/saved-searches?badge=1&email=${encodeURIComponent(email)}`, {
        headers: { 'x-mi-auth-token': token, 'x-user-email': email },
      }).then((r) => r.json()).catch(() => null),
    ])
      .then(([list, badge]) => {
        const rows = Array.isArray(list?.searches) ? list.searches : [];
        // id → fresh count. Absent id = unknown, which renders NO count line (never "0 new").
        const fresh = new Map<string, number>();
        if (Array.isArray(badge?.perSearch)) {
          for (const p of badge.perSearch as Array<{ id?: string; count?: number }>) {
            if (p?.id && typeof p.count === 'number') fresh.set(String(p.id), p.count);
          }
        }
        setRecents(
          rows.slice(0, 4).map((s: Record<string, unknown>) => {
            const id = String(s.id || '');
            const n = fresh.get(id);
            return {
              label: String(s.name || 'Saved search'),
              // Only claim "new" when we actually counted some. Otherwise fall back to the
              // market's own words (its mode) rather than printing a hollow zero.
              detail: n ? `${n.toLocaleString()} new ${n === 1 ? 'opportunity' : 'opportunities'}` : '',
              freshCount: n ?? null,
              // ?ss= is what the map reads (route.ts, the saved-search boot handler, which
              // loads the search and runs it through __applySavedSearch). ?saved= was never
              // read by anything — this component is currently orphaned, so the wrong param
              // was inert, but it would have landed on the unfiltered national map the moment
              // the section was revived.
              href: `/opportunity-map?ss=${encodeURIComponent(id)}`,
            };
          }),
        );
      })
      .catch(() => { /* additive — the section just doesn't render */ });
  }, []);

  if (signedIn === null) return null;   // pre-mount: render nothing rather than the wrong variant

  if (signedIn && recents.length > 0) {
    return (
      <section>
        <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Continue where you left off
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {recents.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3.5 transition hover:border-slate-400"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-slate-900">{r.label}</span>
                {/* The WHY-I-CARE line. A real count renders as emerald "N new opportunities" —
                    the same signal a returning visitor gets from an alert email. When the count is
                    unknown (badge call failed / search never baselined) we render NOTHING rather
                    than a hollow "0 new": absence is honest, a fabricated zero is not. */}
                {r.freshCount ? (
                  <span className="mt-0.5 block text-xs font-semibold text-emerald-700">{r.detail}</span>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-xs font-medium text-sky-700">Continue →</span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  // First-time (or a signed-in user with nothing saved yet): four doors, no product tour.
  return (
    <section>
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Start anywhere</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ENTRY_POINTS.map(({ icon: Icon, title, detail, href }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-lg border border-slate-200 p-4 transition hover:border-slate-400 hover:shadow-sm"
          >
            <Icon className="h-5 w-5 text-sky-700" strokeWidth={2} />
            <div className="mt-2.5 text-[15px] font-semibold text-slate-900">{title}</div>
            <div className="mt-0.5 text-xs leading-snug text-slate-500">{detail}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
