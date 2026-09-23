/**
 * LEGACY CUSTOMER ENTRY POINTS → the current Mindy workspace. ONE table, one resolver.
 *
 * ── THE FAILURE THIS CLOSES (reported 2026-09-23) ──────────────────────────────────────
 * A customer paid $149 for Mindy Pro and reported being disappointed. Measured, read-only:
 *
 *   - Both MI Pro Stripe payment links ($149/mo, $1,490/yr) are configured to send the buyer
 *     to `getmindy.ai/briefings?welcome=true` — the pre-/app "Unified MI" dashboard. 58 paid
 *     monthly + 4 paid annual checkouts went through them (2026-05-10 → 2026-09-22).
 *   - `/briefings` with no saved legacy email bounces to `/alerts/signup` (a FREE signup
 *     form, shown to someone who just paid). With one, its "Market Research" card links to
 *     `/federal-market-assassin`, which the proxy sends to `/market-assassin-locked` for any
 *     buyer without the old `ma:` grant — i.e. every Mindy Pro buyer — where entering their
 *     email answers "No access found for this email. Please purchase below."
 *   - Every host other than `getmindy.ai` (e.g. `market-assassin.vercel.app/`) still served the
 *     old GovCon Giants "Government Contracting Intelligence Tools" card grid at `/`.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────────────────
 *   - A legacy path with a current equivalent lands on THAT equivalent (panel preserved).
 *   - Otherwise it lands on the workspace home (`/app`), which signs a logged-out visitor in
 *     and shows a signed-in one their dashboard.
 *   - Only a small allowlist of query params is carried over (`email` is prefill-only in
 *     /app; identity always comes from the live session). Nothing here can produce an
 *     external URL, and no destination is itself a legacy path, so no redirect loops.
 *
 * ── THE STANDALONE MARKET ASSASSIN TOOL (retired 2026-09-23) ─────────────────────────
 * Entitlement compatibility was established BEFORE retiring it: `/app` resolves its tier
 * through `verifyMIAccess` (src/lib/api-auth.ts), which counts ANY legacy paid grant —
 * `ma:` (standard or premium), `contentgen:`, `ospro:`, `recompete:`, `dbaccess:`,
 * `briefings:` — as Pro, and `/api/reports/generate-all` authorizes through the same
 * function. So an MA purchaser gets every Market Research report in `/app?panel=research`
 * (Pro = all reports; MA Premium was 8). The standalone tool kept no server-side saved
 * reports (generate-on-demand; only a monthly usage counter), so no saved work moves.
 *
 * SHARED-PASSWORD HOLDERS — a bounded transition, not an exception. `/api/verify-ma-password`
 * grants an ANONYMOUS cookie (`ma_access_email=authorized-user`). That value is used as the
 * "email" for report generation, where it resolves to NO grants — so the old tool only ever gave
 * these holders FREE-tier reports, the same thing a free Mindy account gives. By default they are
 * routed to /app like everyone else. `LEGACY_SHARED_PASSWORD_ACCESS=on` opens an explicit, temporary
 * grace window (a release decision with a sunset — see the review packet); unset it to end it.
 *
 * Single-use report codes (`/access/<CODE>`) are redeemed inside Mindy as a report credit —
 * see src/app/access/[code]/page.tsx.
 *
 * ⚠️ NOT redirected, on purpose — these are not the old combined interface:
 *   /briefings/feedback/*       email thumbs-up/down landing pages
 *   /access/[code]              admin-issued single-use report codes (anonymous)
 *   /alerts/preferences         token-linked alert preferences from every alert email
 *   /alerts/signup              the free-alerts lead form linked from marketing
 */

/** The current workspace. */
export const WORKSPACE_PATH = '/app';
export const MINDY_ORIGIN = 'https://getmindy.ai';

/**
 * A link into the current workspace. Relative by default (in-app); `absolute` for emails.
 * `email` only pre-fills /app's sign-in form — identity always comes from the live session.
 */
export function workspaceUrl(opts: { panel?: string; email?: string; absolute?: boolean } = {}): string {
  const q = new URLSearchParams();
  if (opts.panel) q.set('panel', opts.panel);
  const email = (opts.email || '').trim().toLowerCase();
  if (email) q.set('email', email);
  const qs = q.toString();
  return `${opts.absolute ? MINDY_ORIGIN : ''}${WORKSPACE_PATH}${qs ? `?${qs}` : ''}`;
}

/** Where a standalone Market Assassin customer belongs now. */
export const MARKET_RESEARCH_PANEL = 'research';

/**
 * Old `/briefings` sidebar panel ids → current `/app` panel ids. A legacy panel with no
 * current equivalent (content, planner, sbir, start) maps to nothing → workspace home.
 */
const LEGACY_PANEL_TO_APP_PANEL: Record<string, string> = {
  dashboard: 'dashboard',
  alerts: 'alerts',
  research: 'research',
  forecasts: 'forecasts',
  recompetes: 'recompetes',
  contractors: 'contractors',
  pipeline: 'pipeline',
  contacts: 'contacts',
  grants: 'grants',
  settings: 'settings',
};

/** Query params that are safe and meaningful to carry into /app. */
const CARRIED_PARAMS = ['email', 'notice'] as const;

interface LegacyRoute {
  /** Exact pathname (no trailing slash). */
  path: string;
  /** Panel to open when the legacy URL does not name one. */
  defaultPanel?: string;
  /** Force this panel regardless of the URL's own `panel` (a standalone tool's only job). */
  fixedPanel?: string;
  /** Return true to leave the request alone (an access class /app cannot honour yet). */
  keepFor?: (ctx: LegacyRequestContext) => boolean;
  /** A non-workspace destination (retired SALES pages go to /pricing, not /app). */
  target?: string;
}

