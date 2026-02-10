import { NextRequest, NextResponse } from 'next/server';
import { getPainPointsForAgency, getPrioritiesForAgency, categorizePainPoints } from '@/lib/utils/pain-points';

// Fisher-Yates shuffle — returns a new array in random order
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Content lenses — sampled randomly each generation to force creative variety
const CONTENT_LENSES = [
  // Seasonal hooks
  'fiscal year-end urgency and use-it-or-lose-it spending',
  'Q1 planning and new budget priorities',
  'spring contract surge and pre-summer deadlines',
  'end-of-year spending push and continuing resolution impacts',
  // Perspective shifts
  'advice for a first-time GovCon bidder breaking in',
  'what primes wish their subcontractors knew',
  'from a contracting officer\'s perspective',
  'lessons from a 10-year GovCon veteran',
  // Frameworks
  'myth-busting a common GovCon misconception',
  'old way vs. new way comparison in federal contracting',
  'behind-the-scenes of a real contract win',
  'the hidden opportunity nobody talks about',
  // Trending topics
  'AI executive order implications for contractors',
  'CMMC 2.0 readiness and compliance opportunities',
  'supply chain reshoring and Buy American opportunities',
  'small business goal shortfalls by agency',
  // Emotional hooks
  'the biggest mistake small businesses make in GovCon',
  'why 80% of proposals get eliminated before evaluation',
  'the one change that transformed our win rate',
  'what I wish I knew before my first government bid',
];

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Grok API Configuration
const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3';

