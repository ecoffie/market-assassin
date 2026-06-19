/**
 * /compare — hub for all "<competitor> alternative" pages (Phase 3 SEO).
 * Links the data-driven comparisons + the bespoke GovWin / SAM.gov pages.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPETITORS } from '@/data/competitors';

export const metadata: Metadata = {
  title: 'Compare Mindy to GovWin, HigherGov, GovTribe & more — Federal Market Intelligence',
  description:
    'How Mindy stacks up against GovWin, HigherGov, GovTribe, Bloomberg Government, and SAM.gov for federal market intelligence. Free tier, $149/mo Pro, no sales call.',
  alternates: { canonical: 'https://getmindy.ai/compare' },
  keywords: ['federal market intelligence comparison', 'govcon software comparison', 'mindy vs', 'best federal contracting software', 'govwin alternative', 'highergov alternative'],
};

const BESPOKE = [
  { slug: 'govwin', name: 'GovWin (Deltek)' },
  { slug: 'sam-gov', name: 'SAM.gov' },
];

export default function CompareHub() {
  const all = [
    ...BESPOKE,
    ...COMPETITORS.map((c) => ({ slug: c.slug, name: c.name })),
  ];
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl md:text-4xl font-extrabold">How Mindy compares</h1>
        <p className="text-slate-300 mt-4 text-lg">
          Honest comparisons of Mindy vs. the other federal market-intelligence tools — including the
          tradeoffs. Free daily alerts, $149/mo Pro, no enterprise sales call.
        </p>
        <div className="mt-8 grid sm:grid-cols-2 gap-3">
          {all.map((x) => (
            <Link
              key={x.slug}
              href={`/compare/${x.slug}`}
              className="block border border-slate-800 rounded-xl p-5 hover:border-purple-500 hover:bg-slate-900 transition-colors"
            >
              <div className="font-semibold text-white">Mindy vs {x.name}</div>
              <div className="text-sm text-purple-400 mt-1">See the comparison →</div>
            </Link>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href="/app" className="inline-block bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg px-7 py-3">Start free →</Link>
        </div>
      </div>
    </main>
  );
}
