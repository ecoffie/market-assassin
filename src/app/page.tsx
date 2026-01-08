import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <header className="py-8 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-5xl font-bold mb-2">
            <span className="text-blue-400 italic">GovCon</span>
            <span className="text-amber-400 italic">Giants</span>
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Government Contracting Intelligence Tools
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Powerful tools to help you find, analyze, and win federal contracts
            </p>
          </div>

          {/* 3 App Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Federal Market Assassin */}
            <Link
              href="/federal-market-assassin"
              className="group bg-slate-800 border border-slate-700 rounded-xl p-6 transition-all hover:border-red-500 hover:shadow-xl"
            >
              <div className="text-4xl mb-4">🎯</div>
              <h3 className="text-xl font-bold text-white mb-3">
                Federal Market Assassin
              </h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                The Ultimate Government Contracting Intelligence System. Generate comprehensive market reports from 5 core inputs, select target agencies, and get all 8 strategic reports instantly.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Agency spending analysis
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Prime contractor intelligence
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Pain point identification
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Strategic positioning reports
                </li>
              </ul>
              <span className="text-red-400 font-semibold text-sm group-hover:text-red-300 transition-colors">
                Launch Tool →
              </span>
            </Link>

            {/* Opportunity Scout */}
            <Link
              href="/opportunity-scout"
              className="group bg-slate-800 border border-slate-700 rounded-xl p-6 transition-all hover:border-blue-500 hover:shadow-xl"
            >
              <div className="text-4xl mb-4">🔍</div>
              <h3 className="text-xl font-bold text-white mb-3">
                Opportunity Scout
              </h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Search and discover active federal contracting opportunities from SAM.gov. Filter by NAICS, agency, set-aside type, and more to find contracts that match your capabilities.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Real-time SAM.gov data
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Advanced filtering options
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Set-aside type matching
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Direct links to opportunities
                </li>
              </ul>
              <span className="text-blue-400 font-semibold text-sm group-hover:text-blue-300 transition-colors">
                Launch Tool →
              </span>
            </Link>

            {/* Federal Contractor Database */}
            <Link
              href="/contractor-database"
              className="group bg-slate-800 border border-slate-700 rounded-xl p-6 transition-all hover:border-emerald-500 hover:shadow-xl"
            >
              <div className="text-4xl mb-4">📊</div>
              <h3 className="text-xl font-bold text-white mb-3">
                Federal Contractor Database
              </h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Comprehensive database of federal contractors. Research competitors, find teaming partners, and identify subcontracting opportunities in your market.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Contractor profiles
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Contract history
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Teaming partner search
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span> Competitive analysis
                </li>
              </ul>
              <span className="text-emerald-400 font-semibold text-sm group-hover:text-emerald-300 transition-colors">
                Launch Tool →
              </span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
