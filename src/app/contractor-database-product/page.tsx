import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function ContractorDatabasePage() {
  return (
    <ProductPageAppSumo
      title="Federal Contractor Database"
      tagline="Search 3,500+ federal contractors for teaming opportunities"
      description="Stop wasting hours searching for teaming partners. The Federal Contractor Database gives you instant access to over 3,500 verified federal prime contractors, complete with contact information, contract history, SBLO contacts, and supplier portal links. Find the perfect teaming partner in minutes, not days."
      primaryColor="#4f46e5"
      gradientFrom="#4f46e5"
      gradientTo="#7c3aed"
      price="$497"
      originalPrice="$297/month"
      checkoutUrl="https://govcongiants.lemonsqueezy.com/checkout/buy/contractor-database"
      videoTitle="Federal Contractor Database Demo"
      videoSubtitle="See how to find teaming partners in under 2 minutes"
      screenshots={[
        '/images/products/contractor-database/main home page.png',
        '/images/products/contractor-database/total contacts.png',
        '/images/products/contractor-database/contacts with email.png',
        '/images/products/contractor-database/search criteria.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/contractor-database/construction naics code.png',
          title: 'Filter by NAICS Code',
          description: 'Narrow down your search to contractors in your specific industry. Find companies that match your exact service offerings.',
          bullets: [
            'Search by primary NAICS code',
            'Filter by multiple industries',
            'See contract values by category',
            'Identify top performers',
          ],
        },
        {
          image: '/images/products/contractor-database/10m to 100m firms.png',
          title: 'Target by Company Size',
          description: 'Find primes that match your teaming strategy. Filter by annual revenue to identify companies in your sweet spot.',
          bullets: [
            'Filter by revenue range',
            'Find mid-size primes needing subs',
            'Target growing companies',
            'Identify subcontracting opportunities',
          ],
        },
        {
          image: '/images/products/contractor-database/sample contacts.png',
          title: 'Direct Contact Information',
          description: 'Get the contact details you need to reach out directly. No more hunting for email addresses or phone numbers.',
          bullets: [
            'SBLO email addresses included',
            'Phone numbers when available',
            'Supplier portal links',
            'Company websites',
          ],
        },
      ]}
      tldr={[
        '3,500+ verified federal prime contractors',
        '800+ SBLO contacts with emails',
        '115+ supplier portal links',
        '$430B+ in contract data',
        'Export to CSV for your CRM',
      ]}
      glanceItems={[
        { label: 'Contractors', value: '3,500+ primes' },
        { label: 'SBLO Contacts', value: '800+ with emails' },
        { label: 'Supplier Portals', value: '115+ links' },
        { label: 'Export', value: 'CSV download included' },
      ]}
      categoriesTitle="Search By Set-Aside Type"
      categories={[
        { title: '8(a) Small Business', highlight: true },
        { title: 'HUBZone', highlight: true },
        { title: 'SDVOSB', highlight: true },
        { title: 'WOSB/EDWOSB', highlight: true },
        { title: 'Small Disadvantaged', highlight: true },
        { title: 'Large Business', highlight: true },
      ]}
      features={[
        {
          icon: '🏢',
          title: '3,500+ Prime Contractors',
          description: 'Our database includes over 3,500 federal prime contractors with verified contact information and subcontracting plans.',
        },
        {
          icon: '📧',
          title: '800+ SBLO Contacts',
          description: 'Direct access to Small Business Liaison Officers with email addresses. Skip the gatekeepers and reach decision makers.',
        },
        {
          icon: '🔗',
          title: '115+ Supplier Portals',
          description: 'Links to supplier registration portals so you can get on vendor lists quickly and efficiently.',
        },
        {
          icon: '📊',
          title: 'Export to CSV',
          description: 'Download your search results to CSV for easy import into your CRM, email tool, or spreadsheet.',
        },
      ]}
      benefits={[
        'Lifetime access (one-time payment)',
        '3,500+ federal prime contractors',
        '800+ SBLO contacts with emails',
        '115+ supplier portal links',
        '$430B+ in contract data',
        'Advanced search & filtering',
        'CSV export included',
        'All future updates included',
      ]}
      highlightTitle="Stop Cold Calling the Wrong Companies"
      highlightText="Most contractors waste months reaching out to companies that dont team, dont have subcontracting goals, or arent even active anymore. Our database shows you exactly who is winning contracts, who needs small business subs, and how to reach them."
      reviews={[
        {
          name: 'David K.',
          date: '5 days ago',
          rating: 5,
          text: 'Found 3 teaming partners in my first week. The SBLO contact data is gold - I now know exactly who to reach out to.',
        },
        {
          name: 'Jennifer L.',
          date: '2 weeks ago',
          rating: 5,
          text: 'I used to spend hours on SAM.gov and FPDS trying to find this information. Now I have it all in one place. Game changer.',
        },
        {
          name: 'Robert M.',
          date: '3 weeks ago',
          rating: 5,
          text: 'The CSV export alone saved me 20 hours. I imported the data directly into HubSpot and started my outreach campaign the same day.',
        },
      ]}
    />
  );
}
