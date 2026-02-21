'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Feature {
  icon: string;
  title: string;
  description: string;
}

interface Review {
  name: string;
  date: string;
  rating: number;
  text: string;
}

interface GlanceItem {
  label: string;
  value: string;
  link?: string;
}

interface ScreenshotFeature {
  image: string;
  title: string;
  description: string;
  bullets?: string[];
}

interface PricingTier {
  name: string;
  price: string;
  originalPrice: string;
  checkoutUrl: string;
  description: string;
  features: string[];
}

interface UpgradeProduct {
  title: string;
  description: string;
  price: string;
  originalPrice: string;
  checkoutUrl: string;
  linkUrl: string;
}

interface ProductPageProps {
  title: string;
  tagline: string;
  description: string;
  primaryColor: string;
  gradientFrom: string;
  gradientTo: string;
  price: string;
  originalPrice: string;
  checkoutUrl: string;
  tldr: string[];
  glanceItems: GlanceItem[];
  features: Feature[];
  benefits: string[];
  reviews: Review[];
  highlightTitle?: string;
  highlightText?: string;
  videoTitle?: string;
  videoSubtitle?: string;
  videoUrl?: string;
  mainImage?: string;
  screenshots?: string[];
  screenshotFeatures?: ScreenshotFeature[];
  thumbnails?: string[];
  categories?: { title: string; highlight?: boolean }[];
  categoriesTitle?: string;
  pricingTiers?: PricingTier[];
  upgradeProduct?: UpgradeProduct;
}

function isResourceUrl(url: string) {
  return url.startsWith('/resources/') || url.startsWith('/templates/');
}