export interface LegacyRequestContext {
  /** Value of the legacy `ma_access_email` cookie, if any. */
  maCookie?: string | null;
  /** True only while the explicit shared-password grace window is open (env switch). */
  sharedPasswordGrace?: boolean;
}

/** The env switch that opens the temporary shared-password grace window. */
export const SHARED_PASSWORD_GRACE_ENV = 'LEGACY_SHARED_PASSWORD_ACCESS';
export function sharedPasswordGraceOpen(env: Record<string, string | undefined> = process.env): boolean {
  return (env[SHARED_PASSWORD_GRACE_ENV] || '').trim().toLowerCase() === 'on';
}

/** The anonymous shared-password cookie value set by /api/verify-ma-password. */
export const ANONYMOUS_MA_COOKIE = 'authorized-user';
const keepAnonymousMaHolder = (ctx: LegacyRequestContext) =>
  ctx.sharedPasswordGrace === true && ctx.maCookie === ANONYMOUS_MA_COOKIE;

/**
 * Every legacy customer entry point handled by the proxy. Exact paths only — a prefix match
 * would swallow `/briefings/feedback/thanks`, which email links still rely on.
 */
export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { path: '/briefings' },
  { path: '/briefings/dashboard', defaultPanel: 'dashboard' },
  { path: '/bd-assist', defaultPanel: 'pipeline' },
  // Standalone Market Assassin — every entry point lands on Market Research in /app.
  { path: '/federal-market-assassin', fixedPanel: MARKET_RESEARCH_PANEL, keepFor: keepAnonymousMaHolder },
  { path: '/federal-market-assassin/success', fixedPanel: MARKET_RESEARCH_PANEL },
  { path: '/market-assassin-locked', fixedPanel: MARKET_RESEARCH_PANEL },
  { path: '/market-assassin', fixedPanel: MARKET_RESEARCH_PANEL },
  // Opportunity Hunter (+ Pro, which Alert Pro and FHC also grant via `ospro:`): agency spend by
  // NAICS/state/set-aside → Market Research. `ospro:` is Pro in /app. Gaps flagged in the packet:
  // CSV export of the agency list, the per-office "Office ID → SAM" drill.
  { path: '/opportunity-hunter', fixedPanel: MARKET_RESEARCH_PANEL },
  { path: '/opportunity-scout', fixedPanel: MARKET_RESEARCH_PANEL },
  { path: '/opportunity-scout.html', fixedPanel: MARKET_RESEARCH_PANEL },
  // Recompete Tracker: /recompete keeps its SEO landing (layout.tsx) and its legacy gate body is
  // replaced by a Mindy entry (src/app/recompete/page.tsx) — so it is NOT redirected here.
  // prime-lookup.html (incumbent search over the June snapshot) → the live Recompetes panel.
  // Gaps flagged: CSV/Excel/PDF export, incumbent-name search, contract-value filter.
  { path: '/prime-lookup.html', fixedPanel: 'recompetes' },
  // /start — free-alerts onboarding that still sold Alert Pro ($19). Mindy onboarding owns this.
  { path: '/start' },
  // Retired SALES pages with a still-live legacy checkout → the current pricing page.
  { path: '/bundles/ultimate', target: '/pricing' },
  { path: '/contractor-database-product', target: '/pricing' },
];

const LEGACY_BY_PATH = new Map(LEGACY_ROUTES.map((r) => [r.path, r]));

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '');
  return pathname;
}

export function isLegacyCustomerPath(pathname: string): boolean {
  return LEGACY_BY_PATH.has(normalizePath(pathname));
}

/** Map an old `/briefings` panel id (or an `/app` id passed through) to a current panel. */
export function mapLegacyPanel(raw: string | null | undefined): string | null {
  const key = String(raw || '').trim().toLowerCase();
  return LEGACY_PANEL_TO_APP_PANEL[key] ?? null;
}

/**
 * Resolve a legacy URL to its current destination (a relative path + query), or null when
 * the path is not a legacy entry point. Pure: no I/O, no host, never an absolute URL.
 */
export function resolveLegacyDestination(
  pathname: string,
  searchParams: URLSearchParams,
  ctx: LegacyRequestContext = {},
): string | null {
  const route = LEGACY_BY_PATH.get(normalizePath(pathname));
  if (!route) return null;
  if (route.keepFor?.(ctx)) return null;

  const out = new URLSearchParams();
  if (route.target) {
    for (const [k, v] of searchParams) if (/^utm_[a-z]+$/.test(k) && v.length <= 200) out.set(k, v);
    const qs = out.toString();
    return qs ? `${route.target}?${qs}` : route.target;
  }

  // Panel: a fixed one (standalone tool) wins; else an explicit one on the old URL, then
  // the route default. `?setup=true` was the old "open my settings" deep link.
  const panel =
    mapLegacyPanel(route.fixedPanel) ??
    mapLegacyPanel(searchParams.get('panel')) ??
    mapLegacyPanel(searchParams.get('tab')) ??
    (searchParams.get('setup') === 'true' ? 'settings' : null) ??
    mapLegacyPanel(route.defaultPanel);
  if (panel) out.set('panel', panel);

  for (const key of CARRIED_PARAMS) {
    const v = searchParams.get(key);
    if (v && v.length <= 320) out.set(key, v);
  }

  // Attribution survives the hop (AttributionTracker reads utm_* on the landing page).
  for (const [k, v] of searchParams) {
    if (/^utm_[a-z]+$/.test(k) && v.length <= 200) out.set(k, v);
  }

  const qs = out.toString();
  return qs ? `${WORKSPACE_PATH}?${qs}` : WORKSPACE_PATH;
}
