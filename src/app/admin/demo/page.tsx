/**
 * /admin/demo — the demo-day hub. One page to run the five-beat story live, in
 * order (Eric, Jun 26). Each card deep-links to a live screen. The framing thesis
 * sits up top so it anchors the whole run.
 */
import Link from 'next/link';

const SCREENS = [
  {
    n: 1,
    href: '/admin/data-inventory',
    title: 'The Data Core — what Mindy knows',
    desc: 'The moat, quantified. Live record counts across every dataset that powers Mindy.',
    stat: '~604,718 records · 13 datasets · 34 sources',
    line: 'Mindy arrives full — it already knows your market at login.',
  },
  {
    n: 2,
    href: '/admin/competitive-positioning',
    title: 'Why Mindy — the quadrant + GovDash',
    desc: 'All-in-one × Easy-to-use (the iPhone slide). Mindy alone, top-right. Then the GovDash deep-dive and the Brand·Attention·Distribution moat.',
    stat: 'Mindy vs GovDash · Govly/Hazel off-screen',
    line: 'In the AI era, software is replicable — the moat is brand.',
  },
  {
    n: 3,
    href: '/admin/set-aside-impact',
    title: 'The Mission — rebuild the industrial base',
    desc: 'The shrinking base, the "goal met ≠ set aside" gap per category (live), and the fractional-percent impact calculator.',
    stat: '0.5% of Full-and-Open ≈ $2.9B · Rule of Two',
    line: 'Free agentic tools → more qualified bidders → set-asides.',
  },
];

export default function DemoHubPage() {
  return (
    <div className="min-h-dvh bg-ground-deep px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <p className="text-xs uppercase tracking-wider text-faint">Mindy — demo run</p>
          <h1 className="mt-1 text-2xl font-black">In the AI era, anyone can replicate the software.</h1>
          <p className="mt-1 text-xl font-black text-emerald-300">The moat is Brand · Attention · Distribution.</p>
          <p className="mt-2 text-sm text-muted">…and that&rsquo;s exactly what GovCon Giants is. Click through the three screens in order. </p>
        </header>

        <div className="space-y-4">
          {SCREENS.map((s) => (
            <Link
              key={s.n}
              href={s.href}
              className="group flex items-start gap-4 rounded-2xl border border-surface bg-gradient-to-br from-slate-900 to-slate-950 p-5 transition-colors hover:border-emerald-500/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-black text-emerald-300">
                {s.n}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-white group-hover:text-emerald-200">{s.title}</h2>
                <p className="mt-1 text-sm text-muted">{s.desc}</p>
                <p className="mt-2 text-xs font-semibold text-emerald-300">{s.stat}</p>
                <p className="mt-0.5 text-[12px] italic text-faint">{s.line}</p>
              </div>
              <span className="self-center text-slate-600 transition-transform group-hover:translate-x-1 group-hover:text-emerald-300">→</span>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-center text-[11px] text-slate-600">
          Full slide-ready script: <span className="font-mono">docs/strategy/demo-deck.md</span>
        </p>
      </div>
    </div>
  );
}
