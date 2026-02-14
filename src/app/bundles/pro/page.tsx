import BundleProductPage from '@/components/BundleProductPage';

export default function ProBundlePage() {
  return (
    <BundleProductPage
      title="Pro Giant Bundle"
      tagline="The complete toolkit for serious government contractors"
      description="Ready to take your GovCon business to the next level? The Pro Giant Bundle combines powerful market intelligence with content creation tools to help you find, analyze, and win more contracts."
      primaryColor="#1e40af"
      gradientFrom="#1e40af"
      gradientTo="#7c3aed"
      price={997}
      originalPrice={1388}
      checkoutUrl="https://buy.stripe.com/dRm7sMaYS0AG0WN5WMfnO0q"
      badge="MOST POPULAR"
      includedProducts={[
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
          name: 'Market Assassin Standard',
          description: 'Enter 5 inputs, select target agencies, and get 4 comprehensive strategic reports instantly. The ultimate GovCon market intelligence system.',
          price: 297,
          icon: '🎯',
          link: '/market-assassin',
          features: [
            '4 strategic reports',
            'Pain Points & Priorities',
            'Government Buyers Report',
            'Agency Spend Analysis',
            'OSBP Contacts Directory',
            'Export to HTML/PDF',
          ],
        },
        {
          name: 'Content Reaper',
          description: 'Create LinkedIn posts that resonate with government buyers. GovCon-tuned AI trained on 146 viral posts to help you build your brand.',
          price: 197,
          icon: '✍️',
          link: '/content-reaper',
          features: [
            'Generate 10 posts per click',
            '175 federal agencies',
            'GovCon-tuned AI model',
            'GEO Boost optimization',
            'Multiple content styles',
            'Unlimited generations',
          ],
        },
      ]}
      bestFor={[
        "You're actively pursuing federal contracts and need comprehensive intel",
        "You want to build your brand and visibility with government buyers",
        "You need detailed market analysis before targeting agencies",
        "You want both research tools AND content creation in one package",
        "You're ready to invest in tools that will pay for themselves",
        "You want the best value for a serious GovCon toolkit",
      ]}
      bonuses={[
        'Priority email support',
        'Access to future product updates',
        'GovCon Giants community access',
      ]}
      highlightTitle="Why Pro Contractors Choose This Bundle"
      highlightText="The Pro Giant Bundle is our most popular package because it gives you everything you need to compete at a higher level. Use Market Assassin to understand your target agencies, the Contractor Database to find teaming partners, Recompete Tracker to identify opportunities early, and Content Reaper to build your brand. This is the complete GovCon toolkit."
      reviews={[
        {
          name: 'David M.',
          date: '1 week ago',
          rating: 5,
          text: "I was spending $500/month on various GovCon tools. This bundle replaced all of them with a one-time payment. The Market Assassin reports alone saved me weeks of research on my latest 8(a) pursuit.",
        },
        {
          name: 'Patricia L.',
          date: '2 weeks ago',
          rating: 5,
          text: "The combination of market intelligence and content creation is genius. I use Market Assassin to research agencies, then use the Content Generator to create targeted LinkedIn posts. My engagement is up 300%.",
        },
        {
          name: 'Robert K.',
          date: '3 weeks ago',
          rating: 5,
          text: "Best investment I've made in my GovCon business. Found a recompete opportunity, researched the agency with Market Assassin, connected with the incumbent through the database, and now we're teaming on the bid.",
        },
        {
          name: 'Angela W.',
          date: '1 month ago',
          rating: 5,
          text: "As a small business owner, I can't afford separate subscriptions for every tool. The Pro Bundle gives me enterprise-level capabilities at a price I can actually afford. Worth every penny.",
        },
      ]}
    />
  );
}
