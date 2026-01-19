import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-700">GovCon</span>
              <span className="text-xl font-bold text-amber-500">Giants</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-600 hover:text-gray-900">
                Tools
              </Link>
              <Link href="/free-resources" className="text-gray-600 hover:text-gray-900">
                Free Resources
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            About GovCon Giants
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Empowering small businesses to win federal contracts with data-driven intelligence tools.
          </p>
        </div>

        {/* Mission */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Mission</h2>
          <p className="text-gray-600 mb-4">
            GovCon Giants was built to level the playing field for small businesses pursuing federal contracts.
            We believe that winning government contracts shouldn&apos;t require expensive consultants or insider connections.
          </p>
          <p className="text-gray-600">
            Our suite of intelligence tools gives you the same data and insights that large contractors use,
            at a fraction of the cost. With lifetime access pricing, we&apos;re committed to making these tools
            accessible to every small business owner with federal contracting ambitions.
          </p>
        </div>

        {/* What We Offer */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">What We Offer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔍</span>
              <div>
                <h3 className="font-bold text-gray-900">Opportunity Hunter</h3>
                <p className="text-sm text-gray-600">Free agency discovery tool to find your best-fit agencies</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <h3 className="font-bold text-gray-900">Contractor Database</h3>
                <p className="text-sm text-gray-600">200K+ federal contractors for teaming opportunities</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">📋</span>
              <div>
                <h3 className="font-bold text-gray-900">Recompete Contracts</h3>
                <p className="text-sm text-gray-600">Find expiring contracts before they hit the market</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔎</span>
              <div>
                <h3 className="font-bold text-gray-900">Prime Lookup</h3>
                <p className="text-sm text-gray-600">Research prime contractors by agency</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🤖</span>
              <div>
                <h3 className="font-bold text-gray-900">AI Content Generator</h3>
                <p className="text-sm text-gray-600">Generate capability statements and proposals</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🎯</span>
              <div>
                <h3 className="font-bold text-gray-900">Federal Market Assassin</h3>
                <p className="text-sm text-gray-600">Complete strategic intelligence system</p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-lg p-8 text-white">
          <h2 className="text-2xl font-bold mb-6">Contact Us</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">📧</span>
              <div>
                <p className="text-sm opacity-80">Email</p>
                <a href="mailto:support@govcongiants.com" className="hover:text-amber-400 transition-colors">
                  support@govcongiants.com
                </a>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xl">💬</span>
              <div>
                <p className="text-sm opacity-80">Support Hours</p>
                <p>Monday - Friday, 9am - 5pm EST</p>
              </div>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-slate-700">
            <p className="text-sm opacity-80 mb-4">Ready to start winning contracts?</p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg transition-colors"
            >
              Explore Our Tools →
            </Link>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            ← Back to all tools
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-8 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-600">
          <p className="text-sm">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
