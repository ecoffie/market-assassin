'use client';

import Link from 'next/link';
import { mindySignInUrl } from '@/lib/mindy/universal-signin';

export default function McpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0a0f1e] px-6 text-slate-100 [color-scheme:dark]">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-lg font-bold text-[#0a0f1e]">
          M
        </div>
        <h1 className="text-lg font-semibold text-rose-300">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-400">
          {error?.message || 'This page failed to load. You can retry, sign in, or go back to Connect.'}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400"
          >
            Try again
          </button>
          <Link
            href="/mcp"
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/5"
          >
            Back to Connect
          </Link>
          <Link
            href={mindySignInUrl('/mcp')}
            className="text-[13px] text-slate-400 underline underline-offset-2 hover:text-slate-200"
          >
            Sign in to Mindy
          </Link>
        </div>
      </div>
    </main>
  );
}
