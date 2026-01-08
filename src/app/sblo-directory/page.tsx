import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function SBLODirectoryPage() {
  return (
    <ProductPageAppSumo
      title="SBLO Contact Directory"
      tagline="Direct contacts to Small Business Liaison Officers at federal agencies and prime contractors"
      description="Stop wasting time hunting for SBLO contacts. This comprehensive directory gives you direct access to Small Business Liaison Officers across 76+ federal agencies and major prime contractors. Get names, emails, phone numbers, and office locations so you can start building relationships today."
      primaryColor="#059669"
      gradientFrom="#059669"
      gradientTo="#10b981"
      price="FREE"
      originalPrice="$997 value"
      checkoutUrl="/free-resources"
      videoTitle="SBLO Contact Directory"
      videoSubtitle="76+ agencies with direct contact information"
      screenshots={[
        '/images/products/sblo-directory/main page prime.png',
        '/images/products/sblo-directory/prime examples.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/sblo-directory/main page prime.png',
          title: 'Complete SBLO Directory',
          description: 'Access direct contact information for Small Business Liaison Officers across federal agencies and prime contractors.',
          bullets: [
            'Direct email addresses',
            'Phone numbers included',
            '76+ federal agencies',
            'Prime contractor SBLOs',
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
        '76+ federal agencies covered',
        'Direct SBLO email addresses',
        'Phone numbers and office locations',
        'Prime contractor SBLO contacts included',
        'Instant PDF download',
      ]}
      glanceItems={[
        { label: 'Agencies', value: '76+ federal agencies' },
        { label: 'Format', value: 'PDF download' },
        { label: 'Updates', value: 'Quarterly refresh' },
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
        'Instant PDF download',
        '76+ federal agencies',
        'Direct email addresses',
        'Phone numbers included',
        'Prime contractor contacts',
        'Quarterly updates available',
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
