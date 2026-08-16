/**
 * WhyTodayMatters — the editorial section (Eric 2026-08-15, "the biggest thing").
 *
 * *"Between the KPI row and Featured Opportunities I'd add **Why Today Matters**… One sentence
 * each. No AI opinions. Purely data-driven. This becomes your 'newspaper.'"*
 *
 * The KPI row says WHAT the numbers are. This says WHY they matter — the same figures rewritten
 * as sentences a contractor can act on. Critically, it is NOT a second query: every line is
 * composed from the intel the page already fetched, so it adds zero load time and cannot
 * disagree with the numbers above it.
 *
 * GROUNDING RULES (this section is the most tempting place on the page to fabricate):
 *   · Every sentence needs a real figure. No figure → the line is DROPPED, never softened into
 *     vague copy ("activity remains strong") that reads like insight but asserts nothing.
 *   · A mover is only called out when it clears the same +20% bar the headline uses — below that
 *     it's noise, and dressing noise as news is exactly what an "AI opinion" would do.
 *   · Verbs describe the measurement ("accelerated", "accounted for"), never a forecast
 *     ("is poised to"). We report what the data did, not what we think it will do.
 */
import Link from 'next/link';
import { TrendingUp, Shield, CalendarDays, RefreshCw } from 'lucide-react';
import type { TodayIntel } from '@/lib/today/intel';

type Line = { icon: typeof TrendingUp; text: string; href: string; key: string };

/** The +20% bar the headline already uses — keep them in lockstep so the page has ONE standard. */
const NOTABLE_MOVE_PCT = 20;

export function buildWhyLines(intel: TodayIntel): Line[] {
  const lines: Line[] = [];
  const stat = (k: string) => intel.stats.find((s) => s.key === k);

  // 1. A market that genuinely moved. Named in plain English (the mover list already drops
  //    unlabeled codes), and only when the swing clears the notable bar.
  const m = intel.movers.find((x) => x.pctChange >= NOTABLE_MOVE_PCT);
  if (m) {
    lines.push({
      key: 'mover',
      icon: TrendingUp,
      text: `${m.name} demand accelerated — ${m.lastWeek.toLocaleString()} postings last week to ${m.thisWeek.toLocaleString()} this week, up ${m.pctChange}%.`,
      href: m.href,
    });
  }

  // 2. Buyer concentration — who actually drove the week, as a share of the real total.
  const week = stat('new_week')?.value ?? 0;
  const top = intel.agencies[0];
  if (top && week > 0) {
    const share = Math.round((top.newThisWeek / week) * 100);
    lines.push({
      key: 'agency',
      icon: Shield,
      text: `${top.display} accounted for ${share}% of new opportunities — ${top.newThisWeek.toLocaleString()} of ${week.toLocaleString()} posted this week.`,
      href: top.href,
    });
  }

  // 3. Events — the highest-leverage hour a contractor can spend, and easy to miss.
  const ev = stat('events');
  if (ev && ev.value > 0) {
    lines.push({
      key: 'events',
      icon: CalendarDays,
      text: `${ev.value.toLocaleString()} industry events are on the calendar — where buyers meet contractors before the RFP exists.`,
      href: ev.href || '/opportunity-map',
    });
  }

  // 4. Recompetes — work that already has an incumbent and a known expiry.
  const rc = stat('recompetes');
  if (rc && rc.value > 0) {
    lines.push({
      key: 'recompete',
      icon: RefreshCw,
      text: `${rc.value.toLocaleString()} contracts are entering recompete within a year — each one already has an incumbent to displace.`,
      href: rc.href || '/opportunity-map',
    });
  }

  return lines;
}

export default function WhyTodayMatters({ intel }: { intel: TodayIntel }) {
  const lines = buildWhyLines(intel);
  if (lines.length === 0) return null;   // no real figures → no section, never filler

  return (
    <section className="border-b border-slate-200 py-8">
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Why today matters</h2>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
        {lines.map(({ icon: Icon, text, href, key }) => (
          <Link
            key={key}
            href={href}
            className="group flex items-start gap-3 rounded-lg py-2 transition hover:bg-slate-50"
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" strokeWidth={2.25} />
            <span className="text-[15px] leading-relaxed text-slate-700 group-hover:text-slate-900">{text}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
