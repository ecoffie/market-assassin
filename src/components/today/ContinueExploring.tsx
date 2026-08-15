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

type Recent = { label: string; href: string; detail: string };

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

    fetch(`/api/app/saved-searches?email=${encodeURIComponent(email)}`, {
      headers: { 'x-mi-auth-token': token, 'x-user-email': email },
    })
      .then((r) => r.json())
      .then((d) => {
        const rows = Array.isArray(d?.searches) ? d.searches : [];
        setRecents(
          rows.slice(0, 4).map((s: Record<string, unknown>) => ({
            label: String(s.name || 'Saved search'),
            detail: s.mode ? `${String(s.mode)} search` : 'Saved search',
            href: `/opportunity-map?saved=${encodeURIComponent(String(s.id || ''))}`,
          })),
        );
      })
      .catch(() => { /* additive — the section just doesn't render */ });
  }, []);

  if (signedIn === null) return null;   // pre-mount: render nothing rather than the wrong variant

  if (signedIn && recents.length > 0) {
    return (
      <section className="mb-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Continue where you left off
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {recents.map((r) => (
            <Link
              key={r.href}
              href={r.href}
              className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 transition hover:border-white/25"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-white">{r.label}</span>
                <span className="block text-xs text-slate-500">{r.detail}</span>
              </span>
              <span className="whitespace-nowrap text-xs font-medium text-sky-300">Continue →</span>
            </Link>
          ))}
        </div>
      </section>
    );
  }

  // First-time (or a signed-in user with nothing saved yet): four doors, no product tour.
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Start anywhere</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ENTRY_POINTS.map(({ icon: Icon, title, detail, href }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/25 hover:bg-white/[0.08]"
          >
            <Icon className="h-5 w-5 text-sky-300" strokeWidth={2} />
            <div className="mt-2.5 text-sm font-semibold text-white">{title}</div>
            <div className="mt-0.5 text-xs leading-snug text-slate-400">{detail}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
