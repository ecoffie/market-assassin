// Product Configuration with Stripe Checkout URLs

export const PRODUCTS = {
  AI_CONTENT_GENERATOR: {
    id: 'ai-content-generator',
    name: 'AI Content Generator',
    tiers: {
      'content-engine': {
        price: 197,
        stripeUrl: 'https://buy.stripe.com/dRmcN64Au6Z4axn84UfnO0m',
      },
      'full-fix': {
        price: 397,
        stripeUrl: 'https://buy.stripe.com/aFa9AU4Au1EKaxn5WMfnO0n',
      },
    },
  },
  CONTENT_GENERATOR_FULL_FIX_UPGRADE: {
    id: 'content-full-fix-upgrade',
    name: 'Content Generator Full Fix Upgrade',
    price: 200,
    stripeUrl: 'https://buy.stripe.com/9B6cN62sm2IO7lb4SIfnO0o',
    upgradeFrom: 'content-engine',
    upgradeTo: 'full-fix',
  },
  CONTRACTOR_DATABASE: {
    id: 'contractor-database',
    name: 'Federal Contractor Database',
    price: 497,
    stripeUrl: 'https://buy.stripe.com/4gMaEY3wqcjo6h70CsfnO0g',
  },
  RECOMPETE_CONTRACTS: {
    id: 'recompete-contracts',
    name: 'Recompete Contracts Tracker',
    price: 397,
    stripeUrl: 'https://buy.stripe.com/7sYfZi9UOdnsaxnbh6fnO0k',
  },
  MARKET_ASSASSIN_STANDARD: {
    id: 'market-assassin-standard',
    name: 'Market Assassin Standard',
    price: 297,
    stripeUrl: 'https://buy.stripe.com/3cI3cw9UOdns34V84UfnO0j',
    reports: 4,
  },
  MARKET_ASSASSIN_PREMIUM: {
    id: 'market-assassin-premium',
    name: 'Market Assassin Premium',
    price: 497,
    stripeUrl: 'https://buy.stripe.com/5kQdRaeb497cfRHdpefnO0f',
    reports: 8,
  },
  MARKET_ASSASSIN_PREMIUM_UPGRADE: {
    id: 'market-assassin-premium-upgrade',
    name: 'Market Assassin Premium Upgrade',
    price: 200,
    stripeUrl: 'https://buy.stripe.com/5kQ8wQ9UObfk34V3OEfnO0p',
    upgradeFrom: 'market-assassin-standard',
    upgradeTo: 'market-assassin-premium',
  },
  OPPORTUNITY_HUNTER_PRO: {
    id: 'opportunity-hunter-pro',
    name: 'Opportunity Hunter Pro',
    price: 49,
    stripeUrl: 'https://buy.stripe.com/00wcN60ke97c5d384UfnO0i',
  },
  // Bundles
  GOVCON_STARTER_BUNDLE: {
    id: 'govcon-starter-bundle',
    name: 'GovCon Starter Bundle',
    price: 697,
    stripeUrl: 'https://buy.stripe.com/6oU9AUeb46Z46h70CsfnO0s',
    individualTotal: 943,
    includes: ['opportunity-hunter-pro', 'recompete-contracts', 'contractor-database'],
    includesDisplay: [
      { name: 'Opportunity Hunter Pro', price: 49 },
      { name: 'Recompete Contracts Tracker', price: 397 },
      { name: 'Federal Contractor Database', price: 497 },
    ],
  },
  PRO_GIANT_BUNDLE: {
    id: 'pro-giant-bundle',
    name: 'Pro Giant Bundle',
    price: 997,
    stripeUrl: 'https://buy.stripe.com/dRm7sMaYS0AG0WN5WMfnO0q',
    includes: ['contractor-database', 'recompete-contracts', 'market-assassin-standard', 'ai-content-generator'],
    includesDisplay: [
      { name: 'Federal Contractor Database', price: 497 },
      { name: 'Recompete Contracts Tracker', price: 397 },
      { name: 'Market Assassin Standard', price: 297 },
      { name: 'AI Content Generator', price: 197 },
    ],
  },
  ULTIMATE_GOVCON_BUNDLE: {
    id: 'ultimate-govcon-bundle',
    name: 'Ultimate GovCon Bundle',
    price: 1497,
    stripeUrl: 'https://buy.stripe.com/aFacN6d700AGfRHfxmfnO0r',
    includes: ['ai-content-generator', 'contractor-database', 'recompete-contracts', 'market-assassin-premium'],
    includesDisplay: [
      { name: 'AI Content Generator (Full Fix)', price: 397 },
      { name: 'Federal Contractor Database', price: 497 },
      { name: 'Recompete Contracts Tracker', price: 397 },
      { name: 'Market Assassin Premium', price: 497 },
    ],
  },
} as const;

// Helper function to get product by ID
export function getProductById(productId: string) {
  for (const [, product] of Object.entries(PRODUCTS)) {
    if (product.id === productId) {
      return product;
    }
  }
  return null;
}

// Helper function to check if a product is a bundle
export function isBundle(productId: string): boolean {
  const product = getProductById(productId);
  return product !== null && 'includes' in product;
}

// Helper function to get all products included in a bundle
export function getBundleIncludes(productId: string): string[] {
  const product = getProductById(productId);
  if (product && 'includes' in product) {
    return [...product.includes];
  }
  return [];
}
