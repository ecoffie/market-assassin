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
      thumbnails={['Guides', 'Templates', 'Checklists', 'Download']}
      tldr={[
        'Step-by-step guides for every stage of GovCon',
        'Ready-to-use email templates for SBLO outreach',
        'Checklists to never miss a step',
        'Best practices from successful contractors',
        'Updated with latest FAR regulations',
      ]}
      glanceItems={[
        { label: 'Format', value: 'PDF Bundle' },
        { label: 'Contents', value: 'Guides + Templates + Checklists' },
        { label: 'Best for', value: 'New contractors, BD professionals' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Whats Included"
      categories={[
        { title: 'SAM Registration Guide', highlight: true },
        { title: 'Capability Statement Template', highlight: true },
        { title: 'SBLO Email Templates', highlight: true },
        { title: 'Teaming Agreement Checklist', highlight: true },
        { title: 'Proposal Response Checklist', highlight: true },
        { title: 'BD Pipeline Tracker', highlight: true },
      ]}
      features={[
        {
          icon: '📖',
          title: 'Step-by-Step Guides',
          description: 'Detailed guides that walk you through every stage from registration to contract execution.',
        },
        {
          icon: '📧',
          title: 'Email Templates',
          description: 'Professional templates for SBLO outreach, teaming introductions, and follow-ups. Just customize and send.',
        },
        {
          icon: '✅',
          title: 'Checklists',
          description: 'Never miss a step with our comprehensive checklists for proposals, registrations, and compliance.',
        },
        {
          icon: '🎯',
          title: 'Best Practices',
          description: 'Learn from successful contractors strategies and avoid common mistakes that cost new contractors opportunities.',
        },
      ]}
      benefits={[
        'Instant PDF download',
        'Step-by-step guides',
        'Email templates included',
        'BD checklists',
        'Best practices guide',
        'Regular updates',
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
