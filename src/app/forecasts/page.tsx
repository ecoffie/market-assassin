'use client';

import Link from 'next/link';

export default function ForecastsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
      <div className="text-center px-4 max-w-2xl">
        <div className="mb-8">
          <span className="text-4xl font-bold text-blue-400">GovCon</span>
          <span className="text-4xl font-bold text-amber-400">Giants</span>
        </div>

        <div className="inline-block bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2 rounded-full text-sm font-bold mb-6">
          Coming Soon
        </div>

        <h1 className="text-4xl md:text-5xl font-bold text-white mb-6">
          Federal Procurement Forecasts
        </h1>

        <p className="text-xl text-slate-300 mb-8">
          Early-warning intel on upcoming opportunities 6-18 months before solicitation.
          Get ahead of the competition with procurement forecasts from 11 federal agencies
          covering $94.5B in federal spend.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="text-3xl mb-2">🏛️</div>
            <div className="text-white font-semibold">11 Agencies</div>
            <div className="text-slate-400 text-sm">DOD, NASA, VA, GSA & more</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="text-3xl mb-2">💰</div>
            <div className="text-white font-semibold">$94.5B Coverage</div>
            <div className="text-slate-400 text-sm">Federal spend tracked</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="text-3xl mb-2">⏰</div>
            <div className="text-white font-semibold">6-18 Months Early</div>
            <div className="text-slate-400 text-sm">Before solicitation</div>
          </div>
        </div>

        <div className="bg-slate-800/70 rounded-xl p-6 mb-8">
          <p className="text-white font-semibold mb-2">Get notified when we launch</p>
          <p className="text-slate-400 text-sm mb-4">
            We&apos;re finalizing the data sources and will launch soon.
          </p>
          <a
            href="https://govcongiants.org/free-course"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold transition"
          >
            Join Free Course for Updates
          </a>
        </div>

        <Link href="/" className="text-slate-400 hover:text-white transition text-sm">
          ← Back to GovCon Giants Tools
        </Link>
      </div>
    </div>
  );
}
