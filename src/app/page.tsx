import Link from 'next/link';

export default function ToolsLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="mb-6">
            <span className="text-5xl font-bold text-blue-400">GovCon</span>
            <span className="text-5xl font-bold text-amber-400">Giants</span>
          </div>
          <h1 className="text-3xl font-semibold text-white mb-4">
            Government Contracting Intelligence Tools
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto">
            Powerful tools to help you find, analyze, and win federal contracts
          </p>
        </div>

        {/* Tools Grid */}
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Federal Market Assassin */}
          <Link
            href="/federal-market-assassin"
            className="group bg-slate-800 border border-slate-700 rounded-2xl p-8 hover:border-blue-500 hover:bg-slate-750 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10"
          >
            <div className="text-5xl mb-4">🎯</div>
            <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-blue-400 transition-colors">
              Federal Market Assassin
            </h2>
            <p className="text-slate-400 mb-4">
              The Ultimate Government Contracting Intelligence System. Generate comprehensive market reports from 5 core inputs, select target agencies, and get all 8 strategic reports instantly.
            </p>
            <ul className="text-sm text-slate-500 space-y-2">
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Agency spending analysis
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Prime contractor intelligence
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Pain point identification
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Strategic positioning reports
              </li>
            </ul>
            <div className="mt-6 text-blue-400 font-semibold group-hover:translate-x-2 transition-transform inline-flex items-center gap-2">
              Launch Tool <span>→</span>
            </div>
          </Link>

          {/* Opportunity Scout */}
          <Link
            href="/opportunity-scout.html"
            className="group bg-slate-800 border border-slate-700 rounded-2xl p-8 hover:border-amber-500 hover:bg-slate-750 transition-all duration-300 hover:shadow-xl hover:shadow-amber-500/10"
          >
            <div className="text-5xl mb-4">🔍</div>
            <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-amber-400 transition-colors">
              Opportunity Scout
            </h2>
            <p className="text-slate-400 mb-4">
              Search and discover active federal contracting opportunities from SAM.gov. Filter by NAICS, agency, set-aside type, and more to find contracts that match your capabilities.
            </p>
            <ul className="text-sm text-slate-500 space-y-2">
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Real-time SAM.gov data
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Advanced filtering options
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Set-aside type matching
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Direct links to opportunities
              </li>
            </ul>
            <div className="mt-6 text-amber-400 font-semibold group-hover:translate-x-2 transition-transform inline-flex items-center gap-2">
              Launch Tool <span>→</span>
            </div>
          </Link>

          {/* Federal Contractor Database */}
          <Link
            href="/database.html"
            className="group bg-slate-800 border border-slate-700 rounded-2xl p-8 hover:border-emerald-500 hover:bg-slate-750 transition-all duration-300 hover:shadow-xl hover:shadow-emerald-500/10"
          >
            <div className="text-5xl mb-4">📊</div>
            <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-emerald-400 transition-colors">
              Federal Contractor Database
            </h2>
            <p className="text-slate-400 mb-4">
              Comprehensive database of federal contractors. Research competitors, find teaming partners, and identify subcontracting opportunities in your market.
            </p>
            <ul className="text-sm text-slate-500 space-y-2">
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Contractor profiles
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Contract history
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Teaming partner search
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-400">✓</span> Competitive analysis
              </li>
            </ul>
            <div className="mt-6 text-emerald-400 font-semibold group-hover:translate-x-2 transition-transform inline-flex items-center gap-2">
              Launch Tool <span>→</span>
            </div>
          </Link>
        </div>

        {/* Footer */}
        <div className="text-center mt-16 text-slate-500">
          <div className="mb-2">
            <span className="text-lg font-bold text-blue-400">GovCon</span>
            <span className="text-lg font-bold text-amber-400">Giants</span>
          </div>
          <p className="text-sm">
            Empowering small businesses to win federal contracts
          </p>
          <p className="text-xs mt-2 text-slate-600">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
