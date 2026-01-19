import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function Tier2DirectoryPage() {
  return (
    <ProductPageAppSumo
      title="Tier-2 Supplier List"
      tagline="Access comprehensive Tier-2 supplier contacts with vendor registration portals"
      description="Tier-2 subcontracting is where many small businesses find their first federal contracts. This list gives you direct access to supplier contacts and registration portals, so you can get on prime contractors supplier lists faster. Stop searching for how to become a supplier - get direct links to register."
      primaryColor="#8b5cf6"
      gradientFrom="#8b5cf6"
      gradientTo="#a855f7"
      price="FREE"
      originalPrice="$697 value"
      checkoutUrl="/free-resources"
      pricingTiers={[
        {
          name: 'Free Sample',
          price: 'FREE',
          originalPrice: '$697 value',
          checkoutUrl: '/free-resources',
          description: '50+ prime contractor contacts & portal links',
          features: [
            '50+ prime contractors',
            'Vendor portal links',
            'Supplier contacts',
            'NAICS code organized',
            'Instant PDF download',
          ],
        },
        {
          name: 'Full Database',
          price: '$497',
          originalPrice: '$997 value',
          checkoutUrl: 'https://govcongiants.lemonsqueezy.com/checkout/buy/contractor-database',
          description: '3,500+ contractors vs 50+ in free list',
          features: [
            '3,500+ prime contractors',
            'Contract history & values',
            'NAICS code filtering',
            'Agency-specific searches',
            'Export to CSV',
            'Teaming partner search',
            'All future updates',
          ],
        },
      ]}
      upgradeProduct={{
        title: 'Full Contractor Database',
        description: 'Go from 50+ contacts to 3,500+ prime contractors with contract history, NAICS codes, and direct contact information.',
        price: '$497',
        originalPrice: '$997',
        checkoutUrl: 'https://govcongiants.lemonsqueezy.com/checkout/buy/contractor-database',
        linkUrl: '/contractor-database-product',
      }}
      videoTitle="Tier-2 Supplier List"
      videoSubtitle="Direct links to vendor registration portals"
      screenshots={[
        '/images/products/tier2-directory/tier 2 main.png',
        '/images/products/tier2-directory/tier 2 sample names.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/tier2-directory/tier 2 main.png',
          title: 'Complete Tier-2 List',
          description: 'Access supplier contacts and vendor registration portals at major prime contractors.',
          bullets: [
            '50+ prime contractors',
            'Vendor portal links',
            'Supplier contacts',
            'Registration guides',
          ],
        },
        {
          image: '/images/products/tier2-directory/tier 2 sample names.png',
          title: 'Prime Contractor Listings',
          description: 'See which prime contractors are actively looking for small business subcontractors in your industry.',
          bullets: [
            'Company names',
            'Industry focus areas',
            'Contact information',
            'Portal access links',
          ],
        },
      ]}
      tldr={[
        '50+ Tier-2 supplier contacts included',
        'Direct vendor registration portal links',
        'Organized by industry and NAICS codes',
        'Major prime contractor supplier programs',
        'Instant PDF download',
      ]}
      glanceItems={[
        { label: 'Contacts', value: '50+ prime contractors' },
        { label: 'Format', value: 'PDF List' },
        { label: 'Organization', value: 'By NAICS code' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Prime Contractors Included"
      categories={[
        { title: 'Mid-Size Defense Primes', highlight: true },
        { title: 'IT Services Contractors', highlight: true },
        { title: 'Engineering Firms', highlight: true },
        { title: 'Construction Primes', highlight: true },
        { title: 'Professional Services', highlight: true },
        { title: '50+ More Primes', highlight: true },
      ]}
      features={[
        {
          icon: '📋',
          title: '50+ Prime Contractor Contacts',
          description: 'Access supplier contacts at major prime contractors for Tier-2 opportunities.',
        },
        {
          icon: '🔗',
          title: 'Vendor Portal Links',
          description: 'One-click access to supplier registration portals. No more hunting through contractor websites.',
        },
        {
          icon: '🏷️',
          title: 'Industry Categories',
          description: 'Organized by NAICS codes and industry types so you can find primes in your space.',
        },
        {
          icon: '🔄',
          title: 'Regular Updates',
          description: 'Fresh data and new prime contractors added regularly to keep you ahead of the competition.',
        },
      ]}
      benefits={[
        'Instant PDF download',
        'Complete contact lists',
        'Vendor portal links',
        'NAICS code organized',
        'Major primes included',
        'Print-ready format',
      ]}
      highlightTitle="Your First Federal Contract Might Be Tier-2"
      highlightText="Many successful federal contractors started as Tier-2 subs. Prime contractors need small business subcontractors to meet their goals, and they have established supplier programs to find them. This directory shows you exactly where to register."
      reviews={[
        {
          name: 'Robert P.',
          date: '5 days ago',
          rating: 5,
          text: 'Found 30+ Tier-2 opportunities in my first week. The vendor portal links saved me hours of research.',
        },
        {
          name: 'Amanda H.',
          date: '2 weeks ago',
          rating: 5,
          text: 'This directory is exactly what I needed. Clean, organized, and the portal links actually work.',
        },
        {
          name: 'Steven K.',
          date: '3 weeks ago',
          rating: 5,
          text: 'Registered with 15 prime contractor supplier programs in one afternoon. Wish I found this sooner.',
        },
      ]}
    />
  );
}
