import Link from 'next/link';
import { redirect } from 'next/navigation';
import { validateAccessCode } from '@/lib/access-codes';

/**
 * SINGLE-USE REPORT CODE → a report credit in Mindy (retired standalone UI, 2026-09-23).
 *
 * An admin-issued `/access/<CODE>` link used to open a copy of the old Market Assassin tool.
 * It was also broken on main: that page called /api/reports/generate-all WITHOUT an email, and
 * the route answers 403 "Email required" to anyone without the legacy cookie — so a code holder
 * could not get the report they were sold.
 *
 * Now the code is redeemed INSIDE Mindy. What was purchased is preserved exactly: one full
 * report run, bound to the email the code was issued to, consumed once. The holder signs in to
 * Mindy as that email, Market Research opens with the credit attached, and generate-all honours
 * it for that verified email and marks it used after the report is built. See
 * src/app/api/reports/generate-all/route.ts ("SINGLE-USE REPORT CREDIT").
 */
export const dynamic = 'force-dynamic';

export default async function AccessCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = String(raw || '').trim().toUpperCase();
  const result = await validateAccessCode(code);

  if (result.valid && result.accessCode?.email) {
    const q = new URLSearchParams({
      panel: 'research',
      email: result.accessCode.email.toLowerCase(),
      redeem: code,
    });
    redirect(`/app?${q.toString()}`);
  }

  const used = !!result.accessCode?.used;
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full text-center">
        <p className="text-2xl font-bold text-slate-900 mb-4">Mindy</p>
        <h1 className="text-xl font-bold text-slate-900 mb-2">
          {used ? 'This report link has already been used' : 'This report link is not valid'}
        </h1>
        <p className="text-slate-600 mb-6">
          {used
            ? 'Its report was generated. Your Mindy account keeps working — sign in to run Market Research.'
            : 'Please check the link in your email.'}
        </p>
        <Link href="/app?panel=research" className="inline-block px-5 py-3 rounded-lg bg-emerald-600 text-white font-semibold">
          Open Mindy
        </Link>
        <p className="text-sm text-slate-600 mt-6">
          Need help? <a href="mailto:support@getmindy.ai" className="text-blue-600 hover:underline">support@getmindy.ai</a>
        </p>
      </div>
    </div>
  );
}
