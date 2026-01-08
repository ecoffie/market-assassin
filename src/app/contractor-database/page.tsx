import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function ContractorDatabasePage() {
  return (
    <ProductPageAppSumo
      title="Federal Contractor Database"
      tagline="Search 200K+ federal contractors for teaming opportunities"
      description="Stop wasting hours searching for teaming partners. The Federal Contractor Database gives you instant access to over 200,000 verified federal contractors, complete with contact information, contract history, certifications, and subcontracting details. Find the perfect prime or sub in minutes, not days."
      primaryColor="#4f46e5"
      gradientFrom="#4f46e5"
      gradientTo="#7c3aed"
      price="$197"
      originalPrice="$297/month"
      checkoutUrl="https://govcongiants.lemonsqueezy.com/checkout/buy/contractor-database"
      videoTitle="Federal Contractor Database Demo"
      videoSubtitle="See how to find teaming partners in under 2 minutes"
      thumbnails={['Search', 'Filter', 'Connect', 'Team']}
      tldr={[
        '200,000+ verified federal contractors',
        'Prime contractor contact information',
        'Contract history and award data',
        'NAICS and set-aside filtering',
        'Export to CSV for your CRM',
      ]}
      glanceItems={[
        { label: 'Contractors', value: '200,000+ verified' },
        { label: 'Data Points', value: 'Contact, contracts, certs' },
        { label: 'Updates', value: 'Monthly refresh' },
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
          icon: 'DB',
          title: '200K+ Verified Contractors',
          description: 'Our database includes over 200,000 federal contractors with verified contact information, updated monthly from official government sources.',
        },
        {
          icon: 'FLT',
          title: 'Advanced Filtering',
          description: 'Filter by NAICS code, set-aside type, agency, contract value, location, and more. Find exactly who you need in seconds.',
        },
        {
          icon: 'CTR',
          title: 'Contract History',
          description: 'See each contractors recent federal contracts including values, agencies, and performance. Know who is winning before you reach out.',
        },
        {
          icon: 'CSV',
          title: 'Export to CSV',
          description: 'Download your search results to CSV for easy import into your CRM, email tool, or spreadsheet. Build targeted outreach lists instantly.',
        },
      ]}
      benefits={[
        'Lifetime access (one-time payment)',
        '200,000+ federal contractors',
        'Monthly data updates',
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
          text: 'Found 3 teaming partners in my first week. The subcontracting goal data is gold - I now know exactly which primes need my certifications.',
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
