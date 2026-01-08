import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function ExpiringContractsCSVPage() {
  return (
    <ProductPageAppSumo
      title="Free Expiring Contracts CSV"
      tagline="Get a sample of expiring federal contracts data to jumpstart your pipeline"
      description="Get started with expiring federal contracts data without spending a dime. This free CSV file contains a sample of contracts that are set to expire, giving you a taste of the opportunities available. Import it into Excel, Google Sheets, or your CRM to start identifying recompete opportunities today."
      primaryColor="#0891b2"
      gradientFrom="#0891b2"
      gradientTo="#06b6d4"
      price="FREE"
      originalPrice="$697 value"
      checkoutUrl="/free-resources"
      videoTitle="Expiring Contracts Sample"
      videoSubtitle="Import into Excel or your CRM instantly"
      screenshots={[
        '/images/products/expiring-contracts-csv/main page.png',
        '/images/products/expiring-contracts-csv/total contracts.png',
        '/images/products/expiring-contracts-csv/values.png',
        '/images/products/expiring-contracts-csv/naics receipient.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/expiring-contracts-csv/main page.png',
          title: 'Complete Contract Data',
          description: 'Access comprehensive expiring contract information in an easy-to-use CSV format.',
          bullets: [
            'Contract numbers',
            'Agency information',
            'Expiration dates',
            'Prime contractor details',
          ],
        },
        {
          image: '/images/products/expiring-contracts-csv/start end date.png',
          title: 'Date Information',
          description: 'See contract start and end dates to time your outreach perfectly.',
          bullets: [
            'Contract start dates',
            'Expiration dates',
            'Timeline visibility',
            'Planning insights',
          ],
        },
        {
          image: '/images/products/expiring-contracts-csv/values.png',
          title: 'Contract Values',
          description: 'Prioritize your outreach based on contract dollar values and opportunity size.',
          bullets: [
            'Total contract value',
            'Award amounts',
            'Size prioritization',
            'ROI targeting',
          ],
        },
      ]}
      tldr={[
        'Free sample of expiring contracts data',
        'CSV format - works with Excel, Sheets, any CRM',
        'Contract values, agencies, and expiration dates',
        'Prime contractor information included',
        'Perfect for testing your outreach process',
      ]}
      glanceItems={[
        { label: 'Format', value: 'CSV File' },
        { label: 'Compatible with', value: 'Excel, Google Sheets, CRMs' },
        { label: 'Data included', value: 'Sample expiring contracts' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Data Fields Included"
      categories={[
        { title: 'Contract Numbers', highlight: true },
        { title: 'Contract Values', highlight: true },
        { title: 'Expiration Dates', highlight: true },
        { title: 'Prime Contractors', highlight: true },
        { title: 'Agency Names', highlight: true },
        { title: 'NAICS Codes', highlight: true },
      ]}
      features={[
        {
          icon: '📊',
          title: 'CSV Format',
          description: 'Universal format that works with Excel, Google Sheets, Airtable, and any CRM system.',
        },
        {
          icon: '💰',
          title: 'Contract Values',
          description: 'See the dollar value of each expiring contract to prioritize your outreach efforts.',
        },
        {
          icon: '📅',
          title: 'Expiration Dates',
          description: 'Know exactly when contracts are ending so you can time your outreach perfectly.',
        },
        {
          icon: '🏢',
          title: 'Prime Contractor Info',
          description: 'Identify the current contract holders for teaming or competitive positioning.',
        },
      ]}
      benefits={[
        'Instant CSV download',
        'Sample expiring contracts',
        'Contract values included',
        'Expiration dates',
        'Prime contractor info',
        'Works with any spreadsheet',
      ]}
      highlightTitle="Test Your Process Before You Commit"
      highlightText="This free sample lets you validate your outreach process before upgrading to the full database. Import the data, build your workflow, and see how expiring contracts fit into your BD strategy. When youre ready for more, upgrade to the full Expiring Contracts Forecast."
      reviews={[
        {
          name: 'Kevin L.',
          date: '4 days ago',
          rating: 5,
          text: 'Downloaded the free CSV to test my process. Within a week I upgraded to the full database - the data quality is excellent.',
        },
        {
          name: 'Michelle S.',
          date: '1 week ago',
          rating: 5,
          text: 'Great way to see what the data looks like before committing. The CSV imported perfectly into my Hubspot.',
        },
        {
          name: 'Derek P.',
          date: '2 weeks ago',
          rating: 5,
          text: 'Found 2 teaming opportunities just from the free sample. Cant wait to see whats in the full database.',
        },
      ]}
    />
  );
}
