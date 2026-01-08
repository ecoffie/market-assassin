import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function ActionPlan2026Page() {
  return (
    <ProductPageAppSumo
      title="2026 GovCon Action Plan"
      tagline="Your step-by-step roadmap to winning federal contracts in 2026"
      description="Stop guessing and start winning. The 2026 GovCon Action Plan gives you a month-by-month roadmap with specific actions to take, deadlines to hit, and milestones to track. Whether you're new to federal contracting or looking to scale your existing business, this action plan keeps you focused on what matters most."
      primaryColor="#2563eb"
      gradientFrom="#2563eb"
      gradientTo="#7c3aed"
      price="FREE"
      originalPrice="$497 value"
      checkoutUrl="/free-resources"
      videoTitle="2026 GovCon Action Plan"
      videoSubtitle="12-month roadmap to federal contract wins"
      screenshots={[
        '/images/products/action-plan-2026/action plan home.png',
        '/images/products/action-plan-2026/phase 3.png',
        '/images/products/action-plan-2026/phase 5.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/action-plan-2026/action plan home.png',
          title: 'Complete Action Plan',
          description: 'Your 12-month roadmap with monthly milestones and actionable tasks to win federal contracts.',
          bullets: [
            '12-month roadmap',
            'Monthly milestones',
            'Weekly tasks',
            'Goal tracking',
          ],
        },
        {
          image: '/images/products/action-plan-2026/phase 3.png',
          title: 'Phase-by-Phase Breakdown',
          description: 'Each phase includes detailed instructions, key activities, and success metrics.',
          bullets: [
            'Clear objectives',
            'Specific actions',
            'Timeline guidance',
            'Success metrics',
          ],
        },
        {
          image: '/images/products/action-plan-2026/phase 5.png',
          title: 'Implementation Details',
          description: 'Detailed guidance for each phase of your GovCon journey with practical next steps.',
          bullets: [
            'Step-by-step guidance',
            'Resource recommendations',
            'Common pitfalls',
            'Best practices',
          ],
        },
      ]}
      tldr={[
        '12-month action plan with monthly milestones',
        'Key federal contracting deadlines for 2026',
        'Week-by-week tasks and priorities',
        'Goal tracking worksheets included',
        'Based on proven contractor success strategies',
      ]}
      glanceItems={[
        { label: 'Format', value: 'PDF Document' },
        { label: 'Pages', value: '25+ pages' },
        { label: 'Best for', value: 'New & experienced contractors' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Quarterly Breakdown"
      categories={[
        { title: 'Q1: Foundation Building', highlight: true },
        { title: 'Q2: Market Research', highlight: true },
        { title: 'Q3: Relationship Building', highlight: true },
        { title: 'Q4: Year-End Push', highlight: true },
        { title: 'Key Deadlines Calendar', highlight: true },
        { title: 'Goal Tracking Worksheets', highlight: true },
      ]}
      features={[
        {
          icon: '📅',
          title: 'Q1: Foundation Building',
          description: 'Set up your SAM registration, certifications, and capability statement. Build your BD infrastructure.',
        },
        {
          icon: '🔍',
          title: 'Q2: Market Research',
          description: 'Identify target agencies, analyze past awards, and build your pipeline of opportunities.',
        },
        {
          icon: '🤝',
          title: 'Q3: Relationship Building',
          description: 'Connect with contracting officers, attend industry days, and form teaming partnerships.',
        },
        {
          icon: '🚀',
          title: 'Q4: Year-End Push',
          description: 'Capitalize on year-end spending, submit proposals, and position for the new fiscal year.',
        },
      ]}
      benefits={[
        'Instant PDF download',
        '12-month action roadmap',
        'Key deadline calendar',
        'Weekly task checklists',
        'Goal tracking worksheets',
        'Print-ready format',
      ]}
      highlightTitle="Stop Guessing, Start Executing"
      highlightText="Most contractors fail because they dont have a plan. They chase random opportunities, miss key deadlines, and wonder why they arent winning. This action plan gives you the structure and accountability you need to actually make progress in federal contracting."
      reviews={[
        {
          name: 'Marcus T.',
          date: '1 week ago',
          rating: 5,
          text: 'Finally, a clear roadmap! I was all over the place before this. Now I know exactly what to focus on each month.',
        },
        {
          name: 'Jennifer K.',
          date: '2 weeks ago',
          rating: 5,
          text: 'This action plan helped me land my first contract. The monthly breakdown made it manageable instead of overwhelming.',
        },
        {
          name: 'Anthony R.',
          date: '3 weeks ago',
          rating: 5,
          text: 'The Q4 strategy alone was worth it. I positioned myself for year-end spending and won a $85K task order.',
        },
      ]}
    />
  );
}
