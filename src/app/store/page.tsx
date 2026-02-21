import Link from "next/link";
import Image from "next/image";

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
              <li><a href="#bundles" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Bundles</a></li>
              <li><a href="#resources" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Resources</a></li>
              <li><Link href="/about" className="text-gray-800 hover:text-blue-800 font-medium text-sm">About</Link></li>
            </ul>
            <div className="flex items-center gap-4">
              <Link href="/free-resources" className="px-4 py-2 text-gray-800 border border-gray-200 rounded-lg font-semibold text-sm hover:bg-gray-50">
                Free Resources
              </Link>
              <Link href="/opportunity-hunter" className="px-5 py-2 bg-gradient-to-r from-blue-800 to-purple-600 text-white rounded-lg font-semibold text-sm hover:shadow-lg transition-all hover:-translate-y-0.5">
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
            <Link href="/opportunity-hunter" className="px-8 py-4 bg-transparent border-2 border-white text-white rounded-lg font-bold text-lg hover:bg-white/10 transition-all">
              Try Free Tool
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-10 text-gray-900">Browse by Category</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
            {[
              { icon: "📊", title: "Databases", desc: "Searchable contractor databases", href: "/contractor-database" },
              { icon: "📝", title: "Guides", desc: "Step-by-step tutorials", href: "/guides-templates" },
              { icon: "🔍", title: "Research Tools", desc: "Find opportunities faster", href: "/opportunity-hunter" },
              { icon: "📅", title: "Forecasts", desc: "Contract expiring dates", href: "/expiring-contracts" },
              { icon: "📋", title: "Templates", desc: "Ready-to-use documents", href: "/guides-templates" },
              { icon: "🎯", title: "Hit Lists", desc: "Targeted company lists", href: "/december-spend" },
            ].map((cat, i) => (
              <Link key={i} href={cat.href} className="block bg-white p-6 rounded-xl border border-gray-200 text-center cursor-pointer transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500">
                <div className="text-4xl mb-3">{cat.icon}</div>
                <h3 className="text-lg font-semibold mb-2 text-gray-900">{cat.title}</h3>
                <p className="text-sm text-gray-500">{cat.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Products/Tools */}
      <section className="py-20 px-6" id="tools">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 mb-10">Featured Tools</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Federal Market Assassin - FLAGSHIP */}
            <Link href="/market-assassin" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-red-600 to-red-800 relative overflow-hidden">
                <img src="/images/products/market-assassin/home page.png" alt="Market Assassin" className="w-full h-full object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-red-600 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FLAGSHIP</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Federal Market Assassin</h3>
                <p className="text-gray-500 text-sm mb-4">Enter 5 inputs. Select target agencies. Get 8 comprehensive strategic reports instantly. The ultimate GovCon intelligence system.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 8 Strategic Reports</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Agency Spending Analysis</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Subcontracting Opportunities</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> OSBP Contacts Directory</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$997+ value</div>
                    <div className="text-2xl font-bold text-blue-800">From $297</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm hover:bg-purple-600 transition-all hover:-translate-y-0.5">
                    View Details
                  </span>
                </div>
              </div>
            </Link>

            {/* Content Reaper */}
            <Link href="/content-generator" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-purple-600 to-pink-500 relative overflow-hidden">
                <Image src="/images/products/ai content generator/ai content generator home page.png" alt="Content Reaper" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Content Reaper</h3>
                <p className="text-gray-500 text-sm mb-4">Create LinkedIn posts that resonate with government buyers. GovCon-tuned AI trained on 146 viral posts.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Generate 10 Posts Per Click</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 250 Federal Agencies</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> GovCon-Tuned AI Model</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> GEO Boost Optimization</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$588/year value</div>
                    <div className="text-2xl font-bold text-blue-800">From $197</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    View Details
                  </span>
                </div>
              </div>
            </Link>

            {/* Interactive SBLO & Subcontractor Database */}
            <Link href="/contractor-database-product" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-indigo-500 to-purple-600 relative overflow-hidden">
                <Image src="/images/products/contractor-database/main home page.png" alt="Interactive SBLO & Subcontractor Database" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Interactive SBLO & Subcontractor Database</h3>
                <p className="text-gray-500 text-sm mb-4">Interactive searchable version of your Prime/Tier-2/SBLO directories. Pro tier adds AI teaming match + exports. Massive upgrade from free PDFs.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 3,500+ Federal Contractors</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> SBLO Contact Info</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Teaming Partner Finder</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Vendor Portal Links</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$997/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$497</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    View Details
                  </span>
                </div>
              </div>
            </Link>

            {/* Recompete Contracts */}
            <Link href="/expiring-contracts" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-blue-500 to-cyan-500 relative overflow-hidden">
                <Image src="/images/products/expiring-contracts/home page expiring contracts.png" alt="Expiring Contracts" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">PREMIUM</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Recompete Tracker</h3>
                <p className="text-gray-500 text-sm mb-4">Track expiring federal contracts. Get ahead of competition with incumbent contractor details.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Contracts Expiring 12 Months</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Details</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> NAICS Code Filtering</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Historical Performance Data</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$497/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">$397</div>
                    <div className="text-xs text-gray-500">one-time</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    View Details
                  </span>
                </div>
              </div>
            </Link>

            {/* Opportunity Hunter - FREE */}
            <Link href="/opportunity-hunter" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-blue-600 to-blue-800 relative overflow-hidden">
                <Image src="/images/products/opportunity-hunter/opp hunter home page.png" alt="Opportunity Hunter" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Opportunity Hunter</h3>
                <p className="text-gray-500 text-sm mb-4">Find out which government buyers buy what you sell. Identify your ideal federal customers in minutes.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Agency Spending Analysis</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Matching</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> NAICS-Based Targeting</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Historical Spend Data</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$97/mo value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">No credit card</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Start Free
                  </span>
                </div>
              </div>
            </Link>

            {/* SBLO Contact List - FREE SAMPLE */}
            <Link href="/sblo-directory" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-emerald-500 to-teal-500 relative overflow-hidden">
                <Image src="/images/products/sblo-directory/main page prime.png" alt="SBLO Contact List" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE SAMPLE</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">SBLO Contact List</h3>
                <p className="text-gray-500 text-sm mb-4">Small Business Liaison Officers (SBLO) at federal agencies and prime contractors.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 76+ Agencies Covered</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Direct Contact Info</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Email Addresses</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Instant PDF Download</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$997 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download PDF
                  </span>
                </div>
              </div>
            </Link>

            {/* December Spend - FREE PDF */}
            <Link href="/december-spend" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-red-500 to-orange-500 relative overflow-hidden">
                <Image src="/images/products/december-spend/december hit list.png" alt="December Spend" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">December Spend Forecast</h3>
                <p className="text-gray-500 text-sm mb-4">Capitalize on year-end government spending. Agency budgets, hot categories, and positioning strategies.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Agency Budget Forecasts</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Hot Spending Categories</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Key Deadline Calendar</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Winning Strategies</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$1,297 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download PDF
                  </span>
                </div>
              </div>
            </Link>

            {/* AI Prompts - FREE PDF */}
            <Link href="/ai-prompts" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-purple-600 to-pink-500 relative overflow-hidden">
                <Image src="/images/products/ai-prompts/teaming prompts.png" alt="AI Prompts" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">75+ AI Prompts for GovCon</h3>
                <p className="text-gray-500 text-sm mb-4">Ready-to-use AI prompts to accelerate your federal contracting business. Works with ChatGPT, Claude & more.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 75+ Ready-to-Use Prompts</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> BD & Proposal Writing</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Marketing & Operations</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Copy-Paste Format</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$797 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download PDF
                  </span>
                </div>
              </div>
            </Link>

            {/* 2026 GovCon Action Plan - FREE */}
            <Link href="/action-plan-2026" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-blue-600 to-purple-600 relative overflow-hidden">
                <Image src="/images/products/action-plan-2026/action plan home.png" alt="2026 Action Plan" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">2026 GovCon Action Plan</h3>
                <p className="text-gray-500 text-sm mb-4">Your step-by-step roadmap to winning federal contracts in 2026. Month-by-month milestones.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 12-Month Roadmap</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Key Deadline Calendar</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Weekly Task Checklists</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Goal Tracking Worksheets</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$497 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Download</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download PDF
                  </span>
                </div>
              </div>
            </Link>

            {/* GovCon Guides & Templates - FREE */}
            <Link href="/guides-templates" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-emerald-600 to-emerald-800 relative overflow-hidden">
                <img src="/images/products/guides-templates/ndaa fy2026.png" alt="GovCon Guides & Templates" className="w-full h-full object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE PDF</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">GovCon Guides & Templates</h3>
                <p className="text-gray-500 text-sm mb-4">Comprehensive guides and ready-to-use templates for federal contracting success.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> SAM Registration Guide</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> SBLO Email Templates</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Proposal Checklists</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> BD Pipeline Tracker</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$97 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Bundle</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download PDF
                  </span>
                </div>
              </div>
            </Link>

            {/* Tier-2 Supplier List - FREE SAMPLE */}
            <Link href="/tier2-directory" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-purple-600 to-violet-600 relative overflow-hidden">
                <Image src="/images/products/tier2-directory/tier 2 main.png" alt="Tier-2 Supplier List" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE SAMPLE</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Tier-2 Supplier List</h3>
                <p className="text-gray-500 text-sm mb-4">Access Tier-2 supplier contacts and vendor registration portals at major prime contractors.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 50+ Prime Contractors</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Vendor Portal Links</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Supplier Contacts</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Organized by NAICS</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$697 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">PDF Directory</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download PDF
                  </span>
                </div>
              </div>
            </Link>

            {/* Free Expiring Contracts CSV - FREE */}
            <Link href="/expiring-contracts-csv" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-cyan-500 to-cyan-700 relative overflow-hidden">
                <Image src="/images/products/expiring-contracts-csv/main page.png" alt="Expiring Contracts CSV" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Free Expiring Contracts CSV</h3>
                <p className="text-gray-500 text-sm mb-4">Sample of expiring federal contracts data. Import into Excel, Sheets, or your CRM.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Sample Contract Data</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Prime Contractor Info</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Expiration Dates</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Works with Any CRM</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$697 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">CSV Download</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download CSV
                  </span>
                </div>
              </div>
            </Link>

            {/* Tribal Contractor List - FREE */}
            <Link href="/tribal-list" className="block bg-white border border-gray-200 rounded-xl overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg hover:border-emerald-500 cursor-pointer">
              <div className="h-48 bg-gradient-to-br from-emerald-600 to-teal-600 relative overflow-hidden">
                <Image src="/images/products/tribal-list/tribal main page.png" alt="Tribal Contractor List" fill className="object-cover object-top" />
              </div>
              <div className="p-6">
                <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-semibold mb-3">FREE</span>
                <h3 className="text-xl font-bold mb-2 text-gray-900">Tribal Contractor List</h3>
                <p className="text-gray-500 text-sm mb-4">500+ Native American-owned federal contractors for teaming and subcontracting opportunities.</p>
                <ul className="text-sm mb-5 space-y-1">
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> 500+ Tribal Contractors</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> Contact Information</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> NAICS & Certifications</li>
                  <li className="flex items-center gap-2 text-gray-700"><span className="text-emerald-500 font-bold">✓</span> CSV Download</li>
                </ul>
                <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                  <div>
                    <div className="text-sm text-gray-400 line-through">$297 value</div>
                    <div className="text-2xl font-bold text-blue-800">FREE</div>
                    <div className="text-xs text-gray-500">CSV Download</div>
                  </div>
                  <span className="px-5 py-2 bg-blue-800 text-white rounded-md font-semibold text-sm">
                    Download CSV
                  </span>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Bundles Section */}
      <section className="py-20 px-6 bg-gradient-to-b from-gray-50 to-white" id="bundles">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <span className="inline-block bg-gradient-to-r from-blue-800 to-purple-600 text-white px-4 py-1 rounded-full text-sm font-semibold mb-4">SAVE BIG</span>
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Bundle & Save</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">Get everything you need to dominate federal contracting. Our bundles offer the best value with savings up to $391.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* GovCon Starter Bundle */}
            <div className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:border-blue-500">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">STARTER</span>
                  <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Save $246</span>
                </div>
                <h3 className="text-2xl font-bold">GovCon Starter Bundle</h3>
                <p className="text-emerald-100 mt-2">Perfect for new contractors</p>
              </div>
              <div className="p-6">
                <div className="mb-6">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-bold text-gray-900">$697</span>
                    <span className="text-lg text-gray-400 line-through">$943</span>
                  </div>
                  <span className="text-sm text-gray-500">one-time payment</span>
                </div>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className="text-emerald-500 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Opportunity Hunter Pro</div>
                      <div className="text-sm text-gray-500">$49 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className="text-emerald-500 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Recompete Tracker</div>
                      <div className="text-sm text-gray-500">$397 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className="text-emerald-500 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Federal Contractor Database</div>
                      <div className="text-sm text-gray-500">$497 value</div>
                    </div>
                  </div>
                </div>
                <a
                  href="https://buy.stripe.com/6oU9AUeb46Z46h70CsfnO0s"
                  className="block w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-center rounded-lg font-bold text-lg hover:shadow-lg transition-all hover:-translate-y-0.5 mb-3"
                >
                  Get Starter Bundle
                </a>
                <Link href="/bundles/starter" className="block w-full py-3 border-2 border-gray-200 text-gray-700 text-center rounded-lg font-semibold hover:border-emerald-500 hover:text-emerald-600 transition-all">
                  View Details
                </Link>
              </div>
            </div>

            {/* Pro Giant Bundle - MOST POPULAR */}
            <div className="bg-white border-2 border-blue-500 rounded-2xl overflow-hidden transition-all hover:shadow-xl relative">
              <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-blue-800 text-white px-6 py-1 rounded-b-lg text-sm font-bold">
                MOST POPULAR
              </div>
              <div className="bg-gradient-to-r from-blue-800 to-purple-600 p-6 text-white pt-8">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">PRO</span>
                  <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Save $391</span>
                </div>
                <h3 className="text-2xl font-bold">Pro Giant Bundle</h3>
                <p className="text-blue-100 mt-2">Best value for serious contractors</p>
              </div>
              <div className="p-6">
                <div className="mb-6">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-bold text-gray-900">$997</span>
                    <span className="text-lg text-gray-400 line-through">$1,388</span>
                  </div>
                  <span className="text-sm text-gray-500">one-time payment</span>
                </div>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <span className="text-blue-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Federal Contractor Database</div>
                      <div className="text-sm text-gray-500">$497 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <span className="text-blue-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Recompete Tracker</div>
                      <div className="text-sm text-gray-500">$397 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <span className="text-blue-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Market Assassin Standard</div>
                      <div className="text-sm text-gray-500">$297 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <span className="text-blue-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Content Reaper</div>
                      <div className="text-sm text-gray-500">$197 value</div>
                    </div>
                  </div>
                </div>
                <a
                  href="https://buy.stripe.com/dRm7sMaYS0AG0WN5WMfnO0q"
                  className="block w-full py-4 bg-gradient-to-r from-blue-800 to-purple-600 text-white text-center rounded-lg font-bold text-lg hover:shadow-lg transition-all hover:-translate-y-0.5 mb-3"
                >
                  Get Pro Bundle
                </a>
                <Link href="/bundles/pro" className="block w-full py-3 border-2 border-gray-200 text-gray-700 text-center rounded-lg font-semibold hover:border-blue-500 hover:text-blue-600 transition-all">
                  View Details
                </Link>
              </div>
            </div>

            {/* Ultimate GovCon Bundle */}
            <div className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:border-amber-500">
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">ULTIMATE</span>
                  <span className="text-sm font-medium bg-white/20 px-3 py-1 rounded-full">Save $291</span>
                </div>
                <h3 className="text-2xl font-bold">Ultimate GovCon Bundle</h3>
                <p className="text-amber-100 mt-2">Everything you need to win</p>
              </div>
              <div className="p-6">
                <div className="mb-6">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-bold text-gray-900">$1,497</span>
                    <span className="text-lg text-gray-400 line-through">$1,788</span>
                  </div>
                  <span className="text-sm text-gray-500">one-time payment</span>
                </div>
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                    <span className="text-amber-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Content Reaper (Full Fix)</div>
                      <div className="text-sm text-gray-500">$397 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                    <span className="text-amber-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Federal Contractor Database</div>
                      <div className="text-sm text-gray-500">$497 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                    <span className="text-amber-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Recompete Tracker</div>
                      <div className="text-sm text-gray-500">$397 value</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                    <span className="text-amber-600 font-bold text-lg">✓</span>
                    <div>
                      <div className="font-medium text-gray-900">Market Assassin Premium</div>
                      <div className="text-sm text-gray-500">$497 value</div>
                    </div>
                  </div>
                </div>
                <a
                  href="https://buy.stripe.com/6oU3cwff897ceND84UfnO0t"
                  className="block w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-center rounded-lg font-bold text-lg hover:shadow-lg transition-all hover:-translate-y-0.5 mb-3"
                >
                  Get Ultimate Bundle
                </a>
                <Link href="/bundles/ultimate" className="block w-full py-3 border-2 border-gray-200 text-gray-700 text-center rounded-lg font-semibold hover:border-amber-500 hover:text-amber-600 transition-all">
                  View Details
                </Link>
              </div>
            </div>
          </div>

          {/* Bundle Comparison Note */}
          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm">All bundles include lifetime access. One-time payment, no subscriptions.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-10">
            <div>
              <h4 className="font-bold mb-4 text-white">Products</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#tools" className="text-gray-400 hover:text-white">All Tools</a></li>
                <li><a href="#bundles" className="text-gray-400 hover:text-white">Bundles</a></li>
                <li><Link href="/free-resources" className="text-gray-400 hover:text-white">Free Resources</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-white">Resources</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/free-resources" className="text-gray-400 hover:text-white">Free PDFs</Link></li>
                <li><Link href="/opportunity-hunter" className="text-gray-400 hover:text-white">Opportunity Hunter</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-white">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/about" className="text-gray-400 hover:text-white">About Us</Link></li>
                <li><a href="mailto:support@govcongiants.com" className="text-gray-400 hover:text-white">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4 text-white">Legal</h4>
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
