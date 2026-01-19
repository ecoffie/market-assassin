import ProductPageAppSumo from '@/components/ProductPageAppSumo';

export default function AIContentPage() {
  return (
    <ProductPageAppSumo
      title="LinkedIn Content Creator"
      tagline="Create LinkedIn posts that resonate with government buyers"
      description="Stop staring at blank screens wondering what to post. The AI Content Generator creates LinkedIn posts specifically designed to resonate with government buyers and contracting officers. Our custom fine-tuned model was trained on 146 viral GovCon posts, so it writes in the authentic voice of successful GovCon thought leaders."
      primaryColor="#7c3aed"
      gradientFrom="#7c3aed"
      gradientTo="#a855f7"
      price="$197"
      originalPrice="$588/year"
      checkoutUrl="https://govcongiants.lemonsqueezy.com/checkout/buy/ai-content-generator"
      pricingTiers={[
        {
          name: 'Content Engine',
          price: '$197',
          originalPrice: '$588/year',
          checkoutUrl: 'https://govcongiants.lemonsqueezy.com/checkout/buy/ai-content-generator',
          description: 'Text-only LinkedIn post generation',
          features: [
            'Lifetime access',
            'Generate 10 posts per click',
            '175 federal agencies',
            'GovCon-tuned AI model',
            'GEO Boost optimization',
            'All future updates',
          ],
        },
        {
          name: 'Full Fix',
          price: '$397',
          originalPrice: '$1,176/year',
          checkoutUrl: 'https://govcongiants.lemonsqueezy.com/checkout/buy/ai-content-generator-full',
          description: 'Text + graphics & carousel generation',
          features: [
            'Everything in Content Engine, plus:',
            'AI-generated graphics',
            'Carousel post templates',
            'Quote graphics generator',
            'Visual content library',
            'Brand customization',
            'Priority support',
          ],
        },
      ]}
      screenshots={[
        '/images/products/ai content generator/ai content generator home page.png',
        '/images/products/ai content generator/company profile .png',
        '/images/products/ai content generator/content library.png',
        '/images/products/ai content generator/carousel.png',
      ]}
      screenshotFeatures={[
        {
          image: '/images/products/ai content generator/linkedin posts.png',
          title: 'Generate 10 Posts Instantly',
          description: 'One click generates 10 diverse LinkedIn posts tailored to your target agencies. Get a full week of content in seconds.',
          bullets: [
            '10 posts per generation',
            'Multiple content styles',
            'Agency-specific messaging',
            'Copy & paste ready',
          ],
        },
        {
          image: '/images/products/ai content generator/carousel page.png',
          title: 'Carousel & Graphics Creator',
          description: 'Create eye-catching carousel posts and branded graphics that stand out in the feed. Full Fix tier includes visual content generation.',
          bullets: [
            'Multi-slide carousels',
            'Branded quote graphics',
            'Data visualization posts',
            'Professional templates',
          ],
        },
        {
          image: '/images/products/ai content generator/content library.png',
          title: 'Content Library & Calendar',
          description: 'Save your best posts to a content library and plan your posting schedule with the built-in calendar.',
          bullets: [
            'Save favorite posts',
            'Content calendar view',
            'Schedule your content',
            'Track what performs',
          ],
        },
      ]}
      tldr={[
        'Generate 10 LinkedIn posts with one click',
        '175 federal agencies to target',
        'GovCon-tuned AI model (trained on 146 viral posts)',
        'GEO Boost for AI search engine optimization',
        'Diverse content styles tailored to your target agencies',
      ]}
      glanceItems={[
        { label: 'Output', value: '10 LinkedIn posts per generation' },
        { label: 'Agencies', value: '175 federal agencies' },
        { label: 'AI Model', value: 'Custom GovCon-tuned' },
        { label: 'Website', value: 'govcongiants.com', link: 'https://govcongiants.com' },
      ]}
      categoriesTitle="175 Target Agencies Available"
      categories={[
        { title: 'Navy & Naval Commands', highlight: true },
        { title: 'Army Commands', highlight: true },
        { title: 'Air Force Commands', highlight: true },
        { title: 'DoD-Wide (DLA, DISA, DARPA...)', highlight: true },
        { title: 'Civilian (VA, GSA, NASA, HHS...)', highlight: true },
        { title: '+ Many More', highlight: true },
      ]}
      features={[
        {
          icon: 'AI',
          title: 'GovCon-Tuned AI Model',
          description: 'Our custom fine-tuned model was trained specifically on high-performing government contracting LinkedIn content. It writes in the authentic voice of successful GovCon thought leaders.',
        },
        {
          icon: 'GEO',
          title: 'GEO Boost (Generative Engine Optimization)',
          description: 'Optimize your content for AI search engines like ChatGPT and Perplexity. Uses question-answer format, clear structure, and authoritative sources to appear in AI-generated responses.',
        },
        {
          icon: '10x',
          title: 'Generate 10 Posts at Once',
          description: "Get a diverse mix of content styles tailored to your target agencies. One click gives you a week's worth of content.",
        },
        {
          icon: 'AGY',
          title: 'Agency-Specific Targeting',
          description: 'Select from 175 federal agencies across Navy, Army, Air Force, DoD-wide, and civilian categories. Content is tailored to resonate with your specific target buyers.',
        },
      ]}
      benefits={[
        'Lifetime access (one-time payment)',
        'Generate 10 posts per click',
        '175 federal agencies',
        'GovCon-tuned AI model',
        'GEO Boost optimization',
        'All future updates included',
      ]}
      highlightTitle="Trained on 146 Viral GovCon Posts"
      highlightText="This isn't generic AI content. Our model studied what actually works in the GovCon LinkedIn space - the hooks, the storytelling, the CTAs that drive engagement. The result? Content that sounds like it came from a seasoned GovCon professional, not a robot."
      reviews={[
        {
          name: 'James R.',
          date: '3 days ago',
          rating: 5,
          text: "I've tried other AI writers but they all sound generic. This one actually sounds like someone who knows GovCon. My engagement is up 3x since I started using it.",
        },
        {
          name: 'Sarah M.',
          date: '1 week ago',
          rating: 5,
          text: 'The agency targeting is brilliant. I target DoD and the content actually references relevant programs and priorities. Saved me hours every week.',
        },
        {
          name: 'Michael T.',
          date: '2 weeks ago',
          rating: 5,
          text: 'The GEO Boost feature is ahead of its time. My content is now showing up in ChatGPT responses when people ask about federal contracting topics.',
        },
      ]}
    />
  );
}
