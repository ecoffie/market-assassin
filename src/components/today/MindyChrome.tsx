/**
 * MindyChrome — the app shell (top nav + left icon rail) for /today.
 *
 * Eric 2026-08-15, comparing /today against the live map: *"zillow example they put all this
 * information inside of the map format so the top and side bars look the same not like a whole new
 * page."* The map already has this chrome; /today had only a bare "TODAY'S INTEL" masthead, so the
 * two read as different applications — the same complaint that killed the dark theme.
 *
 * ⚠️ WHY THIS IS A SECOND COPY (a deliberate, guarded tradeoff — read before "fixing" it).
 * The map's chrome is a raw HTML **string** (`ZHEAD_HTML` / the rail nav in
 * `src/app/opportunity-map/route.ts`), not a component, and it is duplicated across ~10 map route
 * files. It also carries map-only inline handlers (`onclick="setMapMode('open')"`) that would be
 * dead on a React page. Extracting ONE shared source means editing all 10 live map routes — which
 * is map-phase work, and Eric's sequence is page → approve → map → flip.
 *
 * So: /today renders this React version now; the map keeps its string version. The drift risk is
 * real and is guarded by `mindy-chrome-parity.unit.test.ts`, which asserts the nav labels and hrefs
 * here still match the ones in the map's route file. When the map phase does the extraction, this
 * component should become a thin wrapper over that shared source and the test should be deleted.
 *
 * Labels/hrefs/icons below are copied VERBATIM from the map so the two surfaces are visually
 * identical — the whole point is that a user cannot tell they changed applications.
 */
import Link from 'next/link';

/** The map's own left-nav items. "Explore" is a quiet eyebrow grouping the two maps, not a link. */
const NAV_LEFT = [
  { label: 'Opportunities', href: '/opportunity-map' },
  { label: 'Network', href: '/opportunity-map?mode=buyers' },
  { label: 'Pursuits', href: '/opportunity-map/pursuits' },
  // Markets = the market-intelligence surface (route is still /reports; only the LABEL changed —
  // renaming the route would break Share links and saved bookmarks). Nav-only, deliberately NOT in
  // the rail below: the nav is where you CHOOSE to go, the rail is what follows you while browsing.
  { label: 'Markets', href: '/opportunity-map/reports' },
];

const NAV_RIGHT = [
  { label: 'Bid with confidence', href: '/bid' },
  { label: 'Pricing', href: '/pricing' },
];

/** Rail icons — the same 24×24 stroked paths the map renders, so the shells match exactly. */
const ICON: Record<string, string> = {
  opportunities: 'M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z',
  network: 'M3.5 19a5.5 5.5 0 0111 0M14 19a4 4 0 016.5-3.1',
  watchlist: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z',
  saved: 'M12 21C5.6 16.5 3 12.9 3 9.1A5 5 0 0112 6a5 5 0 019 3.1c0 3.8-2.6 7.4-9 11.9z',
  pursuits: 'M12 3v3M12 18v3M3 12h3M18 12h3',
};

const RAIL = [
  { key: 'opportunities', label: 'Opportunities', href: '/opportunity-map' },
  { key: 'network', label: 'Network', href: '/opportunity-map?mode=buyers' },
  { sep: true, group: 'Your workspace' },
  { key: 'watchlist', label: 'Watchlist', href: '/opportunity-map/saved' },
  { key: 'saved', label: 'Saved', href: '/opportunity-map/favorites' },
  { key: 'pursuits', label: 'Pursuits', href: '/opportunity-map/pursuits' },
] as const;

function RailIcon({ k }: { k: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
      <path d={ICON[k]} />
      {k === 'opportunities' && <circle cx="12" cy="10" r="2.5" />}
      {k === 'network' && <><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="10" r="2.4" /></>}
      {k === 'pursuits' && <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /></>}
      {k === 'watchlist' && <path d="M13.7 21a2 2 0 01-3.4 0" />}
    </svg>
  );
}

export function MindyTopNav() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
      <nav className="flex items-center gap-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Explore</span>
        {NAV_LEFT.map((n) => (
          <Link key={n.label} href={n.href}
                className="whitespace-nowrap text-[15px] font-bold tracking-tight text-slate-900 hover:text-sky-600">
            {n.label}
          </Link>
        ))}
      </nav>

      {/* Centre-absolute logo, exactly as the map positions it. */}
      <Link href="/app" title="Mindy"
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 no-underline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mindy-logo-icon.png" alt="" className="h-6 w-6" />
        <span className="text-[17px] font-bold tracking-tight text-slate-900">Mindy</span>
      </Link>

      <nav className="flex items-center gap-5">
        {NAV_RIGHT.map((n) => (
          <Link key={n.label} href={n.href}
                className="hidden whitespace-nowrap text-[15px] font-semibold text-slate-700 hover:text-sky-600 sm:block">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function MindyRail() {
  return (
    // Hidden below lg: the map hides its rail on mobile too, and a 72px rail would eat a phone.
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[74px] shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white py-3 lg:flex">
      {RAIL.map((item, i) =>
        'sep' in item ? (
          <div key={`sep-${i}`} className="w-full px-3 pb-1 pt-3">
            <div className="mb-2 border-t border-slate-200" />
            <div className="text-center text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              {item.group}
            </div>
          </div>
        ) : (
          <Link key={item.key} href={item.href} title={item.label}
                className="flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-slate-500 transition hover:bg-slate-50 hover:text-sky-600">
            <RailIcon k={item.key} />
            <span className="text-[10px] font-medium leading-none">{item.label}</span>
          </Link>
        ),
      )}
    </aside>
  );
}

/** Exported for the parity test — the labels/hrefs that must stay in sync with the map. */
export const CHROME_NAV_LABELS = [...NAV_LEFT.map((n) => n.label), ...NAV_RIGHT.map((n) => n.label)];
export const CHROME_RAIL_LABELS = RAIL.filter((r): r is Exclude<typeof r, { sep: true }> => !('sep' in r)).map((r) => r.label);
