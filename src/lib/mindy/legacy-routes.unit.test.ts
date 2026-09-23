/**
 * LEGACY CUSTOMER ENTRY POINTS — every inventoried legacy route resolves to the current
 * workspace, with meaning preserved and no way to loop or leave the site.
 *
 * THE REPORTED CASE (2026-09-23): a $149 Mindy Pro buyer was sent by Stripe to
 * `/briefings?welcome=true` — the retired pre-/app dashboard — and from there into the
 * Market Assassin access gate, which told them to purchase. See legacy-routes.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  resolveLegacyDestination, isLegacyCustomerPath, mapLegacyPanel, LEGACY_ROUTES, WORKSPACE_PATH,
} from './legacy-routes';

const resolve = (url: string) => {
  const u = new URL(url, 'https://getmindy.ai');
  return resolveLegacyDestination(u.pathname, u.searchParams);
};

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
/** Source with comments removed — fixes QUOTE the old URLs while explaining them. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('⚠️ THE REPORTED CASE — Stripe MI Pro success URL', () => {
  it('/briefings?welcome=true lands on the workspace, not the legacy dashboard', () => {
    expect(resolve('/briefings?welcome=true')).toBe('/app');
  });
  it('the annual link (same success URL) lands on the workspace too', () => {
    expect(resolve('https://getmindy.ai/briefings?welcome=true')).toBe('/app');
  });
});

describe('meaningful destinations are preserved', () => {
  it.each([
    ['/briefings?panel=research', '/app?panel=research'],
    ['/briefings?panel=pipeline', '/app?panel=pipeline'],
    ['/briefings?tab=forecasts', '/app?panel=forecasts'],
    ['/briefings?panel=grants', '/app?panel=grants'],
    ['/briefings?setup=true', '/app?panel=settings'],
    ['/briefings/dashboard', '/app?panel=dashboard'],
    ['/bd-assist', '/app?panel=pipeline'],
  ])('%s → %s', (from, to) => {
    expect(resolve(from)).toBe(to);
  });

  it('legacy-only panels with no current equivalent fall back to the workspace home', () => {
    for (const p of ['content', 'planner', 'sbir', 'start', 'nonsense']) {
      expect(resolve(`/briefings?panel=${p}`)).toBe('/app');
    }
  });

  it('an explicit panel beats the route default', () => {
    expect(resolve('/bd-assist?panel=contacts')).toBe('/app?panel=contacts');
  });

  it('email (prefill-only in /app) and notice deep links survive; utm attribution survives', () => {
    expect(resolve('/briefings?email=a%40b.com&panel=alerts&utm_source=email&utm_campaign=x'))
      .toBe('/app?panel=alerts&email=a%40b.com&utm_source=email&utm_campaign=x');
    expect(resolve('/briefings?notice=abc123')).toBe('/app?notice=abc123');
  });

  it('tolerates a trailing slash', () => {
    expect(resolve('/briefings/')).toBe('/app');
  });
});

describe('safety — no loops, no external targets, no over-matching', () => {
  it('drops everything not on the allowlist (next, returnTo, recover, arbitrary junk)', () => {
    expect(resolve('/briefings?next=https://evil.com&returnTo=//evil.com&recover=1&x=1')).toBe('/app');
  });

  it('never produces an absolute or protocol-relative URL', () => {
    for (const r of LEGACY_ROUTES) {
      const d = resolve(`${r.path}?panel=research&email=%2F%2Fevil.com`)!;
      expect(d.startsWith('/app')).toBe(true);
      expect(d.startsWith('//')).toBe(false);
    }
  });

  it('no destination is itself a legacy path (no redirect loop)', () => {
    for (const r of LEGACY_ROUTES) {
      const d = resolve(r.path)!;
      expect(isLegacyCustomerPath(new URL(d, 'https://x').pathname)).toBe(false);
    }
    expect(isLegacyCustomerPath(WORKSPACE_PATH)).toBe(false);
  });

  it('does not touch pages that must keep working', () => {
    for (const p of [
      '/app', '/briefings/feedback/thanks', '/briefings/feedback/error', '/briefings/lindy-setup',
      '/federal-market-assassin', '/market-assassin-locked', '/alerts/preferences', '/alerts/signup',
      '/api/briefings/feedback', '/opportunity-map', '/today', '/', '/briefingsx',
    ]) {
      expect(resolve(p)).toBeNull();
    }
  });

  it('caps oversized carried values instead of forwarding them', () => {
    expect(resolve(`/briefings?email=${'a'.repeat(400)}`)).toBe('/app');
  });

  it('mapLegacyPanel is total', () => {
    expect(mapLegacyPanel(null)).toBeNull();
    expect(mapLegacyPanel('RESEARCH')).toBe('research');
  });
});

describe('wiring — the proxy actually runs for every legacy route', () => {
  const proxy = read('proxy.ts');
  it('every LEGACY_ROUTES path is in the proxy matcher', () => {
    for (const r of LEGACY_ROUTES) expect(proxy).toContain(`'${r.path}'`);
  });
  it('the proxy calls the resolver with a temporary (307) redirect', () => {
    expect(proxy).toMatch(/resolveLegacyDestination\(pathname, request\.nextUrl\.searchParams\)/);
    expect(proxy).toMatch(/NextResponse\.redirect\(new URL\(legacyDestination, request\.url\), 307\)/);
  });
});

describe('the other two legacy corridors', () => {
  it('the root page no longer renders the old combined tools grid', () => {
    const page = read('app/page.tsx');
    expect(page).not.toContain('Government Contracting Intelligence Tools');
    expect(page).not.toMatch(/href="\/federal-market-assassin"/);
    // …and still forwards Supabase recovery/invite tokens before anything else.
    expect(page).toMatch(/type === 'recovery'[\s\S]*'\/app\/reset-password'/);
    expect(page).toMatch(/window\.location\.replace\(\(canonical \? 'https:\/\/getmindy\.ai' : ''\) \+ '\/app'/);
  });

  it('the Market Assassin gate sends a non-MA customer to Mindy research, not "purchase below"', () => {
    const gate = read('app/market-assassin-locked/page.tsx');
    expect(gate).not.toContain('Please purchase below');
    expect(gate).toContain('/app?panel=research&email=');
  });

  it('bd-assist page fallback targets the workspace, not /briefings', () => {
    const bd = read('app/bd-assist/page.tsx');
    expect(bd).not.toMatch(/redirect\('\/briefings'\)/);
    expect(bd).toContain("redirect('/app?panel=pipeline')");
  });
});

describe('links are fixed at the SOURCE, not only redirected', () => {
  // Customer-facing surfaces that used to hand out /briefings or /bd-assist. The redirect
  // would catch them, but a redirect is a patch over a link we keep distributing.
  const CUSTOMER_PAGES = [
    'app/opportunity/mute/success/page.tsx',
    'app/opportunity/mute/already-muted/page.tsx',
    'app/opportunity/mute/error/page.tsx',
    'app/pipeline/page.tsx',
    'app/pipeline/already-tracking/page.tsx',
    'app/pipeline/error/page.tsx',
    'app/contacts/page.tsx',
    'app/shared/opp/[shareId]/SharedOpportunityClient.tsx',
    'app/alerts/signup/page.tsx',
    'app/federal-market-assassin/page.tsx',
    'app/market-intelligence/page.tsx',
    'app/purchase/success/page.tsx',
    'app/api/activate/route.ts',
  ];
  const LEGACY_LINK = /["'`](?:https:\/\/getmindy\.ai)?\/(?:briefings|bd-assist)(?:[?"'`/]|$)/;

  it.each(CUSTOMER_PAGES)('%s no longer links into /briefings or /bd-assist', (rel) => {
    expect(code(rel)).not.toMatch(LEGACY_LINK);
  });

  it('the post-purchase page links no 404s or retired sales pages', () => {
    const page = code('app/purchase/success/page.tsx');
    for (const dead of ['/recompete-contracts', '/prime-lookup', '/content-generator-product', 'href="/contractor-database"']) {
      expect(page).not.toContain(dead);
    }
  });

  it('/activate tiles open the tools that exist (never the retired /market-assassin sales page)', () => {
    const route = code('app/api/activate/route.ts');
    expect(route).not.toMatch(/url: '\/market-assassin'/);
    expect(route).not.toMatch(/url: '\/recompete'/);
    expect(route).toContain("url: '/federal-market-assassin'");
  });

  it('the MI Pro welcome email hands a verified buyer to /app (no Map default, no /app link in email)', () => {
    // Emails may not link /app (legacy-destination-guard.ts, #1362), so the CTA stays on
    // /market-intelligence — whose verify step now lands a verified buyer on /app, not /briefings.
    const src = code('lib/send-email.ts');
    const fn = src.slice(src.indexOf('export async function sendMarketIntelligenceWelcomeEmail'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toContain('opportunity-map');
    expect(body).not.toContain('mindyDashboardUrlFor');
    expect(body).toContain('https://getmindy.ai/market-intelligence');
    const mi = code('app/market-intelligence/page.tsx');
    expect(mi).toContain("window.location.href = '/app';");
    expect(mi).toContain("window.location.href = '/app?panel=settings';");
  });

  it('no email links the retired /market-assassin sales page', () => {
    for (const rel of ['lib/send-email.ts', 'app/api/stripe-webhook/route.ts']) {
      expect(code(rel)).not.toMatch(/getmindy\.ai\/market-assassin[?'"`]/);
    }
  });
});
