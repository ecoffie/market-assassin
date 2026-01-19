import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function SBLODirectoryPage() {
  return (
    <ProductPageAppSumo
      title="SBLO Contact List"
      tagline="Direct contacts to Small Business Liaison Officers at federal agencies and prime contractors"
      description="Stop wasting time hunting for SBLO contacts. This list gives you direct access to 225 Small Business Liaison Officers across 76+ federal agencies and major prime contractors. Get names, emails, phone numbers, and office locations so you can start building relationships today."
      primaryColor="#059669"
      gradientFrom="#059669"
      gradientTo="#10b981"
      price="FREE"
      originalPrice="$997 value"
      checkoutUrl="/free-resources"
      pricingTiers={[
        {
          name: 'Free List',
          price: 'FREE',
          originalPrice: '$997 value',
          checkoutUrl: '/free-resources',
          description: '225 SBLO contacts for 76+ federal agencies',
          features: [
            '225 SBLO contacts',
            'Instant PDF download',
            '76+ federal agencies',
            'Direct email addresses',
            'Phone numbers included',
            'Prime contractor contacts',
          ],
        },
        {
          name: 'Full Database',
          price: '$497',
          originalPrice: '$997 value',
          checkoutUrl: 'https://govcongiants.lemonsqueezy.com/checkout/buy/contractor-database',
          description: '3,500+ contractors vs 225 in free list',
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
        description: 'Go from 225 contacts to 3,500+ prime contractors with contract history, NAICS codes, and direct contact information.',
        price: '$497',
        originalPrice: '$997',
        checkoutUrl: 'https://govcongiants.lemonsqueezy.com/checkout/buy/contractor-database',
        linkUrl: '/contractor-database-product',
      }}
      videoTitle="SBLO Contact List"
      videoSubtitle="225 contacts across 76+ agencies"
      screenshots={[
        '/images/products/sblo-directory/main page prime.png',
        '/images/products/sblo-directory/prime examples.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/sblo-directory/main page prime.png',
          title: 'Complete SBLO List',
          description: 'Access 225 direct contacts for Small Business Liaison Officers across federal agencies and prime contractors.',
          bullets: [
            '225 SBLO contacts',
            'Direct email addresses',
            'Phone numbers included',
            '76+ federal agencies',
          ],
        },
        {
          image: '/images/products/sblo-directory/prime examples.png',
          title: 'Prime Contractor Contacts',
          description: 'Get SBLO contacts at major prime contractors who are actively looking for small business subcontractors.',
          bullets: [
            'Major defense primes',
            'Civilian agency primes',
            'Supplier diversity contacts',
            'Vendor registration info',
          ],
        },
      ]}
      tldr={[
        '225 SBLO contacts included',
        '76+ federal agencies covered',
        'Direct email addresses and phone numbers',
        'Prime contractor SBLO contacts included',
        'Instant PDF download',
      ]}
      glanceItems={[
        { label: 'Contacts', value: '225 SBLOs' },
        { label: 'Agencies', value: '76+ federal agencies' },
        { label: 'Format', value: 'PDF download' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Agencies Included"
      categories={[
        { title: 'Department of Defense', highlight: true },
        { title: 'Department of Veterans Affairs', highlight: true },
        { title: 'Department of Homeland Security', highlight: true },
        { title: 'General Services Administration', highlight: true },
        { title: 'Health & Human Services', highlight: true },
        { title: '70+ More Agencies', highlight: true },
      ]}
      features={[
        {
          icon: '📧',
          title: 'Direct Email Addresses',
          description: 'No more generic inboxes. Get the actual email addresses of SBLOs who want to hear from small businesses like yours.',
        },
        {
          icon: '📞',
          title: 'Phone Numbers Included',
          description: 'Sometimes you need to pick up the phone. Direct dial numbers let you connect faster than email alone.',
        },
        {
          icon: '🏛️',
          title: '76+ Federal Agencies',
          description: 'From DoD to civilian agencies, we cover every major buyer in the federal marketplace.',
        },
        {
          icon: '🏢',
          title: 'Prime Contractor SBLOs',
          description: 'Bonus: includes SBLO contacts at major prime contractors who are looking for small business subcontractors.',
        },
      ]}
      benefits={[
        '225 SBLO contacts',
        'Instant PDF download',
        '76+ federal agencies',
        'Direct email addresses',
        'Phone numbers included',
        'Prime contractor contacts',
      ]}
      highlightTitle="SBLOs Want to Hear From You"
      highlightText="Small Business Liaison Officers are literally paid to help small businesses connect with contracting opportunities. They want your capability statement, they want to know what you do, and they can point you to the right opportunities. This directory removes the barrier of finding them."
      reviews={[
        {
          name: 'Marcus T.',
          date: '1 week ago',
          rating: 5,
          text: 'Downloaded this and sent 20 emails to SBLOs. Got 8 responses and 3 meetings scheduled. This directory is gold.',
        },
        {
          name: 'Angela R.',
          date: '2 weeks ago',
          rating: 5,
          text: 'I spent months trying to find SBLO contacts manually. This PDF had everything I needed in one place. Wish I found it sooner.',
        },
        {
          name: 'Kevin L.',
          date: '3 weeks ago',
          rating: 5,
          text: 'The prime contractor SBLO contacts are a nice bonus. Already registered with 5 vendor portals from leads in this directory.',
        },
      ]}
    />
  );
}
