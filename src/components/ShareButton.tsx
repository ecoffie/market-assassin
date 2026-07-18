'use client';

/**
 * ShareButton — share a Discover leaderboard / data page.
 *
 * Additive, presentation-only. Used on the /top/* leaderboards (the GSC-proven
 * "Top [category] contractors" format) to turn a ranked page into something
 * people actually send each other. No SEO surface touched — this renders below
 * the metadata/JSON-LD the page already emits.
 */
import { useState } from 'react';

interface ShareButtonProps {
  /** Absolute URL of the page being shared. */
  url: string;
  /** Human title used in the tweet / share text. */
  title: string;
}

export default function ShareButton({ url, title }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const text = `${title} — on Mindy`;
  const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const li = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  const copy = async () => {
    interface Nav {
      share?: (d: ShareData) => Promise<void>;
      clipboard?: { writeText: (t: string) => Promise<void> };
    }
    const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as unknown as Nav | undefined;
    try {
      // navigator.share on mobile is the nicest path when available.
      if (nav?.share) {
        await nav.share({ title, text, url });
        return;
      }
      if (nav?.clipboard) {
        await nav.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
        return;
      }
      setOpen((o) => !o);
    } catch {
      // Clipboard blocked / share dismissed — fall back to the menu links.
      setOpen((o) => !o);
    }
  };

  return (
    <div className="relative inline-flex">
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-full border border-purple-500/40 bg-purple-500/10 px-4 py-2 text-sm font-semibold text-purple-200 hover:bg-purple-500/20 transition-colors"
          aria-label="Share this ranking"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
          </svg>
          {copied ? 'Link copied!' : 'Share this ranking'}
        </button>
        <a
          href={x}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 hover:border-purple-500/50 hover:text-white transition-colors"
          aria-label="Share on X"
        >𝕏</a>
        <a
          href={li}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-300 hover:border-purple-500/50 hover:text-white transition-colors"
          aria-label="Share on LinkedIn"
        >in</a>
      </div>

      {open && (
        <div className="absolute left-0 top-11 z-10 w-56 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl">
          <a href={x} target="_blank" rel="noopener noreferrer" className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Share on X</a>
          <a href={li} target="_blank" rel="noopener noreferrer" className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Share on LinkedIn</a>
          <a href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`} className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">Share by email</a>
        </div>
      )}
    </div>
  );
}
