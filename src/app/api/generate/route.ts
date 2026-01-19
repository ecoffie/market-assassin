import { NextRequest, NextResponse } from 'next/server';
import { getPainPointsForAgency, categorizePainPoints } from '@/lib/utils/pain-points';

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
- Shows empathy and understanding
- Transitions to how your solution helps
- Ends with a thought-provoking question or call-to-action
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
- Ends with how your capabilities address the data
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
    description: 'Problem -> Solution -> Result format',
    prompt: `Write a case study-style LinkedIn post that:
- Problem: Describe the agency's specific challenge
- Solution: Explain your approach or capability
- Result: Share expected outcomes or impact
- Uses clear section headers or emojis
- Includes relevant statistics
- Shows concrete value proposition
- Professional, results-oriented tone
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
- Opens with context for why this matters
- Provides 3-5 numbered tips or insights
- Each point is actionable and specific
- Relates to agency pain points and priorities
- Includes mini-statistics within tips
- Easy to scan and share
- Ends with "Which resonates with you?" or similar
- Clear, helpful tone
- 200-250 words`
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
- Opens with the problem or goal ("Want to win more government contracts?")
- Provides 3-5 clear, numbered steps
- Each step is concrete and implementable
- Relates steps to agency pain points and opportunities
- Includes mini-tips or warnings within steps
- Uses action verbs (Start, Create, Build, Submit, etc.)
- Ends with encouragement to take action
- Helpful, empowering tone
- 200-300 words`
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
async function callGrokAPI(prompt: string, systemPrompt: string | null = null): Promise<string> {
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
      temperature: 0.7,
      max_tokens: 2000
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

    // STEP 1: Get agency pain points
    console.log('[Step 1] Identifying agency pain points...');
    const agencyPainPoints: { agency: string; painPoints: string[]; categorized: ReturnType<typeof categorizePainPoints> }[] = [];

    for (const agencyName of targetAgencies) {
      const painPoints = getPainPointsForAgency(agencyName);
      agencyPainPoints.push({
        agency: agencyName,
        painPoints: painPoints,
        categorized: categorizePainPoints(painPoints)
      });
    }

    // Build company profile section for prompts
    const companyProfileSection = `
COMPANY PROFILE (Use this to personalize content):
${enhancedCompanyData.companyName ? `- Company: ${enhancedCompanyData.companyName}` : ''}
${enhancedCompanyData.userRole ? `- Author Role: ${enhancedCompanyData.userRole}` : ''}
${enhancedCompanyData.coreServices ? `- Core Services: ${enhancedCompanyData.coreServices}` : ''}
${enhancedCompanyData.differentiators ? `- Differentiators: ${enhancedCompanyData.differentiators}` : ''}
${enhancedCompanyData.certifications ? `- Certifications: ${enhancedCompanyData.certifications}` : ''}
${enhancedCompanyData.contractVehicles ? `- Contract Vehicles: ${enhancedCompanyData.contractVehicles}` : ''}
${enhancedCompanyData.pastPerformance ? `- Past Performance: ${enhancedCompanyData.pastPerformance}` : ''}
`.trim();

    // STEP 2: Generate content angles
    console.log('[Step 2] Generating content angles...');
    const step2Prompt = `You are a government contracting expert creating LinkedIn content for a SPECIFIC COMPANY.

${companyProfileSection}

AGENCY PAIN POINTS & PRIORITIES:
${agencyPainPoints.map(ap => `
${ap.agency}:
Pain Points:
${ap.painPoints.slice(0, 5).map(p => `- ${p}`).join('\n')}
`).join('\n---\n')}

TASK: Create PERSONALIZED content angles that:
1. DIRECTLY connect the company's specific services to agency pain points
2. Highlight the company's differentiators
3. Reference certifications when addressing small business opportunities
4. Include relevant context from the pain points
5. Use authoritative language ("According to GAO...", "DoD reports...", etc.)
${geoBoost ? `6. Optimize for AI/search with clear questions and answers (GEO technique)` : ''}

Generate ${numPosts} distinct content angles. For each angle, provide:
- Main theme/hook
- Key pain point to address
- 2-3 relevant talking points
- How THIS SPECIFIC COMPANY'S capabilities solve this
- Suggested structure (question format, list format, story format, etc.)

Output as JSON array with this structure:
[
  {
    "angle": "theme description",
    "painPoint": "specific pain point",
    "talkingPoints": ["point 1", "point 2"],
    "solution": "how THIS COMPANY specifically helps",
    "structure": "suggested format"
  }
]`;

    const contentAnglesResponse = await callGrokAPI(step2Prompt, null);
    let angles: { angle: string; painPoint: string; talkingPoints: string[]; solution: string; structure: string }[];

    try {
      const jsonMatch = contentAnglesResponse.match(/\[[\s\S]*\]/);
      angles = JSON.parse(jsonMatch ? jsonMatch[0] : contentAnglesResponse);
    } catch {
      console.error('Failed to parse angles JSON, using fallback');
      angles = [{
        angle: "Agency modernization challenges",
        painPoint: agencyPainPoints[0]?.painPoints[0] || "General agency pain point",
        talkingPoints: ["Referenced from agency data"],
        solution: "Our expertise addresses this need",
        structure: "list format"
      }];
    }

    // STEP 3: Write posts with templates
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

    const posts: {
      angle: string;
      template: string;
      templateKey: string;
      content: string;
      hashtags: string[];
      painPointAddressed: string;
      talkingPoints: string[];
    }[] = [];

    for (let i = 0; i < Math.min(angles.length, numPosts); i++) {
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
${enhancedCompanyData.coreServices ? `- Reference the company's specific services: ${enhancedCompanyData.coreServices}` : ''}
${enhancedCompanyData.differentiators ? `- Weave in their differentiators naturally: ${enhancedCompanyData.differentiators}` : ''}
${enhancedCompanyData.certifications ? `- Mention relevant certifications when appropriate: ${enhancedCompanyData.certifications}` : ''}

ADDITIONAL REQUIREMENTS:
- Use a professional, conversational tone
- Use line breaks for readability
- Start with a COMPELLING HOOK that captures attention
- The hook should be the FIRST LINE and must be engaging
${geoBoost && templateKey !== 'question-based' ? '- Optimize for AI search with clear structure' : ''}
- End with a clear call-to-action or engagement prompt
- DO NOT be generic - every post should feel personalized
- Include 3-5 relevant hashtags at the end

Output ONLY the post text, followed by hashtags on separate lines.`;

      const postContent = await callGrokAPI(step3Prompt, null);

      // Extract hashtags
      const hashtagMatch = postContent.match(/#[\w]+/g);
      const hashtags = hashtagMatch || [];
      const postText = postContent.replace(/#[\w]+/g, '').trim();

      posts.push({
        angle: angle.angle,
        template: template.name,
        templateKey: templateKey,
        content: postText,
        hashtags: hashtags,
        painPointAddressed: angle.painPoint,
        talkingPoints: angle.talkingPoints
      });
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
