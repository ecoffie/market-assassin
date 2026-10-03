import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-(--mp-wash)">
      {/* Header */}
      <nav className="bg-white border-b border-(--mp-hair) sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-(--mp-navy)">GovCon</span>
              <span className="text-xl font-bold text-(--mp-accent)">Giants</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/" className="text-(--mp-muted) hover:text-(--mp-ink)">
                Tools
              </Link>
              <Link href="/free-resources" className="text-(--mp-muted) hover:text-(--mp-ink)">
                Free Resources
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">
            About GovCon Giants
          </h1>
          <p className="text-xl text-(--mp-muted) max-w-2xl mx-auto">
            Empowering small businesses to win federal contracts with data-driven intelligence tools.
          </p>
        </div>

        {/* Mission */}
        <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none p-8 mb-8">
          <h2 className="text-2xl font-bold text-(--mp-ink) mb-4 font-(family-name:--mp-font-serif)">Our Mission</h2>
          <p className="text-(--mp-muted) mb-4">
            GovCon Giants was built to level the playing field for small businesses pursuing federal contracts.
            We believe that winning government contracts shouldn&apos;t require expensive consultants or insider connections.
          </p>
          <p className="text-(--mp-muted)">
            Our suite of intelligence tools gives you the same data and insights that large contractors use,
            at a fraction of the cost. With lifetime access pricing, we&apos;re committed to making these tools
            accessible to every small business owner with federal contracting ambitions.
          </p>
        </div>

        {/* What We Offer */}
        <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none p-8 mb-8">
          <h2 className="text-2xl font-bold text-(--mp-ink) mb-6 font-(family-name:--mp-font-serif)">What We Offer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔍</span>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">Opportunity Hunter</h3>
                <p className="text-sm text-(--mp-muted)">Free agency discovery tool to find your best-fit agencies</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🏢</span>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">Contractor Database</h3>
                <p className="text-sm text-(--mp-muted)">200K+ federal contractors for teaming opportunities</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">📋</span>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">Recompete Contracts</h3>
                <p className="text-sm text-(--mp-muted)">Find expiring contracts before they hit the market</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔎</span>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">Prime Lookup</h3>
                <p className="text-sm text-(--mp-muted)">Research prime contractors by agency</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🤖</span>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">Content Reaper</h3>
                <p className="text-sm text-(--mp-muted)">Generate capability statements and proposals</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-2xl">🎯</span>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">Federal Market Assassin</h3>
                <p className="text-sm text-(--mp-muted)">Complete strategic intelligence system</p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="rounded-none p-8 text-(--mp-ink) bg-(--mp-wash)">
          <h2 className="text-2xl font-bold mb-6 font-(family-name:--mp-font-serif)">Contact Us</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">📧</span>
              <div>
                <p className="text-sm opacity-80">Email</p>
                <a href="mailto:support@getmindy.ai" className="hover:text-(--mp-navy) transition-colors">
                  support@getmindy.ai
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
          <div className="mt-8 pt-6 border-t border-(--mp-line)">
            <p className="text-sm opacity-80 mb-4">Ready to start winning contracts?</p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-bold rounded-none transition-colors"
            >
              Explore Our Tools →
            </Link>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-(--mp-muted) hover:text-(--mp-body)">
            ← Back to all tools
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-(--mp-hair) py-8 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-(--mp-muted)">
          <p className="text-sm">
            © {new Date().getFullYear()} GovCon Giants. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
