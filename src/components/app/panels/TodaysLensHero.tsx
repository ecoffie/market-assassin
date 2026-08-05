'use client';

/**
 * Today's Lens hero — the top of Today's Intel (Eric 2026-08-04, "biggest UX insight all week").
 *
 * Today's Intel does NOT summarize the DB or show a "Best Fit" card. It answers ONE question — "why open
 * the map today?" — and ends in ONE CTA that CONFIGURES the map (not just links to it). Clicking
 * "Open Today's Map →" opens /opportunity-map?strategy=<the lens strands> so the map arrives already
 * filtered to exactly what the briefing highlighted. Briefing creates curiosity → map satisfies it.
 * (Zillow / Spotify Discover Weekly, not Indeed.)
 *
 * Grounded: every count is a real strand count over the user's profile-scoped OPEN corpus
 * (/api/app/todays-lens → opportunity_dna_keys). No LLM. grounded:false → an honest quiet day.
 */

import { useEffect, useState, useCallback } from 'react';
import { getMIApiHeaders } from '../authHeaders';

interface LensStrand { key: string; label: string; icon: string; count: number }
interface LensData {
  ok: boolean; grounded: boolean; usingFallback: boolean;
  totalOpen: number; strands: LensStrand[]; lensStrategy: string;
}

const nf = new Intl.NumberFormat('en-US');

export default function TodaysLensHero({ email }: { email: string }) {
  const [data, setData] = useState<LensData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true); setFailed(false);
    try {
      const res = await fetch(`/api/app/todays-lens?email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d as LensData);
    } catch { setFailed(true); setData(null); }
    finally { setLoading(false); }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  // Never let the hero break the page — on any failure, render nothing (the rest of Today's Intel stands).
  if (failed) return null;

  if (loading) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#1e3a8a] to-[#7c3aed] p-6 md:p-8 mb-6 animate-pulse">
        <div className="h-4 w-32 bg-white/20 rounded mb-3" />
        <div className="h-7 w-3/4 bg-white/25 rounded" />
      </div>
    );
  }

  if (!data) return null;

  const mapHref = data.lensStrategy
    ? `/opportunity-map?strategy=${encodeURIComponent(data.lensStrategy)}`
    : '/opportunity-map';

  // Quiet day (no open opps in the user's codes) — honest, not a fabricated pep talk. Still offer the map.
  if (!data.grounded || data.totalOpen === 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#1e3a8a] to-[#7c3aed] text-white p-6 md:p-8 mb-6">
        <div className="text-xs font-bold uppercase tracking-widest text-white/70 mb-1">Today&apos;s Intel</div>
        <h2 className="text-xl md:text-2xl font-extrabold leading-snug">
          {data.usingFallback
            ? 'Set your industry to see what today’s market holds.'
            : 'A quiet morning — nothing new in your codes right now.'}
        </h2>
        <p className="text-white/80 text-sm mt-1">The market moves daily. Explore the whole map, or widen your profile.</p>
        <a href={mapHref} className="inline-flex items-center gap-2 mt-4 bg-white text-[#1e3a8a] font-bold rounded-xl px-5 py-2.5 text-sm hover:bg-white/90 transition">
          Open the Map <span aria-hidden>&rarr;</span>
        </a>
      </div>
    );
  }

  const present = data.strands.filter((s) => s.count > 0);

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#1e3a8a] to-[#7c3aed] text-white p-6 md:p-8 mb-6 shadow-lg">
      <div className="text-xs font-bold uppercase tracking-widest text-white/70 mb-1">Today&apos;s Intel</div>
      {/* The hero line — one number, one reason to look */}
      <h2 className="text-2xl md:text-3xl font-extrabold leading-tight tabular-nums">
        {nf.format(data.totalOpen)} {data.totalOpen === 1 ? 'opportunity deserves' : 'opportunities deserve'} your attention.
      </h2>

      {/* Why today matters — the lens strands as real counts */}
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2.5">
        {present.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-[15px]">
            <span aria-hidden className="text-lg leading-none">{s.icon}</span>
            <span className="font-bold tabular-nums">{nf.format(s.count)}</span>
            <span className="text-white/85">{s.label}</span>
          </div>
        ))}
      </div>

      {/* The ONE CTA — it CONFIGURES the map (opens it with Today's Lens strands pre-applied) */}
      <a
        href={mapHref}
        className="inline-flex items-center gap-2 mt-6 bg-white text-[#1e3a8a] font-bold rounded-xl px-6 py-3 text-[15px] hover:bg-white/90 transition shadow"
      >
        Open Today&apos;s Map <span aria-hidden>&rarr;</span>
      </a>
      {data.lensStrategy && (
        <p className="text-white/60 text-xs mt-2">
          Opens the map already focused on {present.slice(0, 3).map((s) => s.label).join(' · ')}.
        </p>
      )}
    </div>
  );
}
