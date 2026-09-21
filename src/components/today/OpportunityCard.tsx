/**
 * OpportunityCard — the opportunity AS the visual object (Eric 2026-08-15).
 *
 * The brief, verbatim: *"I don't want to imitate Zillow's photography because opportunities don't
 * have a natural photographic equivalent. Instead, make the opportunity itself the visual object.
 * Lead every card with a large estimated value (or forecast range), followed by the buying agency,
 * title, urgency, and DNA chips. Treat those as the visual identity of the card. If a visual accent
 * is needed, use a small location badge or map pin—not a miniature map. Reserve map thumbnails for
 * places where geography itself is the point."*
 *
 * So the hierarchy is deliberate and top-down:
 *   1. VALUE      — the hero. Where Zillow puts the photo, we put the money.
 *   2. AGENCY     — who's buying.
 *   3. TITLE      — what it is.
 *   4. URGENCY    — when it closes (color escalates as the deadline nears).
 *   5. DNA CHIPS  — the identity strands, tone-colored.
 * A small pin badge is the only decoration. No mini-map: geography is not this card's point.
 *
 * GROUNDING: every figure is a stored, precomputed value read straight from the row —
 * `intel_value_range` (M-Estimate) and `opportunity_dna` (strands). Nothing is computed, inferred
 * or rounded into existence here, and the estimate renders its OWN provenance line ("274 comparable
 * 236220 · PSC Z1AZ contracts") so the number arrives with its receipt attached.
 */
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import type { FeaturedOpp } from '@/lib/today/intel';

/** $1.2M / $847K / $236,688 — compact enough to read as a headline at 2.5rem. */
function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

/** Urgency escalates by color — the same traffic-light logic the alert emails already use. */
function urgency(days: number | null): { label: string; cls: string } | null {
  if (days == null) return null;
  if (days <= 3) return { label: days === 0 ? 'Closes today' : `${days}d left`, cls: 'bg-red-50 text-red-700 ring-red-600/20' };
  if (days <= 14) return { label: `${days}d left`, cls: 'bg-amber-50 text-amber-800 ring-amber-600/20' };
  return { label: `${days}d left`, cls: 'bg-slate-50 text-slate-600 ring-slate-500/20' };
}

/** Strand tone → chip color. 'good' = a reason to bid, 'watch' = a caution. */
const TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  watch: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/15',
};

export default function OpportunityCard({ opp }: { opp: FeaturedOpp }) {
  const u = urgency(opp.daysLeft);
  return (
    <Link
      href={opp.href}
      className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-7 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg md:p-8"
    >
      {/* ── 1. THE VALUE. The visual object — where Zillow shows a house, we show the money. ── */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[2.75rem] font-bold leading-none tracking-tight text-slate-900 md:text-[3.25rem]">
          {money(opp.estMedian)}
        </span>
        {opp.estLow != null && opp.estHigh != null && (
          <span className="text-xs font-medium text-slate-400">
            {money(opp.estLow)}–{money(opp.estHigh)}
          </span>
        )}
      </div>
      {/* The estimate carries its own receipt rather than asking to be trusted.
          ⚠️ The stored `label` comes in TWO shapes — a noun phrase ("176 comparable 561492 · PSC
          R606 contracts") and a full sentence ("based on the prior contract"). A blind "Est. from "
          prefix produced the live nonsense "Est. from based on the prior contract", so prefix ONLY
          the noun-phrase shape and let a sentence stand on its own. */}
      {opp.estBasis && (
        <div className="mt-1.5 text-[11px] leading-snug text-slate-400">
          {/^(based|from|per|using)\b/i.test(opp.estBasis)
            ? `Est. ${opp.estBasis}`
            : `Est. from ${opp.estBasis}`}
        </div>
      )}

      {/* ── 2. AGENCY + 3. TITLE ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 text-[11px] font-bold uppercase tracking-wider text-sky-700">{opp.agency}</div>
      <div className="mt-1.5 flex-1 text-base font-semibold leading-snug text-slate-900">{opp.title}</div>

      {/* ── 4. URGENCY + the small location badge (a pin, never a mini-map) ───────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {u && (
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${u.cls}`}>
            {u.label}
          </span>
        )}
        {opp.place && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500"
            // Honest label: SAM omits place-of-performance on ~half of notices, so a fallback badge
            // is the BUYING OFFICE's state — never presented as where the work happens.
            title={opp.placeIsOffice ? `Bought by an office in ${opp.place}` : `Performed in ${opp.place}`}
          >
            <MapPin className="h-3 w-3" strokeWidth={2.5} />
            {opp.place}
          </span>
        )}
      </div>

      {/* ── 5. DNA CHIPS — the identity strands, tone-colored. ────────────────────────────── */}
      {opp.dna.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {opp.dna.map((s) => (
            <span
              key={s.key}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE[s.tone] || TONE.neutral}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
