import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex items-center justify-between h-16">
            <Link href="/" className="text-2xl font-bold text-blue-800 flex items-center gap-2">
              <span>🚀</span> GovCon Giants
            </Link>
            <ul className="hidden md:flex items-center gap-8">
              <li><a href="#tools" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Tools</a></li>
              <li><a href="#databases" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Databases</a></li>
              <li><a href="#resources" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Resources</a></li>
              <li><Link href="/about" className="text-gray-800 hover:text-blue-800 font-medium text-sm">About</Link></li>
            </ul>
            <div className="flex items-center gap-4">
              <Link href="/free-resources" className="px-4 py-2 text-gray-800 border border-gray-200 rounded-lg font-semibold text-sm hover:bg-gray-50">
                Free Resources
              </Link>
              <Link href="/opportunity-scout" className="px-5 py-2 bg-gradient-to-r from-blue-800 to-purple-600 text-white rounded-lg font-semibold text-sm hover:shadow-lg transition-all hover:-translate-y-0.5">
                Get Started
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-800 to-purple-600 text-white py-20 px-6 text-center">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold mb-6 leading-tight">
            Discover Tools for Federal Contractors
          </h1>
          <p className="text-xl mb-8 opacity-95">
            Access powerful databases, guides, and resources to grow your government contracting business. Everything you need in one place.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a href="#tools" className="px-8 py-4 bg-white text-blue-800 rounded-lg font-bold text-lg hover:shadow-xl transition-all hover:-translate-y-0.5">
              Explore Tools
            </a>
            <Link href="/opportunity-scout" className="px-8 py-4 bg-transparent border-2 border-white text-white rounded-lg font-bold text-lg hover:bg-white/10 transition-all">
              Try Free Tool
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10">Browse by Category</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
            {[
              { icon: "📊", title: "Databases", desc: "Searchable contractor databases" },
              { icon: "📝", title: "Guides", desc: "Step-by-step tutorials" },
              { icon: "🔍", title: "Research Tools", desc: "Find opportunities faster" },
              { icon: "📅", title: "Forecasts", desc: "Contract expiring dates" },
              { icon: "📋", title: "Templates", desc: "Ready-to-use documents" },
              { icon: "🎯", title: "Hit Lists", desc: "Targeted company lists" },
            ].map((cat, i) => (
              <div key={i} className="bg-white p-6 rounded-xl border border-gray-200 text-center cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
                <div className="text-4xl mb-3">{cat.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{cat.title}</h3>
                <p className="text-sm text-gray-500">{cat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Products/Tools */}
      <section className="py-20 px-6" id="tools">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-10 flex-wrap gap-5">
            <h2 className="text-3xl font-bold">Featured Tools</h2>
            <div className="flex gap-3 flex-wrap">
              {["All", "Free", "Premium", "New"].map((tab, i) => (
                <button
                  key={tab}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                    i === 0
                      ? "bg-blue-800 text-white border-blue-800"
                      : "bg-gray-50 text-gray-800 border-gray-200 hover:border-blue-800"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Federal Market Assassin - FLAGSHIP */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-5xl text-white">
                🎯
              </div>
              <div className="p-6">
                <span className="inline-block bg-red-600 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FLAGSHIP</span>
                <h3 className="text-xl font-bold mb-2">Federal Market Assassin</h3>
                <p className="text-gray-500 text-sm mb-4">Enter 5 inputs. Select target agencies. Get 8 comprehensive strategic reports instantly. The ultimate GovCon intelligence system.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> 8 Strategic Reports</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Agency Spending Analysis</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Subcontracting Opportunities</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> OSBP Contacts Directory</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$1,997/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$597</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <Link href="/market-assassin" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </Link>
                </div>
              </div>
            </div>

            {/* AI Content Generator */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-5xl text-white">
                🤖
              </div>
              <div className="p-6">
                <span className="inline-block bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2">AI Content Generator</h3>
                <p className="text-gray-500 text-sm mb-4">Generate compelling capability statements, proposals, and marketing content tailored for government contracting.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Capability Statement Generator</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Proposal Content Templates</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> GovCon-Specific AI Prompts</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> LinkedIn Post Generator</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$197/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$197</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <Link href="/ai-content" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </Link>
                </div>
              </div>
            </div>

            {/* Contractor Database */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-5xl text-white">
                🏛️
              </div>
              <div className="p-6">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2">Federal Contractor Database</h3>
                <p className="text-gray-500 text-sm mb-4">Interactive searchable version of your Prime/Tier-2/SBLO directories. Pro tier adds AI teaming match + exports. Massive upgrade from free PDFs.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> 200K+ Federal Contractors</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> SBLO Contact Info</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Teaming Partner Finder</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Vendor Portal Links</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$297/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$197</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <Link href="/contractor-database" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </Link>
                </div>
              </div>
            </div>

            {/* Recompete Contracts */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-5xl text-white">
                📅
              </div>
              <div className="p-6">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2">Expiring Contracts Database</h3>
                <p className="text-gray-500 text-sm mb-4">Track expiring federal contracts. Get ahead of competition with incumbent contractor details.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Contracts Expiring 12 Months</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Details</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> NAICS Code Filtering</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Historical Performance Data</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$497/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$397</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <Link href="/recompete-contracts" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </Link>
                </div>
              </div>
            </div>

            {/* Prime Lookup */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-5xl text-white">
                🔎
              </div>
              <div className="p-6">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2">Prime Lookup Tool</h3>
                <p className="text-gray-500 text-sm mb-4">Research prime contractors by agency. Find teaming opportunities and subcontracting targets.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Agency-Specific Primes</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Contract Values & History</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Contact Information</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Subcontracting Goals</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$347/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$247</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <Link href="/prime-lookup" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </Link>
                </div>
              </div>
            </div>

            {/* Opportunity Scout - FREE */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-5xl text-white">
                🔍
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE</span>
                <h3 className="text-xl font-bold mb-2">Opportunity Scout</h3>
                <p className="text-gray-500 text-sm mb-4">Find out which government buyers buy what you sell. Identify your ideal federal customers in minutes.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Agency Spending Analysis</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Matching</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> NAICS-Based Targeting</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Historical Spend Data</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$97/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">No credit card</div>
                  </div>
                  <Link href="/opportunity-scout" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Start Free
                  </Link>
                </div>
              </div>
            </div>

            {/* SBLO Directory - FREE PDF */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-5xl text-white">
                📄
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2">SBLO Contact Directory</h3>
                <p className="text-gray-500 text-sm mb-4">Small Business Liaison Officers (SBLO) at federal agencies and prime contractors.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> 76+ Agencies Covered</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Direct Contact Info</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Email Addresses</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Instant PDF Download</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$997 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <Link href="/sblo-directory" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download PDF
                  </Link>
                </div>
              </div>
            </div>

            {/* December Spend - FREE PDF */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-5xl text-white">
                💰
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2">December Spend Forecast</h3>
                <p className="text-gray-500 text-sm mb-4">Capitalize on year-end government spending. Agency budgets, hot categories, and positioning strategies.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Agency Budget Forecasts</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Hot Spending Categories</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Key Deadline Calendar</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Winning Strategies</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$1,297 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <Link href="/december-spend" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download PDF
                  </Link>
                </div>
              </div>
            </div>

            {/* AI Prompts - FREE PDF */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-5xl text-white">
                🤖
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2">75+ AI Prompts for GovCon</h3>
                <p className="text-gray-500 text-sm mb-4">Ready-to-use AI prompts to accelerate your federal contracting business. Works with ChatGPT, Claude & more.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> 75+ Ready-to-Use Prompts</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> BD & Proposal Writing</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Marketing & Operations</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Copy-Paste Format</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$797 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <Link href="/ai-prompts" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download PDF
                  </Link>
                </div>
              </div>
            </div>

            {/* Expiring Contracts Forecast - PREMIUM */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-cyan-600 to-cyan-800 flex items-center justify-center text-5xl text-white">
                ⏰
              </div>
              <div className="p-6">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2">Expiring Contracts Forecast</h3>
                <p className="text-gray-500 text-sm mb-4">Track $221B+ in expiring federal contracts. Get ahead of recompete opportunities 3-6 months early.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> $221B+ Contract Data</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Monthly Updates</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Details</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> CSV Export Included</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$597/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$297</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <Link href="/expiring-contracts" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </Link>
                </div>
              </div>
            </div>

            {/* 2026 GovCon Action Plan - FREE */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-5xl text-white">
                📅
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2">2026 GovCon Action Plan</h3>
                <p className="text-gray-500 text-sm mb-4">Your step-by-step roadmap to winning federal contracts in 2026. Month-by-month milestones.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> 12-Month Roadmap</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Key Deadline Calendar</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Weekly Task Checklists</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Goal Tracking Worksheets</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$497 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <Link href="/action-plan-2026" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download PDF
                  </Link>
                </div>
              </div>
            </div>

            {/* GovCon Guides & Templates - FREE */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-emerald-600 to-emerald-800 flex items-center justify-center text-5xl text-white">
                📖
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2">GovCon Guides & Templates</h3>
                <p className="text-gray-500 text-sm mb-4">Comprehensive guides and ready-to-use templates for federal contracting success.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> SAM Registration Guide</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> SBLO Email Templates</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Proposal Checklists</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> BD Pipeline Tracker</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$97 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Bundle</div>
                  </div>
                  <Link href="/guides-templates" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download PDF
                  </Link>
                </div>
              </div>
            </div>

            {/* Tier-2 Supplier Directory - FREE */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center text-5xl text-white">
                🤝
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2">Tier-2 Supplier Directory</h3>
                <p className="text-gray-500 text-sm mb-4">Access Tier-2 supplier contacts and vendor registration portals at major prime contractors.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> 50+ Prime Contractors</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Vendor Portal Links</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Supplier Contacts</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Organized by NAICS</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$697 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Directory</div>
                  </div>
                  <Link href="/tier2-directory" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download PDF
                  </Link>
                </div>
              </div>
            </div>

            {/* Free Expiring Contracts CSV - FREE */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
              <div className="h-48 bg-gradient-to-br from-cyan-500 to-cyan-700 flex items-center justify-center text-5xl text-white">
                📊
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE</span>
                <h3 className="text-xl font-bold mb-2">Free Expiring Contracts CSV</h3>
                <p className="text-gray-500 text-sm mb-4">Sample of expiring federal contracts data. Import into Excel, Sheets, or your CRM.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Sample Contract Data</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Info</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Expiration Dates</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500 font-bold">✓</span> Works with Any CRM</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$697 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">CSV Download</div>
                  </div>
                  <Link href="/expiring-contracts-csv" className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    Download CSV
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bundle Section */}
      <section className="py-20 px-6 bg-gray-50" id="bundles">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Bundle & Save</h2>
          <p className="text-gray-500 text-center mb-12">Get everything you need at one unbeatable price</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Starter Bundle */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 transition-all hover:-translate-y-1 hover:shadow-lg hover:border-blue-500">
              <div className="text-center mb-6">
                <span className="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-semibold mb-3">STARTER</span>
                <h3 className="text-2xl font-bold">Starter Bundle</h3>
              </div>
              <div className="text-center mb-6">
                <div className="text-4xl font-bold text-gray-900">$497</div>
                <div className="text-sm text-emerald-600 font-medium">One-Time Payment</div>
              </div>
              <ul className="space-y-3 mb-6 text-sm">
                <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> Opportunity Scout (FREE)</li>
                <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> Contractor Database</li>
                <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> AI Content Generator</li>
              </ul>
              <div className="text-center text-sm text-gray-400 mb-4 line-through">$494 if bought separately</div>
              <a href="https://govcongiants.lemonsqueezy.com/checkout/buy/starter-bundle" target="_blank" rel="noopener noreferrer" className="block w-full py-3 bg-blue-800 text-white text-center rounded-lg font-semibold hover:bg-blue-700 transition-all">
                Get Starter Bundle
              </a>
            </div>

            {/* Pro Giant Bundle - Featured */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border-2 border-amber-500 p-6 relative transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-amber-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg">MOST POPULAR</span>
              </div>
              <div className="text-center mb-6 pt-2">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-sm font-semibold mb-3">PRO GIANT</span>
                <h3 className="text-2xl font-bold">Pro Giant Bundle</h3>
              </div>
              <div className="text-center mb-6">
                <div className="text-4xl font-bold text-gray-900">$997</div>
                <div className="text-sm text-emerald-600 font-medium">One-Time Payment</div>
              </div>
              <ul className="space-y-3 mb-6 text-sm">
                <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> <strong>Everything in Starter, plus:</strong></li>
                <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> Recompete Contracts</li>
                <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> Prime Lookup</li>
                <li className="flex items-center gap-2"><span className="text-emerald-600">✓</span> Federal Market Assassin</li>
              </ul>
              <div className="text-center text-sm text-gray-400 mb-4 line-through">$1,138 if bought separately</div>
              <a href="https://govcongiants.lemonsqueezy.com/checkout/buy/pro-giant-bundle" target="_blank" rel="noopener noreferrer" className="block w-full py-3 bg-amber-500 text-white text-center rounded-lg font-semibold hover:bg-amber-400 transition-all">
                Get Pro Giant Bundle
              </a>
            </div>

            {/* Ultimate Giant Bundle */}
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 p-6 text-white transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="text-center mb-6">
                <span className="inline-block bg-gradient-to-r from-amber-400 to-amber-500 text-gray-900 px-3 py-1 rounded-full text-sm font-semibold mb-3">ULTIMATE</span>
                <h3 className="text-2xl font-bold">Ultimate Giant</h3>
              </div>
              <div className="text-center mb-6">
                <div className="text-4xl font-bold text-amber-400">$1,497</div>
                <div className="text-sm text-emerald-400 font-medium">One-Time Payment</div>
              </div>
              <ul className="space-y-3 mb-6 text-sm opacity-90">
                <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> <strong>Everything in Pro Giant, plus:</strong></li>
                <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> 1-on-1 Strategy Session</li>
                <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> Priority Support</li>
                <li className="flex items-center gap-2"><span className="text-amber-400">✓</span> Future Tools Access</li>
              </ul>
              <div className="text-center text-sm opacity-50 mb-4 line-through">$2,000+ value</div>
              <a href="https://govcongiants.lemonsqueezy.com/checkout/buy/ultimate-giant-bundle" target="_blank" rel="noopener noreferrer" className="block w-full py-3 bg-gradient-to-r from-amber-400 to-amber-500 text-gray-900 text-center rounded-lg font-bold hover:from-amber-300 hover:to-amber-400 transition-all">
                Get Ultimate Giant
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-10">
            <div>
              <h4 className="font-bold mb-4">Products</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#tools" className="text-gray-400 hover:text-white">All Tools</a></li>
                <li><a href="#databases" className="text-gray-400 hover:text-white">Databases</a></li>
                <li><a href="#bundles" className="text-gray-400 hover:text-white">Bundles</a></li>
                <li><Link href="/free-resources" className="text-gray-400 hover:text-white">Free Resources</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Resources</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/free-resources" className="text-gray-400 hover:text-white">Free PDFs</Link></li>
                <li><Link href="/opportunity-scout" className="text-gray-400 hover:text-white">Opportunity Scout</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/about" className="text-gray-400 hover:text-white">About Us</Link></li>
                <li><a href="mailto:support@govcongiants.com" className="text-gray-400 hover:text-white">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Legal</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#" className="text-gray-400 hover:text-white">Privacy Policy</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="text-center pt-10 border-t border-gray-800 text-gray-500 text-sm">
            <p>© {new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