export default function ProductPageAppSumo({
  title,
  tagline,
  description,
  primaryColor,
  gradientFrom,
  gradientTo,
  price,
  originalPrice,
  checkoutUrl,
  tldr,
  glanceItems,
  features,
  benefits,
  reviews,
  highlightTitle,
  highlightText,
  videoTitle,
  videoSubtitle,
  videoUrl,
  mainImage,
  screenshots = [],
  screenshotFeatures = [],
  thumbnails = ['Step 1', 'Step 2', 'Step 3', 'Step 4'],
  categories,
  categoriesTitle,
  pricingTiers,
  upgradeProduct,
}: ProductPageProps) {
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedTier, setSelectedTier] = useState(0);

  // Email gate state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [pendingDownloadUrl, setPendingDownloadUrl] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [hasAccess, setHasAccess] = useState(false);

  // Check for existing email on mount
  useEffect(() => {
    const cachedEmail = localStorage.getItem('lead_email');
    if (cachedEmail) {
      setEmail(cachedEmail);
      setHasAccess(true);
    }
  }, []);

  // Get current pricing (from tier if available, otherwise from props)
  const currentPrice = pricingTiers ? pricingTiers[selectedTier].price : price;
  const currentOriginalPrice = pricingTiers ? pricingTiers[selectedTier].originalPrice : originalPrice;
  const currentCheckoutUrl = pricingTiers ? pricingTiers[selectedTier].checkoutUrl : checkoutUrl;

  // Handle click on free resource buttons
  const handleFreeResourceClick = (resourceUrl: string) => {
    if (hasAccess) {
      // Already gave email — open resource directly
      window.open(resourceUrl, '_blank');
    } else {
      // Show email gate
      setPendingDownloadUrl(resourceUrl);
      setShowEmailModal(true);
      setError('');
    }
  };

  // Submit email and grant access
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      // Derive a resourceId from the URL for tracking
      const resourceId = pendingDownloadUrl
        ?.replace('/resources/', '')
        .replace('/templates/', '')
        .replace(/\.(html|csv|pdf)$/, '')
        .replace(/-/g, '-') || 'unknown';

      const response = await fetch('/api/capture-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim() || undefined,
          resourceId,
        }),
      });

      const data = await response.json();

      if (data.success || response.ok) {
        // Save email for future visits
        localStorage.setItem('lead_email', email.trim().toLowerCase());
        setHasAccess(true);
        setShowEmailModal(false);

        // Open the resource
        if (pendingDownloadUrl) {
          window.open(pendingDownloadUrl, '_blank');
        }
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      // Even if API fails, grant access (don't block the user)
      localStorage.setItem('lead_email', email.trim().toLowerCase());
      setHasAccess(true);
      setShowEmailModal(false);
      if (pendingDownloadUrl) {
        window.open(pendingDownloadUrl, '_blank');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex items-center justify-between h-16">
            <Link href="/" className="text-2xl font-bold text-blue-800">
              GovCon Giants
            </Link>
            <ul className="hidden md:flex items-center gap-8">
              <li><Link href="/#tools" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Tools</Link></li>
              <li><Link href="/#databases" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Databases</Link></li>
              <li><Link href="/free-resources" className="text-gray-800 hover:text-blue-800 font-medium text-sm">Free Resources</Link></li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Product Nav */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex gap-8 items-center">
          <a href="#overview" className="py-4 text-sm font-medium border-b-2 border-transparent hover:border-gray-300" style={{ borderColor: primaryColor, color: primaryColor }}>Overview</a>
          <a href="#features" className="py-4 text-gray-500 text-sm font-medium border-b-2 border-transparent hover:border-gray-300">Features</a>
          <a href="#pricing" className="py-4 text-gray-500 text-sm font-medium border-b-2 border-transparent hover:border-gray-300">Pricing</a>
          <a href="#reviews" className="py-4 text-gray-500 text-sm font-medium border-b-2 border-transparent hover:border-gray-300">Reviews</a>
          {isResourceUrl(checkoutUrl) ? (
            <button
              onClick={() => handleFreeResourceClick(checkoutUrl)}
              className="ml-auto px-6 py-2 bg-yellow-400 text-gray-900 rounded-lg font-bold text-sm hover:bg-yellow-300 transition-all"
            >
              Download Free
            </button>
          ) : checkoutUrl.startsWith('/') ? (
            <Link href={checkoutUrl} className="ml-auto px-6 py-2 bg-yellow-400 text-gray-900 rounded-lg font-bold text-sm hover:bg-yellow-300 transition-all">
              Get Access
            </Link>
          ) : (
            <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="ml-auto px-6 py-2 bg-yellow-400 text-gray-900 rounded-lg font-bold text-sm hover:bg-yellow-300 transition-all">
              Get Access
            </a>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-10">
        {/* Left Column */}
        <div id="overview">
          <div className="mb-6">
            <h1 className="text-4xl md:text-5xl font-extrabold mb-3 leading-tight text-gray-900">{title}</h1>
            <p className="text-xl text-gray-500">{tagline}</p>
          </div>

          {/* Video/Media Section */}
          <div className="mb-10">
            {/* Main Image/Video Display */}
            <div className="w-full rounded-xl aspect-video mb-4 relative overflow-hidden border-2 border-gray-200">
              {videoUrl && selectedImage === 0 ? (
                // YouTube embed
                <iframe
                  className="w-full h-full"
                  src={videoUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}
                  title={videoTitle || title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : mainImage || screenshots.length > 0 ? (
                // Display selected screenshot or main image
                <img
                  src={screenshots.length > 0 ? screenshots[selectedImage] : mainImage}
                  alt={`${title} screenshot ${selectedImage + 1}`}
                  className="w-full h-full object-contain bg-gray-100"
                />
              ) : (
                // Fallback gradient placeholder (no fake video button)
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
                >
                  <div className="text-center text-white p-10">
                    <h2 className="text-2xl font-bold mb-2">{videoTitle || title}</h2>
                    <p className="text-lg opacity-90">{videoSubtitle || tagline}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Thumbnail Gallery - Only show first 4 */}
            <div className="grid grid-cols-4 gap-3">
              {screenshots.length > 0 ? (
                screenshots.slice(0, 4).map((screenshot, i) => (
                  <div
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={`aspect-video rounded-lg overflow-hidden cursor-pointer transition-all border-2 ${
                      selectedImage === i ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <img
                      src={screenshot}
                      alt={`${title} thumbnail ${i + 1}`}
                      className="w-full h-full object-contain bg-gray-100"
                    />
                  </div>
                ))
              ) : (
                thumbnails.slice(0, 4).map((thumb, i) => (
                  <div key={i} className="aspect-video bg-gray-100 border-2 border-gray-200 rounded-lg flex items-center justify-center text-sm font-medium text-gray-500 cursor-pointer hover:border-gray-400 transition-all">
                    {thumb}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Description */}
          <div className="text-lg leading-relaxed mb-8 text-gray-700">
            <p>{description}</p>
          </div>

          {/* TL;DR */}
          <div className="bg-gray-50 rounded-lg p-6 mb-8" style={{ borderLeft: `4px solid ${primaryColor}` }}>
            <div className="text-xl font-bold mb-4 text-gray-900">TL;DR</div>
            <ul className="space-y-2">
              {tldr.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="font-bold text-xl" style={{ color: primaryColor }}>&#10003;</span>
                  <span className="text-gray-800">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* At-a-glance */}
          <div className="bg-gray-50 rounded-xl p-6 mb-8">
            <div className="text-lg font-bold mb-4 text-gray-900">At-a-glance</div>
            {glanceItems.map((item, i) => (
              <div key={i} className="flex justify-between py-3 border-b border-gray-200 last:border-b-0">
                <span className="font-semibold text-gray-500">{item.label}</span>
                <span className="text-gray-900">
                  {item.link ? (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ color: primaryColor }}>{item.value}</a>
                  ) : item.value}
                </span>
              </div>
            ))}
          </div>

          {/* Categories */}
          {categories && categoriesTitle && (
            <div className="bg-gray-50 rounded-xl p-6 mb-8">
              <h3 className="text-xl font-bold mb-4 text-gray-900">{categoriesTitle}</h3>
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat, i) => (
                  <div key={i} className="bg-white p-3 rounded-lg border border-gray-200 text-sm">
                    <span className={`${cat.highlight ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                      {cat.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Features Section */}
          <div className="my-16" id="features">
            <h2 className="text-3xl font-bold mb-8 text-gray-900">Key Features</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, i) => (
                <div key={i} className="p-6 bg-white border border-gray-200 rounded-xl">
                  <div className="text-3xl mb-3">{feature.icon}</div>
                  <div className="text-lg font-bold mb-2 text-gray-900">{feature.title}</div>
                  <div className="text-gray-500 leading-relaxed">{feature.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Alternating Screenshot Features */}
          {screenshotFeatures.length > 0 && (
            <div className="my-16 space-y-16">
              {screenshotFeatures.map((feature, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} gap-8 items-center`}
                >
                  {/* Image */}
                  <div className="w-full md:w-1/2">
                    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-lg">
                      {feature.image ? (
                        <img
                          src={feature.image}
                          alt={feature.title}
                          className="w-full h-auto"
                        />
                      ) : (
                        <div className="w-full h-64 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                          <span className="text-6xl">📄</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Text Content */}
                  <div className="w-full md:w-1/2">
                    <h3 className="text-2xl font-bold mb-4 text-gray-900">{feature.title}</h3>
                    <p className="text-gray-600 leading-relaxed mb-4">{feature.description}</p>
                    {feature.bullets && feature.bullets.length > 0 && (
                      <ul className="space-y-2">
                        {feature.bullets.map((bullet, j) => (
                          <li key={j} className="flex items-start gap-3">
                            <span className="text-green-500 font-bold mt-1">✓</span>
                            <span className="text-gray-700">{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Highlight Box */}
          {highlightTitle && highlightText && (
            <div className="bg-gradient-to-r from-yellow-50 to-amber-100 border-2 border-amber-400 rounded-xl p-6 mb-8">
              <h3 className="text-xl font-bold mb-3 text-amber-900">{highlightTitle}</h3>
              <p className="text-amber-800 leading-relaxed">{highlightText}</p>
            </div>
          )}

          {/* Reviews Section */}
          <div className="my-16" id="reviews">
            <h2 className="text-3xl font-bold mb-8 text-gray-900">What users are saying</h2>
            <div className="flex items-center gap-4 mb-8">
              <div className="text-2xl text-yellow-400">★★★★★</div>
              <div className="text-lg font-semibold text-gray-700">{reviews.length} reviews</div>
            </div>
            {reviews.map((review, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-6 mb-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-gray-900">{review.name}</div>
                    <div className="text-gray-500 text-sm">{review.date}</div>
                  </div>
                  <div className="text-yellow-400">{'*'.repeat(review.rating)}</div>
                </div>
                <p className="text-gray-700">{review.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column - Pricing Sidebar */}
        <div id="pricing" className="lg:sticky lg:top-24 h-fit">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
            {/* Product Header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold"
                style={{ background: `linear-gradient(135deg, ${gradientFrom} 0%, ${gradientTo} 100%)` }}
              >
                {title.charAt(0)}
              </div>
              <div>
                <h3 className="font-bold text-gray-900">{title}</h3>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-400 text-sm">★★★★★</span>
                  <span className="text-blue-600 text-sm font-medium">{reviews.length} reviews</span>
                </div>
              </div>
            </div>

            {/* Tagline */}
            <p className="text-gray-600 text-sm mb-6">{tagline}</p>

            {/* Tier Selector (if tiers available) */}
            {pricingTiers && pricingTiers.length > 1 && (
              <div className="mb-6">
                <div className="grid grid-cols-2 gap-2">
                  {pricingTiers.map((tier, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedTier(i)}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        selectedTier === i
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`font-bold text-sm ${selectedTier === i ? 'text-blue-600' : 'text-gray-700'}`}>{tier.name}</div>
                      <div className="text-lg font-extrabold" style={{ color: selectedTier === i ? '#2563eb' : '#111' }}>
                        {tier.price}
                      </div>
                    </button>
                  ))}
                </div>
                {pricingTiers[selectedTier].description && (
                  <p className="text-xs text-gray-500 mt-2">{pricingTiers[selectedTier].description}</p>
                )}
              </div>
            )}

            {/* Price Section */}
            <div className="mb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-green-600 font-bold text-lg">
                  {currentPrice === 'FREE' ? '' : `-${Math.round((1 - parseInt(currentPrice.replace(/\D/g, '')) / parseInt(currentOriginalPrice.replace(/\D/g, ''))) * 100)}%`}
                </span>
                <span className="text-4xl font-extrabold text-gray-900">{currentPrice}</span>
                <span className="text-gray-400 line-through text-lg">{currentOriginalPrice.replace(' value', '')}</span>
              </div>
            </div>

            {/* Buy Button */}
            {isResourceUrl(currentCheckoutUrl) ? (
              <button
                onClick={() => handleFreeResourceClick(currentCheckoutUrl)}
                className="block w-full text-center py-4 rounded-lg text-lg font-bold text-gray-900 mb-6 hover:opacity-90 transition-all bg-yellow-400 hover:bg-yellow-300"
              >
                {hasAccess ? 'Download Free' : 'Get Free Access'}
              </button>
            ) : currentCheckoutUrl.startsWith('/') ? (
              <Link
                href={currentCheckoutUrl}
                className="block w-full text-center py-4 rounded-lg text-lg font-bold text-gray-900 mb-6 hover:opacity-90 transition-all bg-yellow-400 hover:bg-yellow-300"
              >
                {currentPrice === 'FREE' ? 'Get Free Access' : 'Buy now'}
              </Link>
            ) : (
              <a
                href={currentCheckoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center py-4 rounded-lg text-lg font-bold text-gray-900 mb-6 hover:opacity-90 transition-all bg-yellow-400 hover:bg-yellow-300"
              >
                {currentPrice === 'FREE' ? 'Get Free Access' : 'Buy now'}
              </a>
            )}

            {/* Trust Badges */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-lg">∞</span>
                <span className="text-gray-700">Lifetime access</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-lg text-green-500">↩</span>
                <span className="text-gray-700">Refundable up to 30 days</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-lg text-pink-500">♥</span>
                <span className="text-gray-700">Money-back guarantee</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 pt-6">
              <h4 className="font-bold text-gray-900 mb-4">What&apos;s included:</h4>
              <ul className="space-y-3">
                {(pricingTiers ? pricingTiers[selectedTier].features : benefits.slice(0, 8)).map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="text-green-500 font-bold">✓</span>
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Upgrade Product Section */}
            {upgradeProduct && (
              <div className="border-t border-gray-200 pt-6 mt-6">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4">
                  <h4 className="font-bold text-blue-900 mb-2">Want More?</h4>
                  <p className="text-sm text-blue-800 mb-3">{upgradeProduct.description}</p>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-2xl font-extrabold text-blue-900">{upgradeProduct.price}</span>
                    <span className="text-gray-400 line-through text-sm">{upgradeProduct.originalPrice}</span>
                  </div>
                  <a
                    href={upgradeProduct.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-3 rounded-lg text-sm font-bold text-white mb-2 hover:opacity-90 transition-all bg-blue-600 hover:bg-blue-700"
                  >
                    Upgrade to {upgradeProduct.title}
                  </a>
                  <Link
                    href={upgradeProduct.linkUrl}
                    className="block w-full text-center py-2 text-sm font-medium text-blue-600 hover:text-blue-800 transition-all"
                  >
                    Learn more →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Email Gate Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Get Free Access</h3>
              <button
                onClick={() => setShowEmailModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-gray-600 mb-6">
              Enter your email to download <strong>{title}</strong> for free.
            </p>

            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Download Free'}
              </button>

              <p className="text-xs text-gray-500 text-center">
                By submitting, you agree to receive occasional emails from GovCon Giants.
                Unsubscribe anytime.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-6 mt-20">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-gray-500 text-sm">&copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
