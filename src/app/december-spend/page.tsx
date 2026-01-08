import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function DecemberSpendPage() {
  return (
    <ProductPageAppSumo
      title="December Spend Forecast"
      tagline="Capitalize on year-end government spending before its gone"
      description="Every year, federal agencies rush to spend remaining budget before the fiscal year ends. This comprehensive forecast shows you exactly where the money is going, which agencies have the most to spend, and how to position your business to capture these year-end dollars. Dont miss the biggest spending surge of the year."
      primaryColor="#dc2626"
      gradientFrom="#dc2626"
      gradientTo="#f97316"
      price="FREE"
      originalPrice="$1,297 value"
      checkoutUrl="/free-resources"
      videoTitle="December Spend Forecast"
      videoSubtitle="Q4 spending predictions and positioning strategies"
      screenshots={[
        '/images/products/december-spend/december hit list.png',
        '/images/products/december-spend/data sources.png',
        '/images/products/december-spend/10 beginner contracts.png',
        '/images/products/december-spend/34 low comp contracts.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/december-spend/december hit list.png',
          title: 'December Hit List',
          description: 'Identify the hottest year-end spending opportunities with our curated hit list of agencies and categories.',
          bullets: [
            'Top spending agencies',
            'Hot categories identified',
            'Budget surplus targets',
            'Quick-win opportunities',
          ],
        },
        {
          image: '/images/products/december-spend/10 beginner contracts.png',
          title: 'Beginner-Friendly Contracts',
          description: 'Perfect entry points for new contractors looking to win their first federal contract.',
          bullets: [
            '10 beginner contracts',
            'Lower competition',
            'Smaller dollar values',
            'Quick turnaround',
          ],
        },
        {
          image: '/images/products/december-spend/example contract.png',
          title: 'Contract Examples',
          description: 'See real contract examples with details on how to position yourself for similar opportunities.',
          bullets: [
            'Real contract data',
            'Award details',
            'Agency information',
            'Positioning tips',
          ],
        },
      ]}
      tldr={[
        'Agency-by-agency budget forecasts',
        'Hot spending categories identified',
        'Key deadline calendar included',
        'Positioning strategies for each agency',
        'Historical spending patterns analyzed',
      ]}
      glanceItems={[
        { label: 'Coverage', value: 'All major federal agencies' },
        { label: 'Time Period', value: 'Q4 / Year-end' },
        { label: 'Format', value: 'PDF download' },
        { label: 'Price', value: 'FREE (email required)' },
      ]}
      categoriesTitle="Year-End Spending Categories"
      categories={[
        { title: 'IT & Technology', highlight: true },
        { title: 'Professional Services', highlight: true },
        { title: 'Facilities & Construction', highlight: true },
        { title: 'Training & Education', highlight: true },
        { title: 'Equipment & Supplies', highlight: true },
        { title: 'R&D / Innovation', highlight: true },
      ]}
      features={[
        {
          icon: '💰',
          title: 'Agency Budget Analysis',
          description: 'See exactly how much each agency has left to spend and which categories they are prioritizing in Q4.',
        },
        {
          icon: '📅',
          title: 'Key Deadline Calendar',
          description: 'Know exactly when agencies need to obligate funds. Timing your outreach is everything in year-end spending.',
        },
        {
          icon: '🎯',
          title: 'Hot Categories Identified',
          description: 'We analyze spending patterns to identify which NAICS codes and PSC codes see the biggest year-end surge.',
        },
        {
          icon: '📈',
          title: 'Positioning Strategies',
          description: 'Actionable advice on how to position your business to capture year-end dollars at each major agency.',
        },
      ]}
      benefits={[
        'Instant PDF download',
        'Agency spending forecasts',
        'Hot category analysis',
        'Deadline calendar',
        'Positioning strategies',
        'Historical patterns',
      ]}
      highlightTitle="Use It or Lose It: The Year-End Rush"
      highlightText="Federal agencies operate on a use-it-or-lose-it budget system. Unspent funds dont roll over - they disappear. This creates a massive spending surge in Q4, especially December. Smart contractors position themselves early and capture contracts that agencies are desperate to award before the clock runs out."
      reviews={[
        {
          name: 'Thomas B.',
          date: '4 days ago',
          rating: 5,
          text: 'Used this forecast to target 3 agencies in December. Won a $180K task order that came out of nowhere. The deadline calendar was clutch.',
        },
        {
          name: 'Diana M.',
          date: '1 week ago',
          rating: 5,
          text: 'Finally understand how year-end spending works. The category analysis helped me focus my BD efforts on the right opportunities.',
        },
        {
          name: 'Chris P.',
          date: '2 weeks ago',
          rating: 5,
          text: 'The positioning strategies are gold. Implemented them in November and had my best Q4 ever. This should not be free.',
        },
      ]}
    />
  );
}
