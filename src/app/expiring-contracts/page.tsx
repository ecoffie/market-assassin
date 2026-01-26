import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function ExpiringContractsPage() {
  return (
    <ProductPageAppSumo
      title="Expiring Contracts Forecast"
      tagline="Track $77.1T+ in expiring federal contracts and get ahead of recompete opportunities"
      description="When contracts expire, they get recompeted—and thats your window of opportunity. The Expiring Contracts Forecast shows you exactly which contracts are ending, when primes are building their teams, and where to focus your BD efforts. Stop chasing dead ends and start targeting real opportunities."
      primaryColor="#0891b2"
      gradientFrom="#0891b2"
      gradientTo="#06b6d4"
      price="$397"
      originalPrice="$997/month"
      checkoutUrl="/recompete"
      videoTitle="Expiring Contracts Forecast Demo"
      videoSubtitle="See how to find recompete opportunities 3-6 months early"
      screenshots={[
        '/images/products/expiring-contracts/home page expiring contracts.png',
        '/images/products/expiring-contracts/filter contacts.png',
        '/images/products/expiring-contracts/construction filter.png',
        '/images/products/expiring-contracts/billion dollar filter.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/expiring-contracts/10M to 100M.png',
          title: 'Filter by Contract Value',
          description: 'Target contracts in your sweet spot. Filter by value range to find opportunities that match your capabilities.',
          bullets: [
            'Filter $10M to $100M contracts',
            'Target mid-size recompetes',
            'Find subcontracting opportunities',
            'Match your past performance',
          ],
        },
        {
          image: '/images/products/expiring-contracts/1M category.png',
          title: 'Search by Category',
          description: 'Find contracts in your industry. Filter by NAICS code, PSC, or service category.',
          bullets: [
            'Filter by NAICS code',
            'Search by PSC category',
            'Target your industry',
            'See contract history',
          ],
        },
        {
          image: '/images/products/expiring-contracts/500k.png',
          title: 'Small Business Opportunities',
          description: 'Find smaller contracts perfect for small business set-asides and direct awards.',
          bullets: [
            'Contracts under $500K',
            'Set-aside opportunities',
            'Direct award potential',
            'Small business friendly',
          ],
        },
      ]}
      tldr={[
        'Access $77.1T+ in expiring contract data with monthly updates',
        'Get prime contractor details before they start building teams',
        'Filter by NAICS code, agency, and contract value',
        'Identify recompete opportunities 3-6 months in advance',
        'Export to CSV for your CRM',
      ]}
      glanceItems={[
        { label: 'Contract Value', value: '$77.1T+ tracked' },
        { label: 'Updates', value: 'Monthly refresh' },
        { label: 'Best for', value: 'BD professionals, Small businesses' },
        { label: 'Export', value: 'CSV download included' },
      ]}
      categoriesTitle="Filter By Agency"
      categories={[
        { title: 'Department of Defense', highlight: true },
        { title: 'Department of VA', highlight: true },
        { title: 'Civilian Agencies', highlight: true },
        { title: 'GSA Schedules', highlight: true },
        { title: 'IDIQs & BPAs', highlight: true },
        { title: 'All Federal Agencies', highlight: true },
      ]}
      features={[
        {
          icon: '⏰',
          title: 'Get There First',
          description: 'Contact primes 3-6 months before they start building their recompete teams.',
        },
        {
          icon: '💰',
          title: '$77.1T+ Tracked',
          description: 'Monitor trillions in contract value across all agencies.',
        },
        {
          icon: '📋',
          title: 'Detailed Intel',
          description: 'Get prime contractor names, contract values, agencies, NAICS codes, and expiration dates.',
        },
        {
          icon: '🔄',
          title: 'Monthly Updates',
          description: 'Fresh data every month so you always know whats expiring and when to reach out.',
        },
      ]}
      benefits={[
        'Lifetime access to database',
        '$77.1T+ contract data',
        'Historical data included',
        'NAICS code filtering',
        'Export to CSV',
        'Prime contractor details',
        'All future updates',
      ]}
      highlightTitle="Recompetes Are the Easiest Path to Federal Contracts"
      highlightText="New contracts are competitive. But recompetes? The government already knows they need the service. The prime already proved it works. Your job is simply to be on the team when they rebid. This database tells you exactly when that window opens."
      reviews={[
        {
          name: 'David K.',
          date: '3 days ago',
          rating: 5,
          text: 'Won my first subcontract by using this forecast. Found a contract expiring in 4 months, reached out to the prime early, and got on their team. This tool pays for itself.',
        },
        {
          name: 'Lisa T.',
          date: '1 week ago',
          rating: 5,
          text: 'The monthly updates are gold. I plan my BD pipeline around whats expiring. Game changer for my business development strategy.',
        },
        {
          name: 'Marcus R.',
          date: '2 weeks ago',
          rating: 5,
          text: 'The NAICS filtering saved me hours. I only see contracts relevant to my business. Worth every penny.',
        },
      ]}
    />
  );
}
