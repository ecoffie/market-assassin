import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function TribalListPage() {
  return (
    <ProductPageAppSumo
      title="Tribal Contractor List"
      tagline="Access 500+ Native American-owned federal contractors"
      description="Connect with tribal-owned businesses for teaming and subcontracting opportunities. Our Tribal Contractor List includes verified Native American-owned companies with federal contract experience, contact information, NAICS codes, and certifications. Perfect for meeting your subcontracting goals or finding teaming partners with unique set-aside advantages."
      primaryColor="#059669"
      gradientFrom="#059669"
      gradientTo="#10b981"
      price="FREE"
      originalPrice="$297 value"
      checkoutUrl="/tribal-list-download"
      videoTitle="Tribal Contractor List Overview"
      videoSubtitle="See how to find tribal teaming partners"
      screenshots={[
        '/images/products/tribal-list/tribal main page.png',
        '/images/products/tribal-list/tribal final page.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/tribal-list/tribal main page.png',
          title: 'Tribal Contractor Database',
          description: 'Access 500+ verified Native American-owned federal contractors with contact information.',
          bullets: [
            '500+ tribal contractors',
            'Contact information',
            'NAICS codes included',
            'Certification details',
          ],
        },
        {
          image: '/images/products/tribal-list/tribal final page.png',
          title: 'Complete Contractor Details',
          description: 'Each listing includes company details, certifications, and contact information for teaming outreach.',
          bullets: [
            'Company profiles',
            'Set-aside certifications',
            'Industry categories',
            'Direct contacts',
          ],
        },
      ]}
      tldr={[
        '500+ tribal-owned federal contractors',
        'Contact information included',
        'NAICS codes and certifications',
        'CSV format for easy import',
        'Perfect for subcontracting goals',
      ]}
      glanceItems={[
        { label: 'Contractors', value: '500+ tribal-owned' },
        { label: 'Format', value: 'CSV download' },
        { label: 'Data', value: 'Contacts, NAICS, certs' },
        { label: 'Price', value: 'Free forever' },
      ]}
      categoriesTitle="Tribal Business Categories"
      categories={[
        { title: 'SBA 8(a) Tribal', highlight: true },
        { title: 'Native American-Owned', highlight: true },
        { title: 'Alaska Native Corps', highlight: true },
        { title: 'Indian-Owned Business', highlight: true },
        { title: 'Tribal Enterprise', highlight: true },
        { title: 'Native Hawaiian Org', highlight: true },
      ]}
      features={[
        {
          icon: '🏛️',
          title: '500+ Tribal Contractors',
          description: 'Verified Native American-owned businesses with active federal contracting experience and set-aside certifications.',
        },
        {
          icon: '📧',
          title: 'Contact Information',
          description: 'Direct contact details including email addresses, phone numbers, and company websites.',
        },
        {
          icon: '🎯',
          title: 'NAICS & Certifications',
          description: 'See each contractors NAICS codes and certifications to find the right match for your teaming needs.',
        },
        {
          icon: '📊',
          title: 'CSV Export',
          description: 'Download the complete list in CSV format for easy import into your CRM or spreadsheet.',
        },
      ]}
      benefits={[
        'Free download - no credit card',
        '500+ tribal contractors',
        'Contact information included',
        'NAICS codes listed',
        'Certification details',
        'CSV format for CRM import',
        'Perfect for subcontracting',
        'Teaming partner discovery',
      ]}
      highlightTitle="Meet Your Subcontracting Goals"
      highlightText="Large primes need tribal subcontractors to meet their small business subcontracting goals. Small businesses need tribal teaming partners for unique set-aside advantages. This list connects you with verified tribal contractors ready to team."
      reviews={[
        {
          name: 'Carlos M.',
          date: '1 week ago',
          rating: 5,
          text: 'Found 3 tribal teaming partners for our DoD proposal. The contact info was accurate and we connected quickly.',
        },
        {
          name: 'Amanda R.',
          date: '2 weeks ago',
          rating: 5,
          text: 'As a prime contractor, this list helped us meet our tribal subcontracting goals. Great resource.',
        },
        {
          name: 'Brian T.',
          date: '3 weeks ago',
          rating: 5,
          text: 'The NAICS filtering made it easy to find tribal contractors in my industry. Highly recommend.',
        },
      ]}
    />
  );
}
