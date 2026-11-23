'use client';

/**
 * "Get more credits every month" in Settings → Billing & credits (owner, 2026-11-23: Pro members
 * must be able to add the Pro credit add-ons from inside the app; the account menu's credits row
 * and the Upgrade/Add credits button already land on this screen).
 *
 * Each add-on is its own existing credit subscription (src/lib/billing/pro-credit-addons.ts); its
 * credits land in the same balance as Pro's. An add-on picked on /pricing before signup is
 * highlighted here (localStorage, this browser only).
 */
import { useState } from 'react';
import NoRefundNote from '@/components/NoRefundNote';
import { PRO_CREDIT_ADDONS, PENDING_ADDON_KEY, addonById, addonCheckoutHref, addonPrice } from '@/lib/billing/pro-credit-addons';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function ProCreditAddons({ email }: { email: string | null }) {
  const [annual, setAnnual] = useState(false);
  // Read once on mount. This renders only after the console's client-side sign-in check, never
  // on the server, so there is no hydration mismatch.
  const [pending] = useState<string | null>(() => {
    try { return addonById(localStorage.getItem(PENDING_ADDON_KEY))?.id ?? null; } catch { return null; }
  });
  const pendingAddon = addonById(pending);

  return (
    <section className="rounded-xl border border-white/[0.07] bg-surface p-4" data-testid="pro-credit-addons" aria-labelledby="pro-addons-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p id="pro-addons-h" className="text-[13px] font-semibold text-slate-100">Get more credits every month</p>
          <p className="mt-0.5 text-[12px] text-slate-500">Adds to your plan&apos;s monthly credits. Cancel an add-on anytime from Billing.</p>
        </div>
        <div className="flex rounded-lg border border-white/10 p-0.5 text-[12px]" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)} className={`min-h-[36px] rounded-md px-3 ${!annual ? 'bg-white/10 text-white' : 'text-slate-400'}`}>Monthly</button>
          <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)} className={`min-h-[36px] rounded-md px-3 ${annual ? 'bg-white/10 text-white' : 'text-slate-400'}`}>Annual</button>
        </div>
      </div>
      {pendingAddon && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-300" role="status">
          You picked +{fmt(pendingAddon.credits)} credits on the pricing page. Add it below to finish.
        </p>
      )}
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {PRO_CREDIT_ADDONS.map((a) => (
          <div key={a.id} className={`rounded-lg border p-3 ${pending === a.id ? 'border-emerald-400/60' : 'border-white/[0.08]'}`}>
            <p className="text-[14px] font-semibold text-slate-100">+{fmt(a.credits)} credits</p>
            <p className="mt-0.5 text-[12px] text-slate-400">${fmt(addonPrice(a, annual))}/mo{annual ? ', billed annually' : ''}</p>
            <a
              href={addonCheckoutHref(a, annual, email)}
              className="mt-2.5 inline-flex min-h-[36px] w-full items-center justify-center rounded-lg bg-emerald-500 px-3 text-[12px] font-semibold text-white hover:bg-emerald-400"
            >
              Add +{fmt(a.credits)}
            </a>
          </div>
        ))}
      </div>
      <NoRefundNote style={{ margin: '10px 0 0', fontSize: 11 }} />
    </section>
  );
}
