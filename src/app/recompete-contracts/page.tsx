import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function RecompeteContractsPage() {
  return (
    <ProductPageAppSumo
      title="Recompete Contracts Database"
      tagline="Find expiring contracts before they hit the market"
      description="Get ahead of your competition by identifying recompete opportunities 12-18 months before they are solicited. Our database tracks expiring federal contracts, showing you incumbent contractors, contract values, and agency contacts so you can position yourself early."
      primaryColor="#0891b2"
      gradientFrom="#0891b2"
      gradientTo="#06b6d4"
      price="$397"
      originalPrice="$497/month"
      checkoutUrl="https://govcongiants.lemonsqueezy.com/checkout/buy/recompete-contracts"
      videoTitle="Recompete Contracts Demo"
      videoSubtitle="See how to find expiring contracts in your NAICS"
      thumbnails={['Search', 'Analyze', 'Target', 'Win']}
      tldr={[
        'Contracts expiring within 12-18 months',
        'Incumbent contractor information',
        'Historical contract values',
        'Agency and contracting office details',
        'NAICS and set-aside filtering',
      ]}
      glanceItems={[
        { label: 'Time Horizon', value: '12-18 months out' },
        { label: 'Data Included', value: 'Incumbent, value, agency' },
        { label: 'Updates', value: 'Weekly refresh' },
        { label: 'Export', value: 'CSV download included' },
      ]}
      categoriesTitle="Track Contracts Across All Agencies"
      categories={[
        { title: 'Department of Defense', highlight: true },
        { title: 'Civilian Agencies', highlight: true },
        { title: 'Intelligence Community', highlight: true },
        { title: 'VA Health System', highlight: true },
        { title: 'GSA Schedules', highlight: true },
        { title: 'IDIQ/BPAs', highlight: true },
      ]}
      features={[
        {
          icon: 'CAL',
          title: '12-18 Month Advance Notice',
          description: 'See contracts expiring well before they are recompeted. Gives you time to build relationships, develop capture strategies, and position for the win.',
        },
        {
          icon: 'INC',
          title: 'Incumbent Intelligence',
          description: 'Know who currently holds the contract, their performance history, and whether they are likely to bid again. Identify vulnerable incumbents.',
        },
        {
          icon: 'VAL',
          title: 'Historical Contract Values',
          description: 'See the full contract history including base values, options exercised, and modifications. Know exactly what the government has been paying.',
        },
        {
          icon: 'AGY',
          title: 'Agency Contact Details',
          description: 'Get the contracting office, program office, and key contacts so you can start your capture early with the right people.',
        },
      ]}
      benefits={[
        'Lifetime access (one-time payment)',
        'Weekly data updates',
        '12-18 month advance visibility',
        'Incumbent contractor details',
        'CSV export included',
        'All future updates included',
      ]}
      highlightTitle="Win More Contracts By Starting Earlier"
      highlightText="The contractors who win recompetes arent the ones who see the RFP first - theyre the ones who started building relationships 12 months earlier. This database gives you that head start."
      reviews={[
        {
          name: 'Patricia H.',
          date: '1 week ago',
          rating: 5,
          text: 'Identified a $15M recompete in my NAICS that I never would have found otherwise. Already had two meetings with the program office.',
        },
        {
          name: 'Steven C.',
          date: '2 weeks ago',
          rating: 5,
          text: 'The incumbent data is incredibly valuable. I can see which contracts have weak incumbents and focus my capture efforts there.',
        },
        {
          name: 'Michelle T.',
          date: '1 month ago',
          rating: 5,
          text: 'We built our entire BD pipeline from this database. Worth every penny - already won one contract we found here.',
        },
      ]}
    />
  );
}