// Post Templates
const POST_TEMPLATES: Record<string, { name: string; description: string; prompt: string }> = {
  'story-driven': {
    name: 'Story-Driven',
    description: 'Personal narrative connecting your experience to agency challenges',
    prompt: `Write a story-based LinkedIn post that:
- Opens with a relatable scenario or personal anecdote
- Connects to the agency pain point naturally
- Shows empathy and deep understanding of the challenge
- Shares a lesson learned or insight that demonstrates expertise
- Ends with a thought-provoking question that invites discussion
- Uses conversational, authentic tone
- 200-300 words`
  },
  'stat-heavy': {
    name: 'Data-Driven',
    description: 'Statistics-focused post with hard numbers and sources',
    prompt: `Write a data-heavy LinkedIn post that:
- Opens with a striking statistic
- Lists 3-4 key data points with sources
- Uses bullet points for scannability
- Cites authoritative sources (GAO, agency reports)
- Connects numbers to real-world impact
- Ends with an expert observation about what the data means for the market
- Professional, authoritative tone
- 150-250 words`
  },
  'question-based': {
    name: 'Question-Based',
    description: 'Starts with provocative question (GEO optimized)',
    prompt: `Write a question-based LinkedIn post that:
- Opens with a thought-provoking question related to the pain point
- Provides 2-3 insights that answer the question
- Uses "What if..." or "Why do..." or "How can..." format
- Optimized for AI search engines (clear Q&A structure)
- Includes supporting statistics
- Ends with a call to discuss or share thoughts
- Engaging, conversational tone
- 150-200 words`
  },
  'case-study': {
    name: 'Case Study',
    description: 'Problem -> Approach -> Impact analysis format',
    prompt: `Write a case study-style LinkedIn post that:
- Challenge: Describe the agency's specific challenge with real data
- Approach: Explain what smart contractors are doing to address it (industry perspective, not a pitch)
- Impact: Share what outcomes agencies are seeing or could see
- Uses clear section headers or emojis
- Includes relevant statistics
- Demonstrates deep knowledge of the problem space
- Professional, analytical tone
- 200-250 words`
  },
  'thought-leadership': {
    name: 'Thought Leadership',
    description: 'Industry insight with forward-looking perspective',
    prompt: `Write a thought leadership LinkedIn post that:
- Provides unique industry perspective on the pain point
- Discusses trends and future implications
- Positions you as an expert/advisor
- References current events or recent reports
- Offers actionable insights
- Avoids sales pitch, focuses on value
- Ends with invitation to connect or discuss
- Authoritative, visionary tone
- 250-300 words`
  },
  'list-tips': {
    name: 'List/Tips',
    description: 'Numbered insights or actionable recommendations',
    prompt: `Write a list-based LinkedIn post that:
- Opens with context for why this matters (1-2 lines)
- Provides 3-5 numbered tips or insights
- CRITICAL MOBILE FORMATTING: Each numbered item must be ONE single line only (no sub-bullets, no multi-line items)
- Keep each tip to 10-15 words max
- Relates to agency pain points and priorities
- Easy to scan and share on mobile
- Ends with "Which resonates with you?" or similar
- Clear, helpful tone
- 150-200 words

FORMATTING EXAMPLE:
[Hook statement about the topic]

[Brief context - 1 sentence]

1. [Tip in one line]
2. [Tip in one line]
3. [Tip in one line]
4. [Tip in one line]
5. [Tip in one line]

[Closing question or call-to-action]`
  },
  'contrarian': {
    name: 'Contrarian Take',
    description: 'Challenges common assumptions with fresh perspective',
    prompt: `Write a contrarian LinkedIn post that:
- Starts by challenging a common belief or approach
- Uses "Everyone says X, but..." or "Unpopular opinion:" format
- Backs up the contrarian view with data
- Shows alternative perspective on agency challenges
- Remains respectful and professional
- Sparks discussion and engagement
- Ends with "Change my mind" or "Agree or disagree?"
- Bold, confident tone
- 150-250 words`
  },
  'actionable': {
    name: 'Actionable How-To',
    description: 'Step-by-step guide showing how to do something specific',
    prompt: `Write an actionable how-to LinkedIn post that:
- Opens with a compelling hook statistic or statement
- Follow with "Here's how to [solve it]:" on its own line
- Provides 3-5 numbered steps
- CRITICAL MOBILE FORMATTING: Each numbered item must be ONE single line only (no sub-bullets or multiple lines per step)
- Keep each step to 10-15 words max
- Use action verbs (Choose, Implement, Leverage, Plan, Focus, etc.)
- After all steps, add a blank line then a short conclusion (1-2 sentences)
- End with a question or call-to-action
- Helpful, empowering tone
- 150-200 words

FORMATTING EXAMPLE (follow this exactly):
70% of [X] contracts face [problem].

Here's how to avoid them.

1. [Action verb] [brief tip] - [why it works]
2. [Action verb] [brief tip] - [why it works]
3. [Action verb] [brief tip] - [why it works]
4. [Action verb] [brief tip] - [why it works]
5. [Action verb] [brief tip] - [why it works]

The result? [Benefit]. [Benefit]. [Benefit].

Want to learn more about our approach?`
  },
  'observation': {
    name: 'Observation & Insight',
    description: "Share something interesting you've noticed",
    prompt: `Write an observation-based LinkedIn post that:
- Opens with "I've noticed something interesting..."
- Describes a trend, pattern, or phenomenon you've observed
- Provides 2-3 specific examples
- Explains why this matters for government contractors
- Relates to agency behaviors or market trends
- Connects to broader implications
- Ends with question or food for thought
- Observant, curious, insightful tone
- 200-250 words`
  },
  'x-vs-y': {
    name: 'X vs. Y Comparison',
    description: 'Compare two situations for interesting insights',
    prompt: `Write a comparison LinkedIn post that:
- Opens by setting up the comparison (X vs. Y)
- Uses side-by-side structure or clear sections
- Compares 3-4 key differences or similarities
- Provides unexpected insights from the comparison
- Relates to agency contracting or business strategies
- Uses specific examples for each side
- Ends with which is better or key lesson
- Analytical, balanced, insightful tone
- 250-300 words`
  },
  'listicle': {
    name: 'Listicle',
    description: 'Curated list of resources, tools, or recommendations',
    prompt: `Write a listicle LinkedIn post that:
- Opens with context for the list
- Provides 3-7 items in numbered format
- Each item has brief but specific description
- Items are genuinely valuable and relevant
- Mix of well-known and lesser-known items
- Ends with invitation to add to the list
- Helpful, generous tone
- 200-300 words`
  }
};

