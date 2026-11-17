/**
 * /start-trial/welcome?session_id=cs_… — where Stripe returns the buyer after the trial checkout
 * (when the plan's payment link has no redirect of its own). Reads the session server-side only to
 * say whether the trial started; access is granted by the webhook, never by this page.
 */
import type { Metadata } from 'next';
import { getStripe } from '@/lib/stripe';
import { CUSTOM_CHECKOUT_API_VERSION } from '@/lib/billing/trial-checkout';

export const metadata: Metadata = { title: 'Your trial has started | Mindy', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;

async function sessionStatus(id: string): Promise<{ complete: boolean; email: string | null } | null> {
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(id, {}, { apiVersion: CUSTOM_CHECKOUT_API_VERSION });
    return { complete: s.status === 'complete', email: s.customer_details?.email || s.customer_email || null };
  } catch {
    return null;
  }
}

export default async function TrialWelcome({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const id = String(Array.isArray(sp.session_id) ? sp.session_id[0] : sp.session_id || '');
  const status = await sessionStatus(id);
  const ok = !!status?.complete;
  return (
    <div className="min-h-screen bg-[#f7f9fb] text-[#111c26] flex items-center justify-center px-4" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="w-full max-w-md bg-white border border-[#e6eaef] rounded-2xl p-8 text-center shadow-[0_8px_24px_rgba(17,28,38,.06)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mindy-logo-icon.svg" alt="" width={44} height={44} className="mx-auto" />
        <h1 className="mt-4 text-2xl font-bold" style={{ fontFamily: '"Space Grotesk", Inter, sans-serif' }}>
          {ok ? 'Your free trial has started' : 'We could not confirm your trial yet'}
        </h1>
        <p className="mt-2 text-[15px] text-[#3a4654]">
          {ok
            ? <>Sign in with <b>{status?.email || 'the email you used'}</b> to start using Mindy. Your welcome email is on its way.</>
            : 'If you just finished checkout, give it a minute and refresh. Nothing is charged today either way.'}
        </p>
        <a href="/app" className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#006aff] hover:bg-[#0057d1] text-white font-semibold">Open Mindy</a>
        {!ok && <a href="/pricing" className="mt-3 inline-block text-sm text-[#005ee0] underline">Back to pricing</a>}
      </div>
    </div>
  );
}
