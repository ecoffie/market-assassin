/**
 * EMAIL MIGRATION GUARD — no customer email links to /app or /briefings.
 *
 * Reported 2026-08-25 with screenshots: a daily briefing's footer sent users to
 * /briefings. The template source looked fine — the destination came from a SHARED
 * CONSTANT resolved at import time, three files away. So the guard checks the RENDERED
 * PAYLOAD, the artifact actually handed to the provider.
 */
import { describe, it, expect, vi } from 'vitest';
import { findLegacyDestinations, assertNoLegacyDestinations } from './legacy-destination-guard';

describe('catches legacy destinations in rendered HTML', () => {
  it('⚠️ THE REPORTED BUG: a /briefings footer link', () => {
    const f = findLegacyDestinations('<a href="https://getmindy.ai/briefings">Open Mindy Dashboard</a>');
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('/briefings');
  });

  it('catches /app', () => {
    expect(findLegacyDestinations('<a href="https://getmindy.ai/app">x</a>')[0].path).toBe('/app');
  });

  it('⚠️ catches a legacy path HIDDEN inside a tracking redirect', () => {
    // The visible href is /api/track — only the encoded `url` param reveals the landing.
    const html = '<a href="https://getmindy.ai/api/track?t=T&a=click&url=https%3A%2F%2Fgetmindy.ai%2Fbriefings&l=cta">x</a>';
    const f = findLegacyDestinations(html);
    expect(f).toHaveLength(1);
    expect(f[0].path).toBe('/briefings');
    expect(f[0].viaTracking).toBe(true);
  });

  it('checks the PLAIN-TEXT part too — a bare URL is still a live link', () => {
    expect(findLegacyDestinations(undefined, 'Manage: https://getmindy.ai/briefings')).toHaveLength(1);
  });

  it('catches relative paths', () => {
    expect(findLegacyDestinations('<a href="/briefings?email=x">x</a>')).toHaveLength(1);
  });
});

describe('does not over-fire', () => {
  it('a Map link passes', () => {
    expect(findLegacyDestinations('<a href="https://getmindy.ai/opportunity-map?naics=236220">x</a>')).toEqual([]);
  });

  it('a TRACKED Map link passes', () => {
    const html = '<a href="https://getmindy.ai/api/track?t=T&a=click&url=https%3A%2F%2Fgetmindy.ai%2Fopportunity-map%3Fnaics%3D236220">x</a>';
    expect(findLegacyDestinations(html)).toEqual([]);
  });

  it('a documented credential-flow exception passes', () => {
    expect(findLegacyDestinations('<a href="https://getmindy.ai/app/reset-password?t=1">Reset</a>')).toEqual([]);
  });

  it('a path merely CONTAINING the word passes', () => {
    // /alerts/preferences and /my-briefings-archive are not the legacy surfaces.
    expect(findLegacyDestinations('<a href="/alerts/preferences">x</a><a href="/my-briefings-archive">y</a>')).toEqual([]);
  });

  it('unparseable hrefs are ignored, not crashed on', () => {
    expect(() => findLegacyDestinations('<a href="mailto:x@y.com">m</a><a href="{{tag}}">t</a>')).not.toThrow();
  });
});

describe('assert behaviour', () => {
  it('throws outside production so a broken template fails loudly', () => {
    expect(() => assertNoLegacyDestinations({ html: '<a href="/briefings">x</a>', emailType: 'daily' }))
      .toThrow(/legacy destination/i);
  });

  it('names the email so the failure is actionable', () => {
    expect(() => assertNoLegacyDestinations({ html: '<a href="/app">x</a>', emailType: 'weekly_alert' }))
      .toThrow(/weekly_alert/);
  });

  it('a clean payload passes silently', () => {
    expect(assertNoLegacyDestinations({ html: '<a href="/opportunity-map">x</a>' })).toEqual([]);
  });
});

describe('the shared constants no longer resolve to a legacy surface', () => {
  it('MINDY_APP_URL is Map-native', async () => {
    const { MINDY_APP_URL, MINDY_PREFERENCES_URL } = await import('@/lib/mindy/email-branding');
    expect(MINDY_APP_URL).toContain('/opportunity-map');
    expect(MINDY_APP_URL).not.toContain('/briefings');
    expect(MINDY_PREFERENCES_URL).not.toMatch(/\/(app|briefings)\b/);
  });

  it('an env override at a legacy surface is REJECTED, not honoured', async () => {
    // The regression this guards: an override pointing at /app once stranded beta users.
    const prev = process.env.NEXT_PUBLIC_MINDY_APP_URL;
    process.env.NEXT_PUBLIC_MINDY_APP_URL = 'https://getmindy.ai/app';
    vi.resetModules();
    const { MINDY_APP_URL } = await import('@/lib/mindy/email-branding');
    expect(MINDY_APP_URL).not.toContain('/app');
    process.env.NEXT_PUBLIC_MINDY_APP_URL = prev;
  });
});
