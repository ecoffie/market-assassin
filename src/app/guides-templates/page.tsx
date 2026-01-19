import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function GuidesTemplatesPage() {
  return (
    <ProductPageAppSumo
      title="GovCon Guides & Templates"
      tagline="Comprehensive guides and ready-to-use templates for federal contracting"
      description="Federal contracting doesnt have to be complicated. Our guides break down every step, and our templates give you professional communications ready to customize and send. From SAM registration to teaming agreements, from capability statements to SBLO outreach - everything you need to get started."
      primaryColor="#059669"
      gradientFrom="#059669"
      gradientTo="#10b981"
      price="FREE"
      originalPrice="$97 value"
      checkoutUrl="/free-resources"
      videoTitle="GovCon Guides & Templates"
      videoSubtitle="Everything you need to get started in federal contracting"
      screenshots={[
        '/images/products/guides-templates/agency-pain-points-1.png',
        '/images/products/guides-templates/ndaa fy2026.png',
        '/images/products/guides-templates/ndaa provisions.png',
        '/images/products/guides-templates/agency-pain-points-3.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/guides-templates/agency-pain-points-1.png',
          title: 'Agency Pain Points Decision Framework',
          description: 'Match your business capabilities to agency pain points for faster wins. Know which agencies need what you offer.',
          bullets: [
            '8 pain point categories',
            'Agency-specific profiles',
            'Decision matrix & scoring',
            'Tailored outreach strategies',
          ],
        },
        {
          image: '/images/products/guides-templates/ndaa fy2026.png',
          title: '2026 NDAA Small Business Provisions',
          description: 'Stay ahead with the latest FY2026 NDAA changes affecting small business contracting. New sole source thresholds, CMMC support, and more.',
          bullets: [
            'Higher sole source thresholds ($8M/$10M)',
            'Unified application process',
            'CMMC compliance support',
            'Cybersecurity harmonization',
          ],
        },
        {
          image: '/images/products/guides-templates/ndaa provisions.png',
          title: 'General Contractor Guide',
          description: 'Construction-specific guidance for GCs entering federal contracting. Know where to find the right opportunities.',
          bullets: [
            'Key NAICS codes for GCs',
            'VA, DoD, GSA opportunities',
            'Bonding requirements',
            'Site visit preparation',
          ],
        },
      ]}
      tldr={[
        '2026 NDAA Small Business Provisions breakdown',
        'Agency Pain Points Decision Framework',
        'General Contractor-specific guidance',
        'Decision matrices and scoring tools',
        'Action plans and checklists',
      ]}
      glanceItems={[
        { label: 'Format', value: 'PDF Bundle' },
        { label: 'Contents', value: 'Guides + Templates + Checklists' },
        { label: 'Best for', value: 'New contractors, BD professionals' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Whats Included"
      categories={[
        { title: '2026 NDAA Summary', highlight: true },
        { title: 'Agency Pain Points Framework', highlight: true },
        { title: 'General Contractor Guide', highlight: true },
        { title: 'Decision Matrix Tools', highlight: true },
        { title: 'Action Plans & Checklists', highlight: true },
        { title: 'Agency-Specific Profiles', highlight: true },
      ]}
      features={[
        {
          icon: '📜',
          title: '2026 NDAA Small Business Provisions',
          description: 'Understand the latest FY2026 NDAA changes: higher sole source thresholds ($8M/$10M), unified application process, CMMC support strategy, and cybersecurity harmonization.',
        },
        {
          icon: '🎯',
          title: 'Agency Pain Points Decision Framework',
          description: 'Match your capabilities to agency pain points. Includes profiles for DHS, Space Force, DOE, DoD, DOT, and DLA with scoring tools.',
        },
        {
          icon: '🏗️',
          title: 'General Contractor Guide',
          description: 'Construction-specific guidance: key NAICS codes (236220, 238210, 238220), VA/DoD/GSA opportunities, bonding requirements, and site visit prep.',
        },
        {
          icon: '📊',
          title: 'Decision Tools & Action Plans',
          description: 'Priority matrices, scoring tools, and week-by-week action plans to help you choose and pursue the right agencies.',
        },
      ]}
      benefits={[
        'Instant PDF download',
        '2026 NDAA provisions summary',
        'Agency pain points framework',
        'General contractor guide',
        'Decision matrices & scoring tools',
        'Week-by-week action plans',
      ]}
      highlightTitle="Dont Reinvent the Wheel"
      highlightText="Successful contractors dont start from scratch. They use proven templates, follow established processes, and leverage checklists to stay organized. This bundle gives you all the tools that experienced contractors use - so you can skip the learning curve."
      reviews={[
        {
          name: 'Chris M.',
          date: '6 days ago',
          rating: 5,
          text: 'The email templates alone are worth it. Got my first meeting with an SBLO using one of them.',
        },
        {
          name: 'Patricia L.',
          date: '2 weeks ago',
          rating: 5,
          text: 'Finally understand the federal contracting process. These guides are excellent for beginners.',
        },
        {
          name: 'Robert J.',
          date: '3 weeks ago',
          rating: 5,
          text: 'The proposal checklist saved me from missing a key requirement. Would have cost me the contract.',
        },
      ]}
    />
  );
}
