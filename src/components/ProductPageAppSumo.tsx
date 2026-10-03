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

interface VideoItem {
  url: string;
  title: string;
  thumbnail?: string;
}

interface ProductPageProps {
  title: string;
  tagline: string;
  description: string;
  /**
   * Retired per-product colours. Public pages render on the Mindy public system
   * (src/lib/public-site), so the component no longer reads them; kept optional so an older
   * caller still type-checks.
   */
  primaryColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
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
  videos?: VideoItem[];
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
  videos = [],
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
    <div className="bg-(--mp-paper) text-(--mp-ink)">
      {/* Header */}
      <header className="bg-(--mp-surface) border-b border-(--mp-line)">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex items-center justify-between h-14">
            <Link href="/" className="font-(family-name:--mp-font-serif) text-xl font-bold text-(--mp-ink) hover:text-(--mp-navy)">
              GovCon Giants
            </Link>
            <ul className="hidden md:flex items-center gap-8">
              <li><Link href="/#tools" className="text-(--mp-body) hover:text-(--mp-navy) font-medium text-sm">Tools</Link></li>
              <li><Link href="/#databases" className="text-(--mp-body) hover:text-(--mp-navy) font-medium text-sm">Databases</Link></li>
              <li><Link href="/free-resources" className="text-(--mp-body) hover:text-(--mp-navy) font-medium text-sm">Free Resources</Link></li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Product Nav */}
      <div className="border-b border-(--mp-line) bg-(--mp-surface)">
        <div className="max-w-7xl mx-auto px-6 flex gap-8 items-center">
          <a href="#overview" className="py-4 text-sm font-semibold border-b-2 border-(--mp-navy) text-(--mp-navy)">Overview</a>
          <a href="#features" className="py-4 text-(--mp-muted) text-sm font-medium border-b-2 border-transparent hover:border-(--mp-line) hover:text-(--mp-ink)">Features</a>
          <a href="#pricing" className="py-4 text-(--mp-muted) text-sm font-medium border-b-2 border-transparent hover:border-(--mp-line) hover:text-(--mp-ink)">Pricing</a>
          <a href="#reviews" className="py-4 text-(--mp-muted) text-sm font-medium border-b-2 border-transparent hover:border-(--mp-line) hover:text-(--mp-ink)">Reviews</a>
          {isResourceUrl(checkoutUrl) ? (
            <button
              onClick={() => handleFreeResourceClick(checkoutUrl)}
              className="ml-auto px-6 py-2 bg-(--mp-navy) text-white rounded-none font-semibold text-sm hover:bg-(--mp-navy-hover) transition-colors"
            >
              Download Free
            </button>
          ) : checkoutUrl.startsWith('/') ? (
            <Link href={checkoutUrl} className="ml-auto px-6 py-2 bg-(--mp-navy) text-white rounded-none font-semibold text-sm hover:bg-(--mp-navy-hover) transition-colors">
              Get Access
            </Link>
          ) : (
            <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="ml-auto px-6 py-2 bg-(--mp-navy) text-white rounded-none font-semibold text-sm hover:bg-(--mp-navy-hover) transition-colors">
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
            <h1 className="font-(family-name:--mp-font-serif) text-4xl md:text-5xl font-bold mb-3 leading-tight tracking-[-0.01em] text-(--mp-ink)">{title}</h1>
            <p className="font-(family-name:--mp-font-serif) text-xl text-(--mp-body)">{tagline}</p>
          </div>

          {/* Video/Media Section */}
          <div className="mb-10">
            {/* Main Image/Video Display */}
            <div className="w-full rounded-none aspect-video mb-4 relative overflow-hidden border border-(--mp-line)">
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
                  className="w-full h-full object-contain bg-(--mp-wash)"
                />
              ) : (
                // Fallback placeholder (no fake video button)
                <div className="w-full h-full flex items-center justify-center bg-(--mp-wash)">
                  <div className="text-center text-(--mp-ink) p-10">
                    <h2 className="font-(family-name:--mp-font-serif) text-2xl font-bold mb-2">{videoTitle || title}</h2>
                    <p className="text-lg text-(--mp-body)">{videoSubtitle || tagline}</p>
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
                    className={`aspect-video rounded-none overflow-hidden cursor-pointer transition-colors border-2 ${
                      selectedImage === i ? 'border-(--mp-navy)' : 'border-(--mp-line) hover:border-(--mp-faint)'
                    }`}
                  >
                    <img
                      src={screenshot}
                      alt={`${title} thumbnail ${i + 1}`}
                      className="w-full h-full object-contain bg-(--mp-wash)"
                    />
                  </div>
                ))
              ) : (
                thumbnails.slice(0, 4).map((thumb, i) => (
                  <div key={i} className="aspect-video bg-(--mp-wash) border border-(--mp-line) rounded-none flex items-center justify-center text-sm font-medium text-(--mp-muted) cursor-pointer hover:border-(--mp-faint) transition-colors">
                    {thumb}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Additional Videos Section */}
          {videos.length > 0 && (
            <div className="mb-10">
              <h3 className="font-(family-name:--mp-font-serif) text-xl font-bold text-(--mp-ink) mb-4">Watch How It Works</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {videos.map((video, i) => (
                  <div key={i} className="rounded-none overflow-hidden border border-(--mp-line) hover:border-(--mp-faint) transition-colors">
                    <div className="aspect-video">
                      <iframe
                        className="w-full h-full"
                        src={video.url.includes('vimeo.com')
                          ? video.url.replace('vimeo.com/', 'player.vimeo.com/video/')
                          : video.url.replace('watch?v=', 'embed/').replace('youtu.be/', 'youtube.com/embed/')}
                        title={video.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                    <div className="p-3 bg-(--mp-wash)">
                      <p className="font-medium text-(--mp-ink) text-sm">{video.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="text-lg leading-relaxed mb-8 text-(--mp-body)">
            <p>{description}</p>
          </div>

          {/* TL;DR */}
          <div className="bg-(--mp-surface) border border-(--mp-line) border-l-4 border-l-(--mp-navy) rounded-none p-6 mb-8">
            <div className="font-(family-name:--mp-font-serif) text-xl font-bold mb-4 text-(--mp-ink)">TL;DR</div>
            <ul className="space-y-2">
              {tldr.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="font-bold text-xl text-(--mp-navy)">&#10003;</span>
                  <span className="text-(--mp-ink)">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* At-a-glance */}
          <div className="bg-(--mp-wash) rounded-none p-6 mb-8">
            <div className="font-(family-name:--mp-font-serif) text-lg font-bold mb-4 text-(--mp-ink)">At-a-glance</div>
            {glanceItems.map((item, i) => (
              <div key={i} className="flex justify-between py-3 border-b border-(--mp-line) last:border-b-0">
                <span className="font-semibold text-(--mp-muted)">{item.label}</span>
                <span className="text-(--mp-ink)">
                  {item.link ? (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-(--mp-navy) underline underline-offset-2">{item.value}</a>
                  ) : item.value}
                </span>
              </div>
            ))}
          </div>

          {/* Categories */}
          {categories && categoriesTitle && (
            <div className="bg-(--mp-wash) rounded-none p-6 mb-8">
              <h3 className="font-(family-name:--mp-font-serif) text-xl font-bold mb-4 text-(--mp-ink)">{categoriesTitle}</h3>
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat, i) => (
                  <div key={i} className="bg-(--mp-surface) p-3 rounded-none border border-(--mp-line) text-sm">
                    <span className={`${cat.highlight ? 'font-bold text-(--mp-ink)' : 'text-(--mp-body)'}`}>
                      {cat.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Features Section */}
          <div className="my-16" id="features">
            <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold mb-8 text-(--mp-ink)">Key Features</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, i) => (
                <div key={i} className="p-6 bg-(--mp-surface) border border-(--mp-line) rounded-none">
                  <div className="text-3xl mb-3">{feature.icon}</div>
                  <div className="text-lg font-bold mb-2 text-(--mp-ink)">{feature.title}</div>
                  <div className="text-(--mp-muted) leading-relaxed">{feature.description}</div>
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
                    <div className="rounded-none overflow-hidden border border-(--mp-line)">
                      {feature.image ? (
                        <img
                          src={feature.image}
                          alt={feature.title}
                          className="w-full h-auto"
                        />
                      ) : (
                        <div className="w-full h-64 bg-(--mp-wash) flex items-center justify-center">
                          <span className="text-6xl">📄</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Text Content */}
                  <div className="w-full md:w-1/2">
                    <h3 className="font-(family-name:--mp-font-serif) text-2xl font-bold mb-4 text-(--mp-ink)">{feature.title}</h3>
                    <p className="text-(--mp-body) leading-relaxed mb-4">{feature.description}</p>
                    {feature.bullets && feature.bullets.length > 0 && (
                      <ul className="space-y-2">
                        {feature.bullets.map((bullet, j) => (
                          <li key={j} className="flex items-start gap-3">
                            <span className="text-(--mp-navy) font-bold mt-1">✓</span>
                            <span className="text-(--mp-body)">{bullet}</span>
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
            <div className="bg-(--mp-wash) border-t-2 border-(--mp-ink) rounded-none p-6 mb-8">
              <h3 className="font-(family-name:--mp-font-serif) text-xl font-bold mb-3 text-(--mp-ink)">{highlightTitle}</h3>
              <p className="text-(--mp-body) leading-relaxed">{highlightText}</p>
            </div>
          )}

          {/* Reviews Section */}
          <div className="my-16" id="reviews">
            <h2 className="font-(family-name:--mp-font-serif) text-3xl font-bold mb-8 text-(--mp-ink)">What users are saying</h2>
            <div className="flex items-center gap-4 mb-8">
              <div className="text-2xl text-(--mp-accent)">★★★★★</div>
              <div className="text-lg font-semibold text-(--mp-body)">{reviews.length} reviews</div>
            </div>
            {reviews.map((review, i) => (
              <div key={i} className="bg-(--mp-surface) border border-(--mp-line) rounded-none p-6 mb-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-bold text-(--mp-ink)">{review.name}</div>
                    <div className="text-(--mp-muted) text-sm">{review.date}</div>
                  </div>
                  <div className="text-(--mp-accent)">{'*'.repeat(review.rating)}</div>
                </div>
                <p className="text-(--mp-body)">{review.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column - Pricing Sidebar */}
        <div id="pricing" className="lg:sticky lg:top-24 h-fit">
          <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none p-6">
            {/* Product Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-none flex items-center justify-center bg-(--mp-navy) text-white font-(family-name:--mp-font-serif) text-xl font-bold">
                {title.charAt(0)}
              </div>
              <div>
                <h3 className="font-(family-name:--mp-font-serif) font-bold text-(--mp-ink)">{title}</h3>
                <div className="flex items-center gap-1">
                  <span className="text-(--mp-accent) text-sm">★★★★★</span>
                  <span className="text-(--mp-navy) text-sm font-medium">{reviews.length} reviews</span>
                </div>
              </div>
            </div>

            {/* Tagline */}
            <p className="text-(--mp-body) text-sm mb-6">{tagline}</p>

            {/* Tier Selector (if tiers available) */}
            {pricingTiers && pricingTiers.length > 1 && (
              <div className="mb-6">
                <div className="grid grid-cols-2 gap-2">
                  {pricingTiers.map((tier, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedTier(i)}
                      className={`p-3 rounded-none border-2 text-left transition-colors ${
                        selectedTier === i
                          ? 'border-(--mp-navy) bg-(--mp-navy-wash)'
                          : 'border-(--mp-line) hover:border-(--mp-faint)'
                      }`}
                    >
                      <div className={`font-bold text-sm ${selectedTier === i ? 'text-(--mp-navy)' : 'text-(--mp-body)'}`}>{tier.name}</div>
                      <div className={`font-(family-name:--mp-font-mono) text-lg font-semibold ${selectedTier === i ? 'text-(--mp-navy)' : 'text-(--mp-ink)'}`}>
                        {tier.price}
                      </div>
                    </button>
                  ))}
                </div>
                {pricingTiers[selectedTier].description && (
                  <p className="text-xs text-(--mp-muted) mt-2">{pricingTiers[selectedTier].description}</p>
                )}
              </div>
            )}

            {/* Price Section */}
            <div className="mb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-(--mp-ok) font-bold text-lg">
                  {currentPrice === 'FREE' ? '' : `-${Math.round((1 - parseInt(currentPrice.replace(/\D/g, '')) / parseInt(currentOriginalPrice.replace(/\D/g, ''))) * 100)}%`}
                </span>
                <span className="font-(family-name:--mp-font-mono) text-4xl font-semibold tracking-[-0.03em] text-(--mp-ink)">{currentPrice}</span>
                <span className="text-(--mp-muted) line-through text-lg">{currentOriginalPrice.replace(' value', '')}</span>
              </div>
            </div>

            {/* Buy Button */}
            {isResourceUrl(currentCheckoutUrl) ? (
              <button
                onClick={() => handleFreeResourceClick(currentCheckoutUrl)}
                className="block w-full text-center py-4 rounded-none text-lg font-semibold text-white mb-6 transition-colors bg-(--mp-navy) hover:bg-(--mp-navy-hover)"
              >
                {hasAccess ? 'Download Free' : 'Get Free Access'}
              </button>
            ) : currentCheckoutUrl.startsWith('/') ? (
              <Link
                href={currentCheckoutUrl}
                className="block w-full text-center py-4 rounded-none text-lg font-semibold text-white mb-6 transition-colors bg-(--mp-navy) hover:bg-(--mp-navy-hover)"
              >
                {currentPrice === 'FREE' ? 'Get Free Access' : 'Buy now'}
              </Link>
            ) : (
              <a
                href={currentCheckoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center py-4 rounded-none text-lg font-semibold text-white mb-6 transition-colors bg-(--mp-navy) hover:bg-(--mp-navy-hover)"
              >
                {currentPrice === 'FREE' ? 'Get Free Access' : 'Buy now'}
              </a>
            )}

            {/* Trust Badges */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-lg">∞</span>
                <span className="text-(--mp-body)">Lifetime access</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-lg text-(--mp-navy)">↩</span>
                <span className="text-(--mp-body)">Refundable up to 30 days</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-lg text-(--mp-accent)">♥</span>
                <span className="text-(--mp-body)">Money-back guarantee</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-(--mp-line) pt-6">
              <h4 className="font-bold text-(--mp-ink) mb-4">What&apos;s included:</h4>
              <ul className="space-y-3">
                {(pricingTiers ? pricingTiers[selectedTier].features : benefits.slice(0, 8)).map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="text-(--mp-navy) font-bold">✓</span>
                    <span className="text-(--mp-body)">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Upgrade Product Section */}
            {upgradeProduct && (
              <div className="border-t border-(--mp-line) pt-6 mt-6">
                <div className="bg-(--mp-navy-wash) border border-(--mp-line) rounded-none p-4">
                  <h4 className="font-bold text-(--mp-ink) mb-2">Want More?</h4>
                  <p className="text-sm text-(--mp-body) mb-3">{upgradeProduct.description}</p>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="font-(family-name:--mp-font-mono) text-2xl font-semibold text-(--mp-ink)">{upgradeProduct.price}</span>
                    <span className="text-(--mp-muted) line-through text-sm">{upgradeProduct.originalPrice}</span>
                  </div>
                  <a
                    href={upgradeProduct.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full text-center py-3 rounded-none text-sm font-semibold text-white mb-2 transition-colors bg-(--mp-navy) hover:bg-(--mp-navy-hover)"
                  >
                    Upgrade to {upgradeProduct.title}
                  </a>
                  <Link
                    href={upgradeProduct.linkUrl}
                    className="block w-full text-center py-2 text-sm font-medium text-(--mp-navy) hover:text-(--mp-navy-hover) hover:underline transition-colors"
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
        <div className="fixed inset-0 bg-(--mp-ink)/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-(--mp-surface) border border-(--mp-line) rounded-none max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-(family-name:--mp-font-serif) text-lg font-bold text-(--mp-ink)">Get Free Access</h3>
              <button
                onClick={() => setShowEmailModal(false)}
                className="text-(--mp-muted) hover:text-(--mp-ink)"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-(--mp-body) mb-6">
              Enter your email to download <strong>{title}</strong> for free.
            </p>

            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-(--mp-ink) mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2 border border-(--mp-line) rounded-[8px] bg-(--mp-surface) placeholder:text-(--mp-subtle) focus:border-(--mp-navy) text-(--mp-ink)"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-(--mp-ink) mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-4 py-2 border border-(--mp-line) rounded-[8px] bg-(--mp-surface) placeholder:text-(--mp-subtle) focus:border-(--mp-navy) text-(--mp-ink)"
                />
              </div>

              {error && (
                <div className="bg-(--mp-warn-bg) border border-(--mp-warn-line) text-(--mp-warn) px-4 py-2 rounded-none text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-none transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Processing...' : 'Download Free'}
              </button>

              <p className="text-xs text-(--mp-muted) text-center">
                By submitting, you agree to receive occasional emails from GovCon Giants.
                Unsubscribe anytime.
              </p>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-(--mp-line) py-8 px-6 mt-20">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-(--mp-muted) text-sm">&copy; {new Date().getFullYear()} GovCon Giants. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
