/**
 * Cron: trial onboarding emails for Mindy Pro / Team free trials.
 *   GET /api/cron/trial-onboarding   (auth: ?password=ADMIN_PASSWORD  OR  Bearer CRON_SECRET)
 *   ?dry=1  → list what would send, send nothing.
 *
 * Schedule = a cron_jobs row (migration 20261113_trial_onboarding_cron.sql), NOT vercel.json.
 *
 * Lists every TRIALING subscription on the Mindy app product, works out which step is due
 * (day 1 / 3 / 7, with a one-day catch-up), and sends it once (KV claim per sub + step).
 * Also sends the day-11 "what Mindy found" reminder as a fallback for Stripe's trial_will_end
 * webhook — the reminder's own KV claim means only one of the two ever sends.
 * Day 1 (book a call) is skipped until MINDY_SETUP_CALL_URL is set.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { reportCronOutcome } from '@/lib/cron-self-report';
import { MINDY_APP_PRODUCT, isMindyAppSubscription } from '@/lib/billing/app-subscription-end';
import {
  dueStep, firstNameOf, hasBookingUrl, readTrialFound, sendTrialStepEmail, trialContextFromSubscription,
} from '@/lib/billing/trial-onboarding-emails';
import { sendTrialReminderEmail } from '@/lib/billing/trial-reminder-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOB = 'trial-onboarding';
const DAY = 86_400_000;

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const isAuthorized =
    (!!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!isAuthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeKey || !sbUrl || !sbKey) {
    return NextResponse.json({ success: false, error: 'Stripe or Supabase not configured' }, { status: 500 });
  }
  const stripe = new Stripe(stripeKey);
  const supabase = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
  const now = Date.now();

  const results: Array<{ sub: string; email: string; step: string; result: string }> = [];
  const errors: string[] = [];
  let trialing = 0;

  try {
    for await (const sub of stripe.subscriptions.list({ status: 'trialing', limit: 100, expand: ['data.customer'] })) {
      if (!isMindyAppSubscription(sub) || !sub.trial_start || !sub.trial_end) continue;
      trialing++;
      const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer;
      const email = !customer || customer.deleted ? null : customer.email;
      if (!email) { errors.push(`${sub.id}: no email`); continue; }
      const ctx = trialContextFromSubscription(sub, email, firstNameOf(customer.deleted ? null : customer.name));
      if (!ctx) continue;

      const trialStart = new Date(sub.trial_start * 1000);
      const daysLeft = (sub.trial_end * 1000 - now) / DAY;

      // Day 11 fallback: 3 days (or fewer) before the charge, while still trialing.
      if (daysLeft <= 3 && daysLeft > 0) {
        try {
          if (dry) { results.push({ sub: sub.id, email, step: 'day11', result: 'dry' }); continue; }
          const found = await readTrialFound(supabase, email, trialStart);
          const r = await sendTrialReminderEmail(sub.id, { ...ctx, found });
          results.push({ sub: sub.id, email, step: 'day11', result: r });
        } catch (e) {
          errors.push(`${sub.id} day11: ${(e as Error).message}`);
        }
        continue;
      }

      const step = dueStep(trialStart, now);
      if (!step) continue;
      if (step === 'day1' && !hasBookingUrl()) {
        results.push({ sub: sub.id, email, step, result: 'skipped_no_booking_url' });
        continue;
      }
      if (dry) { results.push({ sub: sub.id, email, step, result: 'dry' }); continue; }
      try {
        const r = await sendTrialStepEmail(sub.id, step, ctx);
        results.push({ sub: sub.id, email, step, result: r });
      } catch (e) {
        errors.push(`${sub.id} ${step}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    const msg = `listing trials failed: ${(e as Error).message}`;
    await reportCronOutcome(JOB, 'error', msg).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  const sent = results.filter((r) => r.result === 'sent').length;
  const body = { success: errors.length === 0, product: MINDY_APP_PRODUCT, dry, trialing, sent, results, errors };
  if (errors.length) {
    await reportCronOutcome(JOB, sent > 0 ? 'partial' : 'error', errors.join('; ').slice(0, 500)).catch(() => {});
    return NextResponse.json(body, { status: sent > 0 ? 200 : 500 });
  }
  await reportCronOutcome(JOB, 'success').catch(() => {});
  return NextResponse.json(body);
}
