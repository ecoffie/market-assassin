import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function AIPromptsPage() {
  return (
    <ProductPageAppSumo
      title="75+ AI Prompts for GovCon"
      tagline="Ready-to-use prompts to accelerate your federal contracting business"
      description="Stop staring at ChatGPT wondering what to ask. This collection of 75+ battle-tested AI prompts is specifically designed for government contractors. From capability statement writing to proposal development, competitive analysis to BD strategy - just copy, paste, and customize for instant results."
      primaryColor="#7c3aed"
      gradientFrom="#7c3aed"
      gradientTo="#ec4899"
      price="FREE"
      originalPrice="$797 value"
      checkoutUrl="/free-resources"
      videoTitle="75+ AI Prompts for GovCon"
      videoSubtitle="Copy-paste prompts that actually work"
      thumbnails={['Copy', 'Paste', 'Customize', 'Done']}
      tldr={[
        '75+ ready-to-use prompts',
        'BD & proposal writing prompts',
        'Marketing & content prompts',
        'Operations & compliance prompts',
        'Works with ChatGPT, Claude, and more',
      ]}
      glanceItems={[
        { label: 'Prompts', value: '75+ ready-to-use' },
        { label: 'Categories', value: 'BD, Proposals, Marketing, Ops' },
        { label: 'Format', value: 'PDF download' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Prompt Categories Included"
      categories={[
        { title: 'Capability Statements', highlight: true },
        { title: 'Proposal Writing', highlight: true },
        { title: 'Competitive Analysis', highlight: true },
        { title: 'BD Strategy', highlight: true },
        { title: 'Marketing Content', highlight: true },
        { title: 'Compliance & FAR', highlight: true },
      ]}
      features={[
        {
          icon: '📝',
          title: 'Proposal Writing Prompts',
          description: 'Generate executive summaries, past performance narratives, technical approaches, and management plans in minutes instead of hours.',
        },
        {
          icon: '📊',
          title: 'Competitive Analysis Prompts',
          description: 'Analyze competitors, identify win themes, and develop discriminators that set you apart from the competition.',
        },
        {
          icon: '🎯',
          title: 'BD Strategy Prompts',
          description: 'Develop capture strategies, identify teaming partners, and create call plans for agency outreach.',
        },
        {
          icon: '📣',
          title: 'Marketing Content Prompts',
          description: 'Generate LinkedIn posts, email sequences, capability briefs, and thought leadership content.',
        },
      ]}
      benefits={[
        'Instant PDF download',
        '75+ tested prompts',
        'Copy-paste format',
        'GovCon-specific language',
        'Works with any AI tool',
        'Regular updates',
      ]}
      highlightTitle="GovCon-Specific, Not Generic"
      highlightText="These arent generic business prompts repackaged. Every prompt was written specifically for government contractors, using the language, frameworks, and requirements unique to federal contracting. They reference FAR clauses, agency structures, and GovCon best practices."
      reviews={[
        {
          name: 'Amanda K.',
          date: '3 days ago',
          rating: 5,
          text: 'The proposal writing prompts alone saved me 10+ hours on my last response. The outputs actually sound like a GovCon professional wrote them.',
        },
        {
          name: 'Derek S.',
          date: '1 week ago',
          rating: 5,
          text: 'I use the competitive analysis prompts before every capture. Game changer for understanding the competitive landscape quickly.',
        },
        {
          name: 'Rachel H.',
          date: '2 weeks ago',
          rating: 5,
          text: 'Finally, AI prompts that understand government contracting. The capability statement prompts helped me completely redo my one-pager.',
        },
      ]}
    />
  );
}
