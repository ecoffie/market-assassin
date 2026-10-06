/**
 * Email save CONFIRMATION page — the email link lands here and nothing is saved until the person
 * presses the button.
 *
 * ⚠️ READ-ONLY BY CONTRACT. Mail security scanners follow the email link and render this page, so
 * rendering must never write: buildEmailSaveConfirmation only verifies the link, reads "already
 * tracking", and mints the signed form token. The save is the form POST to
 * /api/actions/add-to-pipeline/confirm, which scanners do not submit.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { buildEmailSaveConfirmation } from '@/lib/pipeline/email-save';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Add to pipeline | Mindy',
  robots: { index: false, follow: false },
};

const STAGE_LABEL: Record<string, string> = { tracking: 'Tracking', pursuing: 'Pursuing', bidding: 'Bidding', submitted: 'Submitted' };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">{children}</div>
    </div>
  );
}

const safeDecode = (v: string | null) => {
  if (v == null) return null;
  try { return decodeURIComponent(v); } catch { return v; }
};

export default async function ConfirmPipelineSavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') params.set(k, v);

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let model;
  try {
    model = await buildEmailSaveConfirmation(sb, params);
  } catch (e) {
    console.error('[pipeline/confirm] could not build confirmation:', e instanceof Error ? e.message : e);
    model = { state: 'invalid', reason: 'link_invalid' } as const;
  }

  if (model.state === 'invalid') {
    const msg = model.reason === 'link_expired'
      ? 'This save link has expired.'
      : model.reason === 'missing_params' ? 'This link is missing the opportunity details.' : 'This save link is not valid.';
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-white mb-3">Can&apos;t save from this link</h1>
        <p className="text-slate-400 mb-8">{msg} You can add the opportunity from Mindy instead.</p>
        <Link href="/app?panel=pipeline" className="block w-full bg-violet-600 hover:bg-violet-700 text-white py-3 px-6 rounded-lg font-semibold transition">Open Mindy</Link>
      </Shell>
    );
  }

  const f = model.fields;
  const title = safeDecode(f.title);
  const agency = safeDecode(f.agency);

  if (model.state === 'already_tracking') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-white mb-3">Already in your pipeline</h1>
        <p className="text-white font-medium mb-2">{title}</p>
        <p className="text-slate-500 mb-8">Stage: <span className="text-violet-400 font-medium">{STAGE_LABEL[model.stage] || model.stage}</span></p>
        <Link href="/app?panel=pipeline" className="block w-full bg-violet-600 hover:bg-violet-700 text-white py-3 px-6 rounded-lg font-semibold transition">View pipeline</Link>
      </Shell>
    );
  }

  const a = model.action;
  const hidden: Record<string, string | null> = {
    email: f.email, title: f.title, notice_id: f.noticeId, stage: f.stage, agency: f.agency, value: f.value,
    deadline: f.deadline, naics: f.naics, setAside: f.setAside, source: f.source, url: f.externalUrl,
    idempotency_key: a.idempotencyKey, exp: String(a.exp), sig: a.sig, link_ts: String(model.linkIssuedAt),
  };

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-white mb-3">Add this opportunity to your pipeline?</h1>
      <p className="text-white font-medium mb-1">{title}</p>
      {agency && <p className="text-slate-400 mb-1">{agency}</p>}
      {f.deadline && <p className="text-slate-500 text-sm mb-1">Response due {f.deadline.slice(0, 10)}</p>}
      <p className="text-slate-500 text-sm mb-8">It will be added at the <span className="text-violet-400 font-medium">{STAGE_LABEL[f.stage]}</span> stage.</p>
      <form method="post" action="/api/actions/add-to-pipeline/confirm" className="space-y-3">
        {Object.entries(hidden).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
        <button type="submit" className="block w-full bg-violet-600 hover:bg-violet-700 text-white py-3 px-6 rounded-lg font-semibold transition">
          Add to my pipeline
        </button>
      </form>
      <p className="text-slate-500 text-sm mt-4">Nothing is saved until you press the button.</p>
    </Shell>
  );
}
