'use client';

import Link from 'next/link';

interface IncludedProduct {
  name: string;
  description: string;
  price: number;
  features: string[];
  link: string;
  icon: string;
}

interface Review {
  name: string;
  date: string;
  rating: number;
  text: string;
}

interface BundleProductPageProps {
  title: string;
  tagline: string;
  description: string;
  primaryColor: string;
  gradientFrom: string;
  gradientTo: string;
  price: number;
  originalPrice: number;
  checkoutUrl: string;
  includedProducts: IncludedProduct[];
  bonuses?: string[];
  reviews: Review[];
  highlightTitle?: string;
  highlightText?: string;
  bestFor: string[];
  badge?: string;
}

export default function BundleProductPage({
  title,
  tagline,
  description,
  primaryColor,
  gradientFrom,
  gradientTo,
  price,
  originalPrice,
  checkoutUrl,
  includedProducts,
  bonuses = [],
  reviews,
  highlightTitle,
  highlightText,
  bestFor,
  badge,
}: BundleProductPageProps) {
  const savings = originalPrice - price;
  const savingsPercent = Math.round((savings / originalPrice) * 100);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex items-center justify-between h-16">
            <Link href="/store" className="text-2xl font-bold text-blue-800">
              GovCon Giants
            </Link>
            <ul className="hidden md:flex items-center gap-8">
              <li><Link href="/store#tools" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Tools</Link></li>
              <li><Link href="/store#bundles" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Bundles</Link></li>
              <li><Link href="/free-resources" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Free Resources</Link></li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section
        className="py-16 px-6 text-white relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
      >
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left - Text Content */}
            <div>
              {badge && (
                <span className="inline-block bg-white/20 text-white px-4 py-1 rounded-full text-sm font-semibold mb-4">
                  {badge}
                </span>
              )}
              <h1 className="text-4xl md:text-5xl font-extrabold mb-4 leading-tight">{title}</h1>
              <p className="text-xl opacity-95 mb-6">{tagline}</p>
              <p className="text-lg opacity-90 mb-8">{description}</p>

              {/* Pricing */}
              <div className="bg-white/10 backdrop-blur rounded-xl p-6 mb-6">
                <div className="flex items-center gap-4 mb-3">
                  <span className="text-5xl font-extrabold">${price.toLocaleString()}</span>
                  <div>
                    <span className="text-2xl line-through opacity-70">${originalPrice.toLocaleString()}</span>
                    <span className="ml-2 bg-yellow-400 text-gray-900 px-3 py-1 rounded-full text-sm font-bold">
                      Save ${savings.toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="text-sm opacity-80">One-time payment. Lifetime access to all {includedProducts.length} products.</p>
              </div>

              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-8 py-4 bg-yellow-400 text-gray-900 rounded-lg font-bold text-lg hover:bg-yellow-300 transition-all hover:-translate-y-0.5 hover:shadow-xl"
              >
                Get {title} Now
              </a>
            </div>

            {/* Right - Included Products Preview */}
            <div className="bg-white/10 backdrop-blur rounded-2xl p-6">
              <h3 className="text-xl font-bold mb-4">{includedProducts.length} Products Included:</h3>
              <div className="space-y-3">
                {includedProducts.map((product, i) => (
                  <div key={i} className="flex items-center gap-4 bg-white/10 rounded-lg p-3">
                    <span className="text-3xl">{product.icon}</span>
                    <div className="flex-1">
                      <div className="font-semibold">{product.name}</div>
                      <div className="text-sm opacity-80">${product.price} value</div>
                    </div>
                    <span className="text-green-300 font-bold text-lg">✓</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-white/20 flex justify-between items-center">
                <span className="font-semibold">Total Value:</span>
                <span className="text-2xl font-bold">${originalPrice.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-8 px-6 bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap justify-center gap-8 text-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl">∞</span>
              <span className="text-gray-700 font-medium">Lifetime Access</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl text-green-500">↩</span>
              <span className="text-gray-700 font-medium">30-Day Refund</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔒</span>
              <span className="text-gray-700 font-medium">Secure Checkout</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚡</span>
              <span className="text-gray-700 font-medium">Instant Access</span>
            </div>
          </div>
        </div>
      </section>

      {/* Best For Section */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-8 text-gray-900">Perfect For You If...</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bestFor.map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-left bg-gray-50 p-4 rounded-lg">
                <span className="text-xl" style={{ color: primaryColor }}>✓</span>
                <span className="text-gray-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Included Products Detail */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Everything Included in Your Bundle</h2>
            <p className="text-xl text-gray-600">Get lifetime access to all {includedProducts.length} premium products</p>
          </div>

          <div className="space-y-8">
            {includedProducts.map((product, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
                <div className="p-8">
                  <div className="flex flex-col md:flex-row md:items-start gap-6">
                    {/* Product Icon */}
                    <div
                      className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl shrink-0"
                      style={{ background: `linear-gradient(135deg, ${gradientFrom}20 0%, ${gradientTo}20 100%)` }}
                    >
                      {product.icon}
                    </div>

                    {/* Product Info */}
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-2xl font-bold text-gray-900">{product.name}</h3>
                          <p className="text-gray-500">${product.price} value - Included FREE</p>
                        </div>
                        <span
                          className="px-3 py-1 rounded-full text-sm font-bold text-white"
                          style={{ backgroundColor: primaryColor }}
                        >
                          INCLUDED
                        </span>
                      </div>
                      <p className="text-gray-600 mb-4">{product.description}</p>

                      {/* Features Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                        {product.features.map((feature, j) => (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <span className="text-green-500 font-bold">✓</span>
                            <span className="text-gray-700">{feature}</span>
                          </div>
                        ))}
                      </div>

                      <Link
                        href={product.link}
                        className="text-sm font-medium hover:underline"
                        style={{ color: primaryColor }}
                      >
                        Learn more about {product.name} →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bonuses */}
      {bonuses.length > 0 && (
        <section className="py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <span className="inline-block bg-yellow-100 text-yellow-800 px-4 py-1 rounded-full text-sm font-semibold mb-4">
                BONUS
              </span>
              <h2 className="text-3xl font-bold text-gray-900">Plus These Bonuses</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bonuses.map((bonus, i) => (
                <div key={i} className="flex items-center gap-4 bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                  <span className="text-2xl">🎁</span>
                  <span className="text-gray-800 font-medium">{bonus}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Highlight Box */}
      {highlightTitle && highlightText && (
        <section className="py-16 px-6 bg-gray-50">
          <div className="max-w-4xl mx-auto">
            <div
              className="rounded-2xl p-8 text-white"
              style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
            >
              <h3 className="text-2xl font-bold mb-4">{highlightTitle}</h3>
              <p className="text-lg opacity-95 leading-relaxed">{highlightText}</p>
            </div>
          </div>
        </section>
      )}

      {/* Savings Breakdown */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Your Savings Breakdown</h2>
          </div>
          <div className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden">
            <div className="p-6">
              {includedProducts.map((product, i) => (
                <div key={i} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{product.icon}</span>
                    <span className="font-medium text-gray-900">{product.name}</span>
                  </div>
                  <span className="text-gray-600">${product.price}</span>
                </div>
              ))}
            </div>
            <div className="bg-gray-50 p-6">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-gray-700">Total if purchased separately:</span>
                <span className="text-xl line-through text-gray-400">${originalPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-gray-900">Your bundle price:</span>
                <span className="text-2xl font-bold" style={{ color: primaryColor }}>${price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                <span className="font-bold text-green-600 text-lg">You Save:</span>
                <span className="text-2xl font-bold text-green-600">${savings.toLocaleString()} ({savingsPercent}% off)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews */}
      <section className="py-16 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">What Our Customers Say</h2>
            <div className="flex items-center justify-center gap-2">
              <span className="text-yellow-400 text-2xl">★★★★★</span>
              <span className="text-gray-600">{reviews.length} reviews</span>
            </div>
          </div>
          <div className="space-y-4">
            {reviews.map((review, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-gray-900">{review.name}</div>
                    <div className="text-gray-500 text-sm">{review.date}</div>
                  </div>
                  <div className="text-yellow-400">{'★'.repeat(review.rating)}</div>
                </div>
                <p className="text-gray-700">{review.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="py-20 px-6 text-white text-center"
        style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
      >
        <div className="max-w-3xl mx-auto">
          <h2 className="text-4xl font-extrabold mb-4">Ready to Dominate GovCon?</h2>
          <p className="text-xl opacity-95 mb-8">
            Get all {includedProducts.length} products for just ${price.toLocaleString()} (save ${savings.toLocaleString()})
          </p>
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-10 py-5 bg-yellow-400 text-gray-900 rounded-lg font-bold text-xl hover:bg-yellow-300 transition-all hover:-translate-y-0.5 hover:shadow-xl"
          >
            Get {title} Now - ${price.toLocaleString()}
          </a>
          <p className="mt-6 text-sm opacity-80">
            30-day money-back guarantee. Lifetime access. No subscriptions.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-gray-500 text-sm">&copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
