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
  /** Retired: the public design system sets every colour. Kept so existing callers still compile. */
  primaryColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
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
  accessSummary?: string;
  accessBadgeLabel?: string;
  includedProductsSubtitle?: string;
  guaranteeText?: string;
}

export default function BundleProductPage({
  title,
  tagline,
  description,
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
  accessSummary,
  accessBadgeLabel = 'Lifetime Access',
  includedProductsSubtitle,
  guaranteeText = '30-day money-back guarantee. Lifetime access. No subscriptions.',
}: BundleProductPageProps) {
  const savings = originalPrice - price;
  const savingsPercent = Math.round((savings / originalPrice) * 100);

  return (
    <div className="bg-(--mp-paper) text-(--mp-ink)">
      {/* Header */}
      <header className="bg-(--mp-surface) border-b border-(--mp-line)">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex items-center justify-between h-16">
            <Link href="/store" className="font-(family-name:--mp-font-serif) text-xl font-bold text-(--mp-ink)">
              GovCon Giants
            </Link>
            <ul className="hidden md:flex items-center gap-8">
              <li><Link href="/store#tools" className="text-(--mp-body) hover:text-(--mp-navy) font-medium text-sm">Tools</Link></li>
              <li><Link href="/store#bundles" className="text-(--mp-body) hover:text-(--mp-navy) font-medium text-sm">Bundles</Link></li>
              <li><Link href="/free-resources" className="text-(--mp-body) hover:text-(--mp-navy) font-medium text-sm">Free Resources</Link></li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section
        className="py-16 px-6 bg-(--mp-wash) border-b border-(--mp-line) relative overflow-hidden"
      >
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left - Text Content */}
            <div>
              {badge && (
                <span className="inline-block border border-(--mp-line) bg-(--mp-surface) text-(--mp-accent) px-3 py-1 rounded-[6px] text-xs font-bold tracking-[0.14em] uppercase mb-4">
                  {badge}
                </span>
              )}
              <h1 className="font-(family-name:--mp-font-serif) text-4xl md:text-5xl font-bold mb-4 leading-tight text-(--mp-ink)">{title}</h1>
              <p className="font-(family-name:--mp-font-serif) text-xl text-(--mp-body) mb-6">{tagline}</p>
              <p className="text-lg text-(--mp-body) mb-8">{description}</p>

              {/* Pricing */}
              <div className="bg-(--mp-surface) border border-(--mp-line) p-6 mb-6">
                <div className="flex items-center gap-4 mb-3">
                  <span className="font-(family-name:--mp-font-mono) text-5xl font-semibold text-(--mp-ink)">${price.toLocaleString()}</span>
                  <div>
                    <span className="font-(family-name:--mp-font-mono) text-2xl line-through text-(--mp-muted)">${originalPrice.toLocaleString()}</span>
                    <span className="ml-2 border border-(--mp-line) bg-(--mp-wash) text-(--mp-ink) px-3 py-1 rounded-[6px] text-sm font-bold">
                      Save ${savings.toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-(--mp-muted)">
                  {accessSummary || `One-time payment. Lifetime access to all ${includedProducts.length} products.`}
                </p>
              </div>

              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-8 py-4 bg-(--mp-navy) text-white font-semibold text-lg hover:bg-(--mp-navy-hover) transition-colors"
              >
                Get {title} Now
              </a>
            </div>

            {/* Right - Included Products Preview */}
            <div className="bg-(--mp-surface) border border-(--mp-line) p-6">
              <h3 className="font-(family-name:--mp-font-serif) text-xl font-bold mb-4 text-(--mp-ink)">{includedProducts.length} Products Included:</h3>
              <div className="space-y-3">
                {includedProducts.map((product, i) => (
                  <div key={i} className="flex items-center gap-4 bg-(--mp-wash) border border-(--mp-hair) p-3">
                    <span className="text-3xl">{product.icon}</span>
                    <div className="flex-1">
                      <div className="font-semibold text-(--mp-ink)">{product.name}</div>
                      <div className="text-sm text-(--mp-muted)">${product.price} value</div>
                    </div>
                    <span className="text-(--mp-ok) font-bold text-lg">✓</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-(--mp-line) flex justify-between items-center">
                <span className="font-semibold text-(--mp-ink)">Total Value:</span>
                <span className="font-(family-name:--mp-font-mono) text-2xl font-semibold text-(--mp-ink)">${originalPrice.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-8 px-6 bg-(--mp-surface) border-b border-(--mp-line)">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-wrap justify-center gap-8 text-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl">∞</span>
              <span className="text-(--mp-body) font-medium">{accessBadgeLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl text-(--mp-ink)">↩</span>
              <span className="text-(--mp-body) font-medium">30-Day Refund</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔒</span>
              <span className="text-(--mp-body) font-medium">Secure Checkout</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚡</span>
              <span className="text-(--mp-body) font-medium">Instant Access</span>
            </div>
          </div>
        </div>
      </section>

      {/* Best For Section */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold mb-8 text-(--mp-ink)">Perfect For You If...</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bestFor.map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-left bg-(--mp-surface) border border-(--mp-line) p-4">
                <span className="text-xl text-(--mp-navy)">✓</span>
                <span className="text-(--mp-body)">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Included Products Detail */}
      <section className="py-16 px-6 bg-(--mp-wash) border-y border-(--mp-line)">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold text-(--mp-ink) mb-4">Everything Included in Your Bundle</h2>
            <p className="text-xl text-(--mp-body)">
              {includedProductsSubtitle || `Get lifetime access to all ${includedProducts.length} premium products`}
            </p>
          </div>

          <div className="space-y-8">
            {includedProducts.map((product, i) => (
              <div key={i} className="bg-(--mp-surface) border border-(--mp-line) overflow-hidden">
                <div className="p-8">
                  <div className="flex flex-col md:flex-row md:items-start gap-6">
                    {/* Product Icon */}
                    <div
                      className="w-20 h-20 flex items-center justify-center text-4xl shrink-0 bg-(--mp-wash) border border-(--mp-hair)"
                    >
                      {product.icon}
                    </div>

                    {/* Product Info */}
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-(family-name:--mp-font-serif) text-2xl font-bold text-(--mp-ink)">{product.name}</h3>
                          <p className="text-(--mp-muted)">${product.price} value - Included FREE</p>
                        </div>
                        <span
                          className="px-3 py-1 rounded-[6px] text-xs font-bold tracking-wide border border-(--mp-line) bg-(--mp-wash) text-(--mp-ink)"
                        >
                          INCLUDED
                        </span>
                      </div>
                      <p className="text-(--mp-body) mb-4">{product.description}</p>

                      {/* Features Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                        {product.features.map((feature, j) => (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <span className="text-(--mp-ok) font-bold">✓</span>
                            <span className="text-(--mp-body)">{feature}</span>
                          </div>
                        ))}
                      </div>

                      <Link
                        href={product.link}
                        className="text-sm font-semibold text-(--mp-navy) hover:underline"
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
              <span className="inline-block text-(--mp-accent) text-xs font-bold tracking-[0.18em] uppercase mb-4">
                BONUS
              </span>
              <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold text-(--mp-ink)">Plus These Bonuses</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {bonuses.map((bonus, i) => (
                <div key={i} className="flex items-center gap-4 bg-(--mp-surface) border border-(--mp-line) p-4">
                  <span className="text-2xl">🎁</span>
                  <span className="text-(--mp-ink) font-medium">{bonus}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Highlight Box */}
      {highlightTitle && highlightText && (
        <section className="py-16 px-6 bg-(--mp-wash) border-y border-(--mp-line)">
          <div className="max-w-4xl mx-auto">
            <div
              className="p-8 bg-(--mp-surface) border border-(--mp-line) border-t-2 border-t-(--mp-ink)"
            >
              <h3 className="font-(family-name:--mp-font-serif) text-2xl font-bold mb-4 text-(--mp-ink)">{highlightTitle}</h3>
              <p className="text-lg text-(--mp-body) leading-relaxed">{highlightText}</p>
            </div>
          </div>
        </section>
      )}

      {/* Savings Breakdown */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold text-(--mp-ink) mb-4">Your Savings Breakdown</h2>
          </div>
          <div className="bg-(--mp-surface) border border-(--mp-line) overflow-hidden">
            <div className="p-6">
              {includedProducts.map((product, i) => (
                <div key={i} className="flex justify-between items-center py-3 border-b border-(--mp-hair) last:border-b-0">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{product.icon}</span>
                    <span className="font-medium text-(--mp-ink)">{product.name}</span>
                  </div>
                  <span className="font-(family-name:--mp-font-mono) text-(--mp-body)">${product.price}</span>
                </div>
              ))}
            </div>
            <div className="bg-(--mp-wash) p-6">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-(--mp-body)">Total if purchased separately:</span>
                <span className="font-(family-name:--mp-font-mono) text-xl line-through text-(--mp-muted)">${originalPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-(--mp-ink)">Your bundle price:</span>
                <span className="font-(family-name:--mp-font-mono) text-2xl font-semibold text-(--mp-navy)">${price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-(--mp-line)">
                <span className="font-bold text-(--mp-ok) text-lg">You Save:</span>
                <span className="font-(family-name:--mp-font-mono) text-2xl font-semibold text-(--mp-ok)">${savings.toLocaleString()} ({savingsPercent}% off)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews */}
      <section className="py-16 px-6 bg-(--mp-wash) border-y border-(--mp-line)">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold text-(--mp-ink) mb-4">What Our Customers Say</h2>
            <div className="flex items-center justify-center gap-2">
              <span className="text-(--mp-ink) text-2xl">★★★★★</span>
              <span className="text-(--mp-body)">{reviews.length} reviews</span>
            </div>
          </div>
          <div className="space-y-4">
            {reviews.map((review, i) => (
              <div key={i} className="bg-(--mp-surface) border border-(--mp-line) p-6">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-(--mp-ink)">{review.name}</div>
                    <div className="text-(--mp-muted) text-sm">{review.date}</div>
                  </div>
                  <div className="text-(--mp-ink)">{'★'.repeat(review.rating)}</div>
                </div>
                <p className="text-(--mp-body)">{review.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        className="py-20 px-6 text-center bg-(--mp-paper) border-t border-(--mp-line)"
      >
        <div className="max-w-3xl mx-auto">
          <h2 className="font-(family-name:--mp-font-serif) text-4xl font-bold mb-4 text-(--mp-ink)">Ready to Dominate GovCon?</h2>
          <p className="text-xl text-(--mp-body) mb-8">
            Get all {includedProducts.length} products for just ${price.toLocaleString()} (save ${savings.toLocaleString()})
          </p>
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-10 py-5 bg-(--mp-navy) text-white font-semibold text-xl hover:bg-(--mp-navy-hover) transition-colors"
          >
            Get {title} Now - ${price.toLocaleString()}
          </a>
          <p className="mt-6 text-sm text-(--mp-muted)">
            {guaranteeText}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-(--mp-surface) border-t border-(--mp-line) py-12 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-(--mp-muted) text-sm">&copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
