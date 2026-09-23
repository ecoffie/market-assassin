/**
 * RENDERED paid-email destinations — the artifact handed to the provider, not the template.
 *
 * Each paid welcome/access email is sent through the REAL sendEmail() with the REAL
 * send-time guard active (it throws outside production), and every destination is read back
 * from the captured HTML and plain-text parts. Then every link is re-wrapped in /api/track
 * (and double-wrapped) and re-checked, because a tracking redirect hides the real landing in
 * a query parameter. Decision on PR #1671: paid CTAs reach the current /app sign-in/workspace,
 * never a pricing-page detour and never a retired surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  return { sent: [] as Array<{ html?: string; text?: string; subject?: string }> };
});

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: vi.fn(async (p: { html?: string; text?: string; subject?: string }) => {
        h.sent.push(p);
        return { data: { id: 'msg_1' }, error: null };
      }),
    };
  },
}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: vi.fn(async () => ({})) }) } }));
// The preferences link is a signed one-time URL in production; its shape is all that matters.
vi.mock('@/lib/access-links', () => ({
  createSecureAccessUrl: (_e: string, kind: string) => `https://getmindy.ai/access?token=T&kind=${kind}`,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, gte: () => b, eq: () => b,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async () => ({ error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      });
      return b;
    },
  }),
}));

import {
  sendMarketIntelligenceWelcomeEmail, sendFHCWelcomeEmail, sendBundleEmail,
  sendAccessCodeEmail, sendAlertProWelcomeEmail, sendEmail,
} from '@/lib/send-email';
import { findLegacyDestinations } from '@/lib/email/legacy-destination-guard';
import { workspaceUrl } from '@/lib/mindy/legacy-routes';

const TO = 'fixture.buyer@example.com';
const ENC = encodeURIComponent(TO);

function unwrap(raw: string): string {
  const u = new URL(raw, 'https://getmindy.ai');
  if (u.pathname === '/api/track' && u.searchParams.get('url')) return unwrap(u.searchParams.get('url')!);
  return u.toString();
}
/** Every navigation target in both parts, tracking unwrapped. */
function destinations(p: { html?: string; text?: string }): string[] {
  const raw = [
    ...[...(p.html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    ...[...(p.text || '').matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((m) => m[0]),
  ].filter((u) => !u.startsWith('mailto:'));
  return raw.map(unwrap);
}
const track = (u: string) => `https://getmindy.ai/api/track?t=T&a=click&url=${encodeURIComponent(u)}`;
function wrapAll(p: { html?: string; text?: string }, depth = 1) {
  const w = (u: string) => { let x = u; for (let i = 0; i < depth; i++) x = track(x); return x; };
  return {
    html: (p.html || '').replace(/href\s*=\s*"([^"]+)"/gi, (_m, u) => (u.startsWith('mailto:') ? `href="${u}"` : `href="${w(u)}"`)),
    text: (p.text || '').replace(/https?:\/\/[^\s<>"')]+/gi, (u) => w(u)),
  };
}
const last = () => h.sent[h.sent.length - 1];
const RETIRED = /\/(briefings|bd-assist|market-assassin|market-assassin-locked|federal-market-assassin)(\b|\/|\?|$)|\/app\/onboarding/;

beforeEach(() => { h.sent.length = 0; });

describe('paid welcome/access CTAs land on the current /app sign-in/workspace', () => {
  it('MI Pro welcome ($149) → /app with sign-in prefill, no pricing-page detour', async () => {
    expect(await sendMarketIntelligenceWelcomeEmail({ to: TO, customerName: 'Fixture' })).toBe(true);
    const d = destinations(last());
    expect(d).toContain(`https://getmindy.ai/app?email=${ENC}`);
    expect(d.filter((u) => u.includes('/market-intelligence'))).toEqual([]);
    expect(d.filter((u) => RETIRED.test(new URL(u).pathname))).toEqual([]);
  });

  it('FHC welcome (includes MA Standard) → /app Market Research', async () => {
    await sendFHCWelcomeEmail({ to: TO, customerName: 'Fixture' });
    const d = destinations(last());
    expect(d).toContain(`https://getmindy.ai/app?panel=research&email=${ENC}`);
    expect(d.filter((u) => RETIRED.test(new URL(u).pathname))).toEqual([]);
  });

  it.each(['pro', 'pro-giant-bundle', 'ultimate', 'ultimate-govcon-bundle'])(
    'bundle %s → MA and Mindy entries open /app; no retired surface',
    async (bundle) => {
      await sendBundleEmail({ to: TO, customerName: 'Fixture', bundle });
      const d = destinations(last());
      expect(d).toContain('https://getmindy.ai/app?panel=research');
      expect(d).toContain(`https://getmindy.ai/app?email=${ENC}`);
      expect(d).toContain('https://getmindy.ai/app?panel=recompetes');
      expect(d.filter((u) => u.includes('/market-intelligence'))).toEqual([]);
      expect(d.filter((u) => RETIRED.test(new URL(u).pathname))).toEqual([]);
    },
  );

  it('Market Assassin access email (webhook link shape) → /app Market Research', async () => {
    await sendAccessCodeEmail({
      to: TO, companyName: 'Fixture', accessCode: 'X',
      accessLink: workspaceUrl({ panel: 'research', email: TO, absolute: true }),
    });
    const d = destinations(last());
    expect(d).toContain(`https://getmindy.ai/app?panel=research&email=${ENC}`);
    expect(d.filter((u) => RETIRED.test(new URL(u).pathname))).toEqual([]);
  });

  it('Alert Pro welcome: its MA upsell points at the Mindy sales page, never the retired tool', async () => {
    await sendAlertProWelcomeEmail({ to: TO, customerName: 'Fixture' });
    const d = destinations(last());
    expect(d).toContain('https://getmindy.ai/market-intelligence');
    expect(d.filter((u) => RETIRED.test(new URL(u).pathname))).toEqual([]);
  });
});

describe('tracking wrappers — the guard sees through them on the rendered payload', () => {
  const senders: Array<[string, () => Promise<unknown>]> = [
    ['mi-welcome', () => sendMarketIntelligenceWelcomeEmail({ to: TO })],
    ['fhc', () => sendFHCWelcomeEmail({ to: TO })],
    ['bundle-ultimate', () => sendBundleEmail({ to: TO, bundle: 'ultimate' })],
    ['alert-pro', () => sendAlertProWelcomeEmail({ to: TO })],
  ];

  it.each(senders)('%s: single- and double-tracked, still zero retired destinations', async (_n, send) => {
    await send();
    const plain = last();
    for (const depth of [1, 2]) {
      const wrapped = wrapAll(plain, depth);
      expect(findLegacyDestinations(wrapped.html, wrapped.text)).toEqual([]);
      // Unwrapping the tracked payload yields exactly the plain destinations.
      expect(destinations(wrapped).sort()).toEqual(destinations(plain).sort());
      // And the real sendEmail accepts it (the guard throws outside production).
      await expect(sendEmail({ to: TO, subject: 's', ...wrapped })).resolves.toBe(true);
    }
  });

  it('⚠️ a retired link hidden in a tracked paid CTA is REFUSED at send time', async () => {
    const html = `<a href="${track(`https://getmindy.ai/federal-market-assassin?email=${ENC}`)}">Access</a>`;
    await expect(sendEmail({ to: TO, subject: 's', html, emailType: 'fixture' })).rejects.toThrow(/federal-market-assassin/);
  });
});
