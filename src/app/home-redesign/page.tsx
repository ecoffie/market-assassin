import Link from "next/link";

export default function HomeRedesign() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <Link href="/home-redesign" className="flex items-center gap-1">
              <span className="text-2xl font-bold text-white">GovCon</span>
              <span className="text-2xl font-bold text-emerald-400">Giants</span>
            </Link>

            <div className="hidden md:flex items-center gap-8">
              <a href="#programs" className="text-slate-400 hover:text-white transition text-sm font-medium">Programs</a>
              <a href="https://freegovconcourse.com/" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition text-sm font-medium">Free Course</a>
              <a href="https://govcongiants.org/opp" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition text-sm font-medium">Opportunity Hunter</a>
              <a href="https://shop.govcongiants.org/free-resources" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition text-sm font-medium">Free Resources</a>
            </div>

            <div className="flex items-center gap-3">
              <a
                href="https://govcongiants.org/opp"
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-semibold text-sm transition-all"
              >
                Get Started Free
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-6 bg-gradient-to-b from-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            Secure Federal Contracts for Your Business
          </h1>

          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            GovCon Giants is the go-to community for small business owners entering the federal market.
            Gain insider knowledge, master certifications, find real opportunities, and build relationships
            that lead to consistent federal wins.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://govcongiants.org/surge"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold text-lg transition-all"
            >
              Join January 31 Bootcamp
            </a>
            <a
              href="https://govcongiants.org/opp"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-full font-bold text-lg transition-all border border-slate-600"
            >
              Try Free Tool
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-8 mt-16">
            <div className="bg-emerald-900/50 border border-emerald-700/50 text-white px-8 py-4 rounded-2xl">
              <span className="text-3xl font-bold text-emerald-400">$50M</span>
              <span className="ml-2 text-emerald-300">in Awards Won</span>
            </div>
            <div className="bg-emerald-900/50 border border-emerald-700/50 text-white px-8 py-4 rounded-2xl">
              <span className="text-3xl font-bold text-emerald-400">2,000+</span>
              <span className="ml-2 text-emerald-300">Students Trained</span>
            </div>
          </div>
        </div>
      </section>

      {/* Founder Section */}
      <section className="py-12 px-6 bg-slate-800/50">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-8 bg-slate-800 rounded-3xl p-8 border border-slate-700">
            <div className="w-28 h-28 rounded-full overflow-hidden flex-shrink-0 border-4 border-emerald-600/30">
              <div className="w-full h-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-3xl font-bold text-amber-900">
                EC
              </div>
            </div>
            <div className="text-center md:text-left">
              <h3 className="text-xl font-bold text-white mb-1">Eric Coffie</h3>
              <p className="text-emerald-400 font-medium mb-4">Founder & Host</p>
              <p className="text-slate-400 leading-relaxed">
                GovCon Giants is the go-to community for small business owners entering the federal market.
                Gain insider knowledge from proven experts — including contracting officers, proposal strategists,
                and successful government contractors. Our network helps you master certifications, find real
                opportunities, and build relationships that lead to consistent federal wins.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 Main Cards Section */}
      <section id="programs" className="py-20 px-6 bg-slate-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Your Path to GovCon Success
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto">
              Everything you need to start and grow your government contracting business.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* January 31 Bootcamp */}
            <a
              href="https://govcongiants.org/surge"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-slate-800 border border-slate-700 rounded-2xl p-6 transition-all hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <div className="text-4xl mb-4">🎓</div>
              <div className="text-emerald-400 text-xs font-semibold mb-2">JAN 31 • 9AM-5PM ET</div>
              <h3 className="text-xl font-bold text-white mb-3">January Bootcamp</h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Full-day intensive to win federal contracts in Q1 2026. Walk away with your personalized
                target agency list, 5+ matched opportunities, and a 90-day action plan.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> FY2026 NDAA: $848B Budget
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Opportunity Scout Workshop
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Teaming & Subcontracting
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 90-Day Action Plan
                </li>
              </ul>
              <span className="text-emerald-400 font-semibold text-sm group-hover:text-emerald-300 transition-colors">
                Join Bootcamp →
              </span>
            </a>

            {/* Surge Bootcamp */}
            <a
              href="https://govcongiants.org/bootcamp"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-slate-800 border border-slate-700 rounded-2xl p-6 transition-all hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10"
            >
              <div className="text-4xl mb-4">⚡</div>
              <div className="text-blue-400 text-xs font-semibold mb-2">INTENSIVE PROGRAM</div>
              <h3 className="text-xl font-bold text-white mb-3">Surge Bootcamp</h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Fast-track intensive for contractors ready to take action now.
                Get the databases, hit lists, and resources to start winning immediately.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Agency Hit Lists & Databases
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Contractor Database Access
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Recompete Contracts List
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Email Templates & Scripts
                </li>
              </ul>
              <span className="text-blue-400 font-semibold text-sm group-hover:text-blue-300 transition-colors">
                Join Surge →
              </span>
            </a>

            {/* Free GovCon Course */}
            <a
              href="https://freegovconcourse.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-slate-800 border border-slate-700 rounded-2xl p-6 transition-all hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/10"
            >
              <div className="text-4xl mb-4">🎬</div>
              <div className="text-purple-400 text-xs font-semibold mb-2">FREE COURSE</div>
              <h3 className="text-xl font-bold text-white mb-3">Free GovCon Course</h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Start learning government contracting fundamentals with our free online course.
                Perfect for beginners looking to break into federal contracting.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> GovCon Fundamentals
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Step-by-Step Training
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Self-Paced Learning
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 100% Free Access
                </li>
              </ul>
              <span className="text-purple-400 font-semibold text-sm group-hover:text-purple-300 transition-colors">
                Start Free Course →
              </span>
            </a>

            {/* Opportunity Hunter */}
            <a
              href="https://govcongiants.org/opp"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-slate-800 border border-slate-700 rounded-2xl p-6 transition-all hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10"
            >
              <div className="text-4xl mb-4">🔍</div>
              <div className="text-emerald-400 text-xs font-semibold mb-2">FREE TOOL</div>
              <h3 className="text-xl font-bold text-white mb-3">Opportunity Hunter</h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Discover which government agencies buy what you sell. Find your ideal federal customers
                in minutes with our free agency spending analysis tool.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Agency Spending Analysis
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> NAICS-Based Targeting
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Set-Aside Matching
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> No Credit Card Required
                </li>
              </ul>
              <span className="text-emerald-400 font-semibold text-sm group-hover:text-emerald-300 transition-colors">
                Try Free Tool →
              </span>
            </a>

            {/* Free Resources */}
            <a
              href="https://shop.govcongiants.org/free-resources"
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-slate-800 border border-slate-700 rounded-2xl p-6 transition-all hover:border-rose-500 hover:shadow-lg hover:shadow-rose-500/10"
            >
              <div className="text-4xl mb-4">🎁</div>
              <div className="text-rose-400 text-xs font-semibold mb-2">FREE DOWNLOADS</div>
              <h3 className="text-xl font-bold text-white mb-3">Free Resources</h3>
              <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                Access free templates, guides, checklists, and databases to accelerate your
                government contracting journey. No strings attached.
              </p>
              <ul className="text-slate-400 text-sm space-y-2 mb-6">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> SBLO Contact Lists
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Proposal Templates
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> AI Prompts for GovCon
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Action Plans & Guides
                </li>
              </ul>
              <span className="text-rose-400 font-semibold text-sm group-hover:text-rose-300 transition-colors">
                Browse Resources →
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-gradient-to-r from-emerald-900 to-emerald-800">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-6">
            Ready to Start Your GovCon Journey?
          </h2>
          <p className="text-emerald-200 text-lg mb-8 max-w-2xl mx-auto">
            Join thousands of small business owners winning government contracts with GovCon Giants.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://govcongiants.org/surge"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-white hover:bg-gray-100 text-emerald-800 rounded-full font-bold text-lg transition-all"
            >
              Join January 31 Bootcamp
            </a>
            <a
              href="https://govcongiants.org/opp"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-4 bg-emerald-700 hover:bg-emerald-600 text-white rounded-full font-bold text-lg transition-all border border-emerald-600"
            >
              Try Free Tool
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-slate-800 border-t border-slate-700">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-1 mb-4">
                <span className="text-xl font-bold text-white">GovCon</span>
                <span className="text-xl font-bold text-emerald-400">Giants</span>
              </div>
              <p className="text-slate-500 text-sm">
                Empowering small businesses to win federal contracts.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Bootcamps</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://govcongiants.org/surge" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition">January 31 Bootcamp</a></li>
                <li><a href="https://govcongiants.org/bootcamp" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition">Surge Bootcamp</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://freegovconcourse.com/" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition">Free GovCon Course</a></li>
                <li><a href="https://govcongiants.org/opp" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition">Opportunity Hunter</a></li>
                <li><a href="https://shop.govcongiants.org/free-resources" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition">Free Resources</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://govcongiants.org" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition">Main Website</a></li>
                <li><a href="mailto:support@govcongiants.com" className="text-slate-400 hover:text-white transition">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-700 pt-8 text-center">
            <p className="text-slate-500 text-sm">
              © {new Date().getFullYear()} GovCon Giants. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
