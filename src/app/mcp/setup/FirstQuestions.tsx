'use client';

/**
 * THE FIRST 60 SECONDS.
 *
 * Measured 2026-08-23, the day after the launch event: 109 people connected Mindy to their
 * assistant and 74 of them NEVER ASKED IT ANYTHING. Nothing failed for that group — zero
 * errors, zero credit rejections. They installed it, watched it work, and closed the laptop.
 *
 * The setup guide ended at "you're connected", which is a dead end. Worse, it is inconsistent
 * with the rest of the product: Mindy's whole premise is that DISCOVERY BEATS SEARCH, and then
 * the MCP asked the user to invent a question from nothing.
 *
 * So: three JOBS, not 54 tools. A contractor should never need to know a tool exists. They
 * should know Mindy answers "what's worth pursuing", "who buys what I sell", and "what should
 * I be watching".
 *
 * Personalised when we know the user's market, honest when we don't — a generic question that
 * works beats a personalised one that quietly guesses at their industry.
 */
import { useEffect, useState } from 'react';

type Job = { label: string; sub: string; q: (naics: string | null, title: string | null) => string };

const JOBS: Job[] = [
  {
    label: 'Find opportunities',
    sub: "What's worth pursuing right now",
    q: (n, t) =>
      n
        ? `What federal opportunities are worth pursuing right now in NAICS ${n}${t ? ` (${t})` : ''}? Show me the ones where a small business has a realistic chance.`
        : 'What federal opportunities are worth pursuing right now for my business? Ask me what I do first.',
  },
  {
    label: 'Understand my market',
    sub: 'Who buys what you sell, and who wins',
    q: (n, t) =>
      n
        ? `Which federal agencies buy NAICS ${n}${t ? ` (${t})` : ''}, which contractors are winning that work, and where does competition look weakest?`
        : 'Which federal agencies buy what I sell, which contractors are winning that work, and where is competition weakest?',
  },
  {
    label: 'Get ahead',
    sub: 'Recompetes and early signals',
    q: (n, t) =>
      n
        ? `What contracts in NAICS ${n}${t ? ` (${t})` : ''} are coming up for recompete, and what early signals should I be watching before the RFP drops?`
        : 'What contracts in my market are coming up for recompete, and what early signals should I watch before the RFP drops?',
  },
];

export default function FirstQuestions() {
  const [naics, setNaics] = useState<string | null>(null);
  // The profile endpoint returns codes, not titles. Rather than fetch a second time or
  // guess a label, the questions carry the bare code — which is what a contractor recognises.
  const title: string | null = null;
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    // Best-effort personalisation. A failure here must leave the generic questions in place —
    // they work on their own, and a half-personalised question ("NAICS undefined") is worse
    // than a general one.
    // The email key varies by how the user signed in — check every one this app writes.
    let email = '', token = '';
    try {
      email = localStorage.getItem('mi_beta_email')
        || localStorage.getItem('user_email')
        || localStorage.getItem('mi_user_email')
        || '';
      token = localStorage.getItem('mi_beta_auth_token') || '';
    } catch { /* private mode — generic questions stand */ }
    if (!email || !token) return;   // GET /api/app/profile requires a verified session

    fetch(`/api/app/profile?email=${encodeURIComponent(email)}`, {
      headers: { 'x-mi-auth-token': token, 'x-user-email': email },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // `naicsCodes`, camelCase — the route maps it from naics_codes on the way out.
        const codes: unknown = d?.profile?.naicsCodes;
        const first = Array.isArray(codes)
          ? codes.map(String).find((c) => /^\d{6}$/.test(c))
          : undefined;
        if (first) setNaics(first);
      })
      .catch(() => { /* generic questions stand */ });
  }, []);

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard blocked — the text is on screen and selectable */ }
  }

  return (
    <div className="mt-6 grid gap-3">
      {JOBS.map((job, i) => {
        const q = job.q(naics, title);
        return (
          <div key={job.label} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-slate-100">{job.label}</div>
                <div className="text-[13px] text-slate-500">{job.sub}</div>
              </div>
              <button
                onClick={() => copy(q, i)}
                className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                {copied === i ? 'Copied' : 'Copy question'}
              </button>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-slate-300">&ldquo;{q}&rdquo;</p>
          </div>
        );
      })}
      <p className="text-[13px] text-slate-500">
        Paste any of these into Claude or ChatGPT. {naics
          ? 'These use your saved market.'
          : 'Add your NAICS codes in Mindy and these get specific to your market.'}
      </p>
    </div>
  );
}
