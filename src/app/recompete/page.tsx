import Link from 'next/link';

/**
 * /recompete — the SEO landing (server-rendered in layout.tsx, 2026-09-21) stays; the legacy
 * Recompete Tracker interface under it is retired (2026-09-23, PR #1671).
 *
 * This page used to be an email/shared-password gate that then iframed `/recompete.html` — a URL
 * that already 308-redirects to /app?panel=recompetes, so a customer who got past the gate saw
 * the Mindy workspace squeezed into an iframe. The Recompetes panel IS the product now:
 * `recompete:` grants are Pro in /app (verifyMIAccess), and the table is the live 129K-row
 * per-contract data, not the June snapshot the tracker served.
 *
 * The shared-password route (/api/verify-recompete-password) is no longer reachable from any
 * page; its retirement is in the separate security proposal (review packet).
 */
export default function RecompeteEntry() {
  return (
    <section className="bg-slate-950 border-t border-slate-800">
      <div className="max-w-3xl mx-auto px-6 py-10 text-center">
        <h2 className="text-2xl font-bold text-white">Track expiring contracts in Mindy</h2>
        <p className="mt-3 text-slate-400">
          Customers of the Recompete Tracker: your access carries over. Sign in to Mindy with your
          purchase email to open Recompetes.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/app?panel=recompetes"
            className="inline-block px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            Open Recompetes in Mindy
          </Link>
          <Link
            href="/opportunity-map?mode=recompete"
            className="inline-block px-6 py-3 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-900"
          >
            Browse recompetes on the map
          </Link>
        </div>
      </div>
    </section>
  );
}
