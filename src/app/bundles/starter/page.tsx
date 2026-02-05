import BundleProductPage from '@/components/BundleProductPage';

export default function StarterBundlePage() {
  return (
    <BundleProductPage
      title="GovCon Starter Bundle"
      tagline="Everything you need to start winning federal contracts"
      description="The perfect foundation for new government contractors. Get the essential tools to find opportunities, track expiring contracts, and connect with prime contractors—all at one unbeatable price."
      primaryColor="#10b981"
      gradientFrom="#10b981"
      gradientTo="#14b8a6"
      price={697}
      originalPrice={943}
      checkoutUrl="https://buy.stripe.com/6oU9AUeb46Z46h70CsfnO0s"
      badge="BEST FOR BEGINNERS"
      includedProducts={[
        {
          name: 'Opportunity Hunter Pro',
          description: 'Find out which government buyers buy what you sell. Identify your ideal federal customers in minutes with detailed agency spending analysis.',
          price: 49,
          icon: '🔍',
          link: '/opportunity-hunter',
          features: [
            'Agency spending analysis',
            'Prime contractor matching',
            'NAICS-based targeting',
            'Historical spend data',
            'Unlimited searches',
            'Export results',
          ],
        },
        {
          name: 'Recompete Contracts Tracker',
          description: 'Track expiring federal contracts before they hit the market. Get ahead of the competition by knowing exactly when contracts are up for recompete.',
          price: 397,
          icon: '📅',
          link: '/expiring-contracts',
          features: [
            'Contracts expiring in 12 months',
            'Prime contractor details',
            'NAICS code filtering',
            'Historical performance data',
            'Agency breakdown',
            'Export to CSV',
          ],
        },
        {
          name: 'Federal Contractor Database',
          description: 'Interactive searchable database of 3,500+ federal contractors with SBLO contact info, vendor portals, and teaming partner finder.',
          price: 497,
          icon: '📊',
          link: '/contractor-database-product',
          features: [
            '3,500+ federal contractors',
            'SBLO contact information',
            'Teaming partner finder',
            'Vendor portal links',
            'Advanced filtering',
            'Export capabilities',
          ],
        },
      ]}
      bestFor={[
        "You're new to government contracting and need the essentials",
        "You want to find opportunities without spending weeks on research",
        "You need to identify which agencies buy what you sell",
        "You want to track expiring contracts for recompete opportunities",
        "You're looking for prime contractors to team with",
        "You want lifetime access without monthly subscriptions",
      ]}
      highlightTitle="Start Your GovCon Journey Right"
      highlightText="Most new contractors waste months trying to figure out where to start. The Starter Bundle gives you immediate access to the three most essential tools: find your buyers (Opportunity Hunter), track upcoming opportunities (Recompete Tracker), and connect with primes (Contractor Database). This is the foundation every successful GovCon business needs."
      reviews={[
        {
          name: 'Michelle R.',
          date: '2 weeks ago',
          rating: 5,
          text: "As a brand new contractor, I was overwhelmed. The Starter Bundle gave me exactly what I needed without the overwhelm. Found my first subcontracting opportunity within 3 weeks!",
        },
        {
          name: 'James T.',
          date: '1 month ago',
          rating: 5,
          text: "The value here is incredible. I was about to pay $200/month for a competitor's tool that does half of what's included in this bundle. One-time payment for lifetime access? No brainer.",
        },
        {
          name: 'Sandra K.',
          date: '3 weeks ago',
          rating: 5,
          text: "The Contractor Database alone is worth more than the bundle price. I've connected with 4 prime contractors and am now in discussions for a teaming agreement.",
        },
      ]}
    />
  );
}