// Call Grok API
async function callGrokAPI(prompt: string, systemPrompt: string | null = null, maxTokens: number = 2000, temperature: number = 0.7): Promise<string> {
  if (!GROK_API_KEY) {
    throw new Error('GROK_API_KEY not configured');
  }

  const messages: { role: string; content: string }[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  messages.push({ role: 'user', content: prompt });

  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Grok API Error:', error);
    console.error('Grok API Status:', response.status);
    console.error('Grok API Key present:', !!GROK_API_KEY);
    throw new Error(`Grok API Error (${response.status}): ${error.substring(0, 200)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Main POST handler
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      targetAgencies = [],
      numPosts = 3,
      geoBoost = true,
      templates = [],
      companyProfile = {}
    } = body;

    console.log(`[Content Generator] Request for ${numPosts} posts, agencies:`, targetAgencies);

    if (!GROK_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'Content generation service not configured'
      }, { status: 500, headers: corsHeaders });
    }

    if (targetAgencies.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Please select at least one target agency'
      }, { status: 400, headers: corsHeaders });
    }

    // Build company profile data
    const enhancedCompanyData = {
      companyName: companyProfile.companyName || '',
      userRole: companyProfile.userRole || '',
      coreServices: companyProfile.coreServices || '',
      differentiators: companyProfile.differentiators || '',
      certifications: companyProfile.certifications || '',
      contractVehicles: companyProfile.contractVehicles || '',
      pastPerformance: companyProfile.pastPerformance || '',
      naicsCodes: companyProfile.naicsCodes || []
    };

    // STEP 1: Get agency pain points and spending priorities
    console.log('[Step 1] Identifying agency pain points and priorities...');
    const agencyPainPoints: { agency: string; painPoints: string[]; priorities: string[]; categorized: ReturnType<typeof categorizePainPoints> }[] = [];

    for (const agencyName of targetAgencies) {
      const painPoints = getPainPointsForAgency(agencyName);
      const priorities = getPrioritiesForAgency(agencyName);
      agencyPainPoints.push({
        agency: agencyName,
        painPoints: painPoints,
        priorities: priorities,
        categorized: categorizePainPoints(painPoints)
      });
    }

    // Build company profile section for prompts
    const companyProfileSection = `
AUTHOR PROFILE (Use this to establish credibility — NOT to pitch services):
${enhancedCompanyData.companyName ? `- Company: ${enhancedCompanyData.companyName}` : ''}
${enhancedCompanyData.userRole ? `- Author Role: ${enhancedCompanyData.userRole}` : ''}
${enhancedCompanyData.coreServices ? `- Areas of Expertise: ${enhancedCompanyData.coreServices}` : ''}
${enhancedCompanyData.differentiators ? `- Unique Perspective: ${enhancedCompanyData.differentiators}` : ''}
${enhancedCompanyData.certifications ? `- Credentials: ${enhancedCompanyData.certifications}` : ''}
${enhancedCompanyData.contractVehicles ? `- Contract Vehicles: ${enhancedCompanyData.contractVehicles}` : ''}
${enhancedCompanyData.pastPerformance ? `- Experience: ${enhancedCompanyData.pastPerformance}` : ''}
`.trim();

    // STEP 2: Generate content angles
    console.log('[Step 2] Generating content angles...');

    // Pick 3 random content lenses to inject variety each generation
    const selectedLenses = shuffleArray(CONTENT_LENSES).slice(0, 3);

    const step2Prompt = `You are a government contracting expert creating LinkedIn content for a SPECIFIC COMPANY.

${companyProfileSection}

AGENCY PAIN POINTS (problems the agency struggles with):
${agencyPainPoints.map(ap => `
${ap.agency}:
${shuffleArray(ap.painPoints).slice(0, 7).map(p => `- ${p}`).join('\n')}
`).join('\n---\n')}

AGENCY SPENDING PRIORITIES (where the money is actively flowing):
${agencyPainPoints.map(ap => ap.priorities.length > 0 ? `
${ap.agency}:
${shuffleArray(ap.priorities).slice(0, 5).map(p => `- ${p}`).join('\n')}
` : '').filter(Boolean).join('\n---\n')}

CONTENT VARIETY DIRECTIONS (use these creative lenses to make each post unique):
- ${selectedLenses[0]}
- ${selectedLenses[1]}
- ${selectedLenses[2]}

CRITICAL: Each angle MUST use a completely different hook style, different pain point, and different narrative approach. Do NOT reuse similar openings, structures, or talking points across angles. Vary between personal stories, data-driven insights, provocative questions, and actionable tips.

TASK: Create THOUGHT LEADERSHIP content angles that:
1. Demonstrate deep insider knowledge of agency challenges, spending priorities, and how federal procurement actually works
2. Position the author as a trusted expert who UNDERSTANDS government — NOT someone pitching services
3. Attract government decision makers (contracting officers, program managers, agency leaders) by speaking their language and addressing their real concerns
4. Mix pain point angles (problems agencies face) with spending priority angles (where money flows) — aim for roughly half of each
5. Use authoritative language with specific numbers ("$9.1B allocated for...", "According to GAO...", "DoD's FY2026 budget...")
6. Show the author's expertise through INSIGHT, not through selling — the reader should think "this person really understands our challenges"
${geoBoost ? `7. Optimize for AI/search with clear questions and answers (GEO technique)` : ''}

Generate ${numPosts} distinct content angles. For each angle, provide:
- Main theme/hook
- Key pain point or priority to address
- 2-3 relevant talking points
- Expert insight that demonstrates deep understanding of this issue
- Suggested structure (question format, list format, story format, etc.)

Output as JSON array with this structure:
[
  {
    "angle": "theme description",
    "painPoint": "specific pain point or priority",
    "talkingPoints": ["point 1", "point 2"],
    "solution": "expert insight or perspective on this issue",
    "structure": "suggested format"
  }
]`;

    // Scale max_tokens for angles based on post count (~200 tokens per angle)
    const anglesMaxTokens = Math.max(2000, numPosts * 250);
    console.log(`[Step 2] Using ${anglesMaxTokens} max_tokens for ${numPosts} angles, lenses: ${selectedLenses.join(' | ')}`);

    const contentAnglesResponse = await callGrokAPI(step2Prompt, null, anglesMaxTokens, 0.85);
    let angles: { angle: string; painPoint: string; talkingPoints: string[]; solution: string; structure: string }[];

    try {
      const jsonMatch = contentAnglesResponse.match(/\[[\s\S]*\]/);
      angles = JSON.parse(jsonMatch ? jsonMatch[0] : contentAnglesResponse);
    } catch {
      console.error('Failed to parse angles JSON, using fallback');
      console.error('Raw response length:', contentAnglesResponse.length);
      angles = [{
        angle: "Agency modernization challenges",
        painPoint: agencyPainPoints[0]?.painPoints[0] || "General agency pain point",
        talkingPoints: ["Referenced from agency data"],
        solution: "Our expertise addresses this need",
        structure: "list format"
      }];
    }

    console.log(`[Step 2] Got ${angles.length} angles for ${numPosts} requested posts`);

    // STEP 3: Write posts with templates (parallelized in batches)
    console.log('[Step 3] Writing posts with templates...');

    // Determine which templates to use
    let templatesToUse = templates.length > 0 ? templates : ['actionable', 'observation', 'x-vs-y', 'stat-heavy', 'question-based'];

    // Cycle templates if needed
    if (numPosts > templatesToUse.length) {
      const originalTemplates = [...templatesToUse];
      while (templatesToUse.length < numPosts) {
        templatesToUse.push(...originalTemplates);
      }
    }
    templatesToUse = templatesToUse.slice(0, numPosts);

    const postCount = Math.min(angles.length, numPosts);

    // Build all post generation tasks
    const generatePost = async (i: number) => {
      const angle = angles[i];
      const templateKey = templatesToUse[i] || 'question-based';
      const template = POST_TEMPLATES[templateKey] || POST_TEMPLATES['question-based'];

      const authorIdentity = enhancedCompanyData.companyName
        ? `${enhancedCompanyData.userRole || 'a leader'} at ${enhancedCompanyData.companyName}`
        : 'a government contractor';

      const step3Prompt = `Write a LinkedIn post as ${authorIdentity}.

${companyProfileSection}

CONTENT ANGLE:
Theme: ${angle.angle}
Pain Point: ${angle.painPoint}
Talking Points: ${angle.talkingPoints.join('; ')}
Solution: ${angle.solution}

TEMPLATE STYLE: ${template.name}
${template.prompt}

PERSONALIZATION REQUIREMENTS:
${enhancedCompanyData.companyName ? `- Write from the perspective of someone at ${enhancedCompanyData.companyName}` : ''}
${enhancedCompanyData.coreServices ? `- Subtly reference expertise in: ${enhancedCompanyData.coreServices} (through demonstrated knowledge, NOT by pitching services)` : ''}
${enhancedCompanyData.differentiators ? `- Let differentiators come through as expertise, not as a sales pitch: ${enhancedCompanyData.differentiators}` : ''}
${enhancedCompanyData.certifications ? `- Mention certifications only when they add credibility to the insight: ${enhancedCompanyData.certifications}` : ''}

THOUGHT LEADERSHIP TONE:
- Write as an INDUSTRY EXPERT sharing insights — NOT as a vendor pitching services
- The goal is to attract government decision makers who think "this person really gets our challenges"
- Show deep understanding of how federal agencies operate, what they struggle with, and where money flows
- NEVER say "we can help" or "our services" or "contact us" — instead, share knowledge that makes the reader want to connect
- Use a professional, conversational tone
- Use line breaks for readability
- Start with a COMPELLING HOOK that captures attention
- The hook should be the FIRST LINE and must be engaging
${geoBoost && templateKey !== 'question-based' ? '- Optimize for AI search with clear structure' : ''}
- End with a question or invitation to discuss (NOT a sales CTA)
- DO NOT be generic - every post should feel personalized
- Include 3-5 relevant hashtags at the end

CRITICAL MOBILE FORMATTING RULES (LinkedIn mobile breaks multi-line list items):
- For numbered lists: Each number must be on ONE LINE ONLY (no sub-points under numbers)
- NO indented text under numbered items
- Keep list items short (under 15 words each)
- Use blank lines between sections, not within list items
- Separate hashtags with spaces, not commas

Output ONLY the post text, followed by hashtags on separate lines (separated by spaces not commas).`;

      const postContent = await callGrokAPI(step3Prompt, null);

      // Extract hashtags (handles both comma and space separated)
      const hashtagMatch = postContent.match(/#[\w]+/g);
      const hashtags = hashtagMatch || [];
      // Remove hashtags, markdown formatting, and clean up whitespace
      const postText = postContent
        .replace(/#[\w]+/g, '')
        .replace(/\*\*/g, '')           // Remove bold markdown **
        .replace(/\*/g, '')             // Remove italic markdown *
        .replace(/__/g, '')             // Remove bold markdown __
        .replace(/_([^_]+)_/g, '$1')    // Remove italic markdown _text_
        .replace(/,\s*,/g, '')
        .replace(/[ \t]+/g, ' ')        // Collapse multiple spaces (not newlines)
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      return {
        angle: angle.angle,
        template: template.name,
        templateKey: templateKey,
        content: postText,
        hashtags: hashtags,
        painPointAddressed: angle.painPoint,
        talkingPoints: angle.talkingPoints
      };
    };

    // Generate posts in parallel batches of 5
    const BATCH_SIZE = 5;
    const posts: {
      angle: string;
      template: string;
      templateKey: string;
      content: string;
      hashtags: string[];
      painPointAddressed: string;
      talkingPoints: string[];
    }[] = [];

    for (let batchStart = 0; batchStart < postCount; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, postCount);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, j) => batchStart + j);
      console.log(`[Step 3] Generating batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: posts ${batchStart + 1}-${batchEnd}`);
      const batchResults = await Promise.all(batchIndices.map(i => generatePost(i)));
      posts.push(...batchResults);
    }

    console.log(`[Content Generator] Generated ${posts.length} posts`);

    return NextResponse.json({
      success: true,
      posts: posts,
      metadata: {
        targetAgencies: targetAgencies,
        geoOptimized: geoBoost,
        model: 'grok',
        modelId: GROK_MODEL
      }
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[Content Generator] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate content'
    }, { status: 500, headers: corsHeaders });
  }
}
