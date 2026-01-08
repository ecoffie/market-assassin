import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function PrimeLookupPage() {
  return (
    <ProductPageAppSumo
      title="Prime Lookup Tool"
      tagline="Research prime contractors by agency for teaming opportunities"
      description="Find out which prime contractors are winning at your target agencies. The Prime Lookup Tool shows you exactly who is getting awarded contracts, their subcontracting goals, small business utilization rates, and contact information for teaming outreach."
      primaryColor="#059669"
      gradientFrom="#059669"
      gradientTo="#10b981"
      price="$247"
      originalPrice="$347/month"
      checkoutUrl="https://govcongiants.lemonsqueezy.com/checkout/buy/prime-lookup"
      videoTitle="Prime Lookup Tool Demo"
      videoSubtitle="See how to identify prime teaming targets in minutes"
      thumbnails={['Select Agency', 'Find Primes', 'View Goals', 'Connect']}
      tldr={[
        'Agency-specific prime contractor lists',
        'Contract values and award history',
        'Subcontracting plan indicators',
        'Small business utilization rates',
        'Contact information for teaming',
      ]}
      glanceItems={[
        { label: 'Coverage', value: 'All federal agencies' },
        { label: 'Data Points', value: 'Awards, goals, contacts' },
        { label: 'Updates', value: 'Monthly refresh' },
        { label: 'Export', value: 'CSV download included' },
      ]}
      categoriesTitle="Research Primes at Any Agency"
      categories={[
        { title: 'Department of Defense', highlight: true },
        { title: 'Department of VA', highlight: true },
        { title: 'DHS & Components', highlight: true },
        { title: 'HHS & NIH', highlight: true },
        { title: 'NASA', highlight: true },
        { title: 'All Civilian Agencies', highlight: true },
      ]}
      features={[
        {
          icon: 'AGY',
          title: 'Agency-Specific Intelligence',
          description: 'Select any federal agency and see exactly which primes are winning contracts there. Focus your teaming efforts on the companies that matter.',
        },
        {
          icon: 'SUB',
          title: 'Subcontracting Goals',
          description: 'See each primes small business subcontracting plan goals and actual performance. Target primes who need your certifications to meet their goals.',
        },
        {
          icon: 'AWD',
          title: 'Award History & Values',
          description: 'View recent contract awards including values, types, and scopes. Understand what each prime is winning and where you fit.',
        },
        {
          icon: 'CON',
          title: 'Contact Information',
          description: 'Get the small business liaison officer and supplier diversity contacts for each prime. Reach the right person on your first try.',
        },
      ]}
      benefits={[
        'Lifetime access (one-time payment)',
        'All federal agencies covered',
        'Subcontracting goal data',
        'SBLO contact information',
        'CSV export included',
        'All future updates included',
      ]}
      highlightTitle="Target the Right Primes, Not Just Any Primes"
      highlightText="Not all primes are good teaming targets. Some have met their goals, some dont sub out work, and some only work with existing partners. Our data shows you which primes actually need small business subs and are actively looking."
      reviews={[
        {
          name: 'Anthony R.',
          date: '4 days ago',
          rating: 5,
          text: 'The subcontracting goal data is exactly what I needed. I can now prioritize primes who actually need my 8(a) certification.',
        },
        {
          name: 'Lisa W.',
          date: '1 week ago',
          rating: 5,
          text: 'Found the SBLO contacts for my target primes instantly. Set up 5 intro calls in my first week of using this tool.',
        },
        {
          name: 'Carlos M.',
          date: '3 weeks ago',
          rating: 5,
          text: 'The agency filtering is perfect. I focus on DoD and can see exactly which primes are winning there and who to approach.',
        },
      ]}
    />
  );
}
