import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <header className="py-6 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-center">
          <div className="text-center">
            <span className="text-3xl font-bold text-blue-400">GovCon</span>
            <span className="text-3xl font-bold text-amber-400">Giants</span>
            <p className="text-slate-400 text-sm mt-1">Federal Contracting Tools</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-12 px-6">
        <div className="max-w-5xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Federal Contracting Tools
            </h1>
            <p className="text-xl text-slate-300 max-w-2xl mx-auto">
              Powerful tools to help you find, analyze, and win government contracts
            </p>
          </div>

          {/* 3 App Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Opportunity Scout */}
            <Link
              href="/opportunity-scout"
              className="group bg-slate-800 border-2 border-slate-700 rounded-2xl p-8 transition-all hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-500/20 hover:-translate-y-2"
            >
              <div className="text-6xl mb-6 text-center">🔍</div>
              <h2 className="text-2xl font-bold text-white mb-3 text-center group-hover:text-blue-400 transition-colors">
                Opportunity Scout
              </h2>
              <p className="text-slate-400 text-center mb-6">
                Find agencies awarding contracts to businesses like yours. Search by NAICS, location, and set-aside type.
              </p>
              <div className="flex justify-center">
                <span className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm group-hover:bg-blue-500 transition-colors">
                  Free Tool →
                </span>
              </div>
            </Link>

            {/* Federal Market Assassin */}
            <Link
              href="/federal-market-assassin"
              className="group bg-slate-800 border-2 border-slate-700 rounded-2xl p-8 transition-all hover:border-red-500 hover:shadow-2xl hover:shadow-red-500/20 hover:-translate-y-2"
            >
              <div className="text-6xl mb-6 text-center">🎯</div>
              <h2 className="text-2xl font-bold text-white mb-3 text-center group-hover:text-red-400 transition-colors">
                Federal Market Assassin
              </h2>
              <p className="text-slate-400 text-center mb-6">
                Generate 8 comprehensive strategic reports from 5 inputs. Market analytics, buyers, subcontracting & more.
              </p>
              <div className="flex justify-center">
                <span className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold text-sm group-hover:bg-red-500 transition-colors">
                  Premium Tool →
                </span>
              </div>
            </Link>

            {/* Federal Contractor Database */}
            <Link
              href="/contractor-database"
              className="group bg-slate-800 border-2 border-slate-700 rounded-2xl p-8 transition-all hover:border-emerald-500 hover:shadow-2xl hover:shadow-emerald-500/20 hover:-translate-y-2"
            >
              <div className="text-6xl mb-6 text-center">🗄️</div>
              <h2 className="text-2xl font-bold text-white mb-3 text-center group-hover:text-emerald-400 transition-colors">
                Contractor Database
              </h2>
              <p className="text-slate-400 text-center mb-6">
                Search 50,000+ federal contractors. Find teaming partners, competitors, and subcontracting opportunities.
              </p>
              <div className="flex justify-center">
                <span className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold text-sm group-hover:bg-emerald-500 transition-colors">
                  Premium Database →
                </span>
              </div>
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 px-6 mt-12">
        <div className="max-w-5xl mx-auto text-center">
          <div className="mb-4">
            <span className="text-lg font-bold text-blue-400">GovCon</span>
            <span className="text-lg font-bold text-amber-400">Giants</span>
          </div>
          <p className="text-slate-500 text-sm">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
          <p className="text-slate-600 text-xs mt-2">
            Questions? Contact us at hello@govconedu.com
          </p>
        </div>
      </footer>
    </div>
  );
}
