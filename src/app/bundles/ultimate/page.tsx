import BundleProductPage from '@/components/BundleProductPage';

export default function UltimateBundlePage() {
  return (
    <BundleProductPage
      title="Ultimate GovCon Bundle"
      tagline="The complete arsenal for dominating federal contracting"
      description="Get EVERYTHING. Every premium tool, every database, every report—all at the highest tier. The Ultimate Bundle is for contractors who are serious about building a dominant GovCon business and want no limitations."
      primaryColor="#f59e0b"
      gradientFrom="#f59e0b"
      gradientTo="#ea580c"
      price={1497}
      originalPrice={1837}
      checkoutUrl="https://buy.stripe.com/aFacN6d700AGfRHfxmfnO0r"
      badge="BEST VALUE - EVERYTHING INCLUDED"
      includedProducts={[
        {
          name: 'AI Content Generator (Full Fix)',
          description: 'The premium tier of our content generator with enhanced AI capabilities, more content types, and advanced customization for creating content that converts.',
          price: 397,
          icon: '✍️',
          link: '/content-generator-product',
          features: [
            'Everything in standard, plus:',
            'Advanced AI model access',
            'Premium content templates',
            'Agency-specific messaging',
            'Proposal snippet generator',
            'Capability statement helper',
            'Priority processing',
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
          name: 'Market Assassin Premium',
          description: 'The full 8-report Market Assassin experience with unlimited generations, enhanced report depth, and all strategic intelligence reports unlocked.',
          price: 497,
          icon: '🎯',
          link: '/market-assassin',
          features: [
            'All 8 strategic reports',
            'Unlimited report generations',
            'Enhanced report depth',
            'Subcontracting Opportunities',
            'IDV Contracts Analysis',
            'Similar Awards Report',
            'Tribal Contracting Report',
            'Priority support',
          ],
        },
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
      ]}
      bestFor={[
        "You want EVERYTHING with no limitations or restrictions",
        "You're building a serious GovCon business and need the best tools",
        "You want all premium tiers, not standard versions",
        "You need comprehensive market intelligence (all 8 reports)",
        "You want to maximize your competitive advantage",
        "You understand that the right tools pay for themselves many times over",
      ]}
      bonuses={[
        'VIP priority support',
        'Early access to new features',
        'All future product updates included',
        'GovCon Giants VIP community access',
        'Quarterly strategy webinar access',
      ]}
      highlightTitle="For Contractors Who Refuse to Compromise"
      highlightText="The Ultimate Bundle includes every tool at its highest tier. You get Market Assassin Premium with all 8 reports and unlimited generations. You get the Full Fix Content Generator with advanced AI capabilities. You get every database, every tracker, every tool we offer. This is for contractors who understand that having the best intelligence and tools is the difference between winning and losing contracts worth hundreds of thousands—or millions—of dollars."
      reviews={[
        {
          name: 'Michael S.',
          date: '1 week ago',
          rating: 5,
          text: "I run a $5M GovCon firm and the Ultimate Bundle has become our secret weapon. The Market Assassin Premium reports give us intel that our competitors simply don't have. We've won 3 contracts since getting this bundle.",
        },
        {
          name: 'Jennifer T.',
          date: '2 weeks ago',
          rating: 5,
          text: "Worth every penny. I was hesitant at the price, but the first contract we won using these tools was worth $1.2M. The ROI is insane. The Full Fix content generator alone has transformed our LinkedIn presence.",
        },
        {
          name: 'Anthony R.',
          date: '3 weeks ago',
          rating: 5,
          text: "As an 8(a) firm, we need every advantage. The Ultimate Bundle gives us enterprise-level competitive intelligence at a fraction of what the big primes pay for similar data. Game changer.",
        },
        {
          name: 'Lisa M.',
          date: '1 month ago',
          rating: 5,
          text: "I bought the Pro bundle first, then upgraded to Ultimate within a week. The Premium Market Assassin reports and Full Fix content generator are on another level. Should have just gotten Ultimate from the start.",
        },
        {
          name: 'Carlos D.',
          date: '1 month ago',
          rating: 5,
          text: "Our BD team uses this daily. The combination of all tools working together is powerful. Find opportunities with Recompete Tracker, research with Market Assassin, find teammates with the Database, then promote with Content Generator. Complete workflow.",
        },
      ]}
    />
  );
}
