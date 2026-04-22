import { NextRequest, NextResponse } from 'next/server';
import { getPainPointsForAgency, getPrioritiesForAgency, categorizePainPoints } from '@/lib/utils/pain-points';
import { getBudgetForAgency } from '@/lib/utils/budget-authority';
import { checkContentRateLimit, checkIPRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { trackGeneration } from '@/lib/abuse-detection';
import { humanizePost, trimPost, getPostMetrics, POST_LENGTH_LIMITS } from '@/lib/utils/humanize-post';
import { logToolError, recordToolSuccess, ToolNames, classifyError, AIProviders } from '@/lib/tool-errors';

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

// LinkedIn optimal post length (based on 2026 engagement research):
// - Sweet spot: 1,200-1,600 characters (~200-270 words)
// - First 210 chars are critical (visible before "See more")
// - Under 500 chars = flagged as low-effort
// - Over 1,900 chars = completion rate drops significantly
const POST_LENGTH = {
  MIN_CHARS: 800,
  TARGET_CHARS: 1400,
  MAX_CHARS: 1700,
  MIN_WORDS: 140,
  TARGET_WORDS: 230,
  MAX_WORDS: 280,
  HOOK_CHARS: 200, // First 200 chars must be compelling
};

// Post Templates - ALL updated with strict character/word limits
const POST_TEMPLATES: Record<string, { name: string; description: string; prompt: string }> = {
  'story-driven': {
    name: 'Story-Driven',
    description: 'Personal narrative connecting your experience to agency challenges',
    prompt: `Write a story-based LinkedIn post that:
- Opens with ONE relatable scenario in 1-2 sentences (max 50 words)
- Connects to the agency pain point in the next 2-3 sentences
- Shares ONE clear lesson or insight (not multiple)
- Ends with ONE thought-provoking question
- TOTAL: 180-240 words / 1,100-1,500 characters
- BE CONCISE: Every sentence must earn its place`
  },
  'stat-heavy': {
    name: 'Data-Driven',
    description: 'Statistics-focused post with hard numbers and sources',
    prompt: `Write a data-heavy LinkedIn post that:
- Opens with ONE striking statistic (hook in under 15 words)
- Provides 3 key data points (not 4+)
- Uses short bullet points (8-12 words each)
- ONE sentence connecting numbers to impact
- Ends with a brief observation (1 sentence)
- TOTAL: 150-200 words / 900-1,300 characters
- NO fluff or filler words`
  },
  'question-based': {
    name: 'Question-Based',
    description: 'Starts with provocative question (GEO optimized)',
    prompt: `Write a question-based LinkedIn post that:
- Opens with ONE provocative question (under 20 words)
- Provides 2-3 brief insights (2-3 sentences each)
- Ends with call to discuss
- TOTAL: 140-180 words / 850-1,150 characters
- Keep answers punchy, not exhaustive`
  },
  'case-study': {
    name: 'Case Study',
    description: 'Problem -> Approach -> Impact analysis format',
    prompt: `Write a case study-style LinkedIn post that:
- Challenge: 2 sentences with one key stat
- Approach: 2-3 sentences on what works
- Impact: 1-2 sentences on outcomes
- TOTAL: 160-220 words / 1,000-1,400 characters
- NO long preambles or conclusions`
  },
  'thought-leadership': {
    name: 'Thought Leadership',
    description: 'Industry insight with forward-looking perspective',
    prompt: `Write a thought leadership LinkedIn post that:
- Opens with a bold claim or observation (1 sentence)
- Provides 2-3 supporting points
- Offers ONE actionable insight
- Ends with invitation to discuss
- TOTAL: 180-250 words / 1,100-1,600 characters
- Authoritative but concise`
  },
  'list-tips': {
    name: 'List/Tips',
    description: 'Numbered insights or actionable recommendations',
    prompt: `Write a list-based LinkedIn post:
- Hook: 1 sentence (under 20 words)
- Context: 1 sentence
- 4-5 tips (ONE line each, 8-12 words max per tip)
- Closing question: 1 sentence
- TOTAL: 130-170 words / 800-1,100 characters

EXACT FORMAT:
[Hook - one punchy line]

[One sentence of context]

1. [Tip in 8-12 words]
2. [Tip in 8-12 words]
3. [Tip in 8-12 words]
4. [Tip in 8-12 words]

[Closing question]`
  },
  'contrarian': {
    name: 'Contrarian Take',
    description: 'Challenges common assumptions with fresh perspective',
    prompt: `Write a contrarian LinkedIn post that:
- Opens with "Unpopular opinion:" or "Everyone says X, but..."
- States the contrarian view clearly (1-2 sentences)
- Backs it up with 2-3 points (brief)
- Ends with "Change my mind?" or similar
- TOTAL: 140-200 words / 850-1,300 characters
- Be bold but not verbose`
  },
  'actionable': {
    name: 'Actionable How-To',
    description: 'Step-by-step guide showing how to do something specific',
    prompt: `Write an actionable how-to LinkedIn post:
- Hook stat/statement: 1 sentence (under 20 words)
- "Here's how:" on its own line
- 4-5 steps (ONE line each, 10-15 words max)
- Result statement: 1-2 sentences
- TOTAL: 140-180 words / 850-1,150 characters

EXACT FORMAT:
[Stat or bold claim - one line]

Here's how to fix it:

1. [Action verb] [brief tip]
2. [Action verb] [brief tip]
3. [Action verb] [brief tip]
4. [Action verb] [brief tip]

[One sentence on the result]`
  },
  'observation': {
    name: 'Observation & Insight',
    description: "Share something interesting you've noticed",
    prompt: `Write an observation LinkedIn post that:
- Opens with "I've noticed..." or similar (1 sentence)
- Describes the pattern/trend (2-3 sentences)
- Provides 2 specific examples (brief)
- Ends with why it matters + question
- TOTAL: 160-220 words / 1,000-1,400 characters
- Observant and curious, not preachy`
  },
  'x-vs-y': {
    name: 'X vs. Y Comparison',
    description: 'Compare two situations for interesting insights',
    prompt: `Write a comparison LinkedIn post:
- Sets up comparison in 1-2 sentences
- 3 key differences (2-3 sentences each, not more)
- Ends with which is better or key lesson
- TOTAL: 180-240 words / 1,100-1,500 characters
- Analytical but tight`
  },
  'listicle': {
    name: 'Listicle',
    description: 'Curated list of resources, tools, or recommendations',
    prompt: `Write a listicle LinkedIn post:
- Context: 1-2 sentences
- 4-6 items (2-3 sentences each, max)
- Ends with "What would you add?"
- TOTAL: 170-230 words / 1,050-1,450 characters
- Helpful and generous, not exhaustive`
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
      numPosts: rawNumPosts = 3,
      geoBoost = true,
      templates = [],
      companyProfile = {},
      userEmail = '',
      previousAngles: rawPreviousAngles = []
    } = body;

    // Sanitize previousAngles: cap at 50 entries, strings only
    const previousAngles: string[] = (Array.isArray(rawPreviousAngles) ? rawPreviousAngles : [])
      .filter((a: unknown) => typeof a === 'string' && a.length > 0)
      .slice(0, 50);

    // Cap numPosts at 30 max
    const numPosts = Math.min(Math.max(1, Number(rawNumPosts) || 3), 30);

    // Rate limiting: email-based if available, IP fallback
    if (userEmail) {
      const rl = await checkContentRateLimit(userEmail);
      if (!rl.allowed) return rateLimitResponse(rl);
      trackGeneration(userEmail);
    } else {
      const ip = getClientIP(request);
      const rl = await checkIPRateLimit(ip);
      if (!rl.allowed) return rateLimitResponse(rl);
    }

    console.log(`[Content Reaper] Request for ${numPosts} posts, agencies:`, targetAgencies, `| ${previousAngles.length} previous angles`);

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

    // STEP 1: Get agency pain points, spending priorities, and budget trends
    console.log('[Step 1] Identifying agency pain points, priorities, and budget trends...');
    const agencyPainPoints: { agency: string; painPoints: string[]; priorities: string[]; categorized: ReturnType<typeof categorizePainPoints> }[] = [];
    const budgetTrends: string[] = [];

    for (const agencyName of targetAgencies) {
      const painPoints = getPainPointsForAgency(agencyName);
      const priorities = getPrioritiesForAgency(agencyName);
      agencyPainPoints.push({
        agency: agencyName,
        painPoints: painPoints,
        priorities: priorities,
        categorized: categorizePainPoints(painPoints)
      });

      // Lookup FY2025 vs FY2026 budget trend
      const budget = getBudgetForAgency(agencyName);
      if (budget) {
        const pctChange = ((budget.change.percent - 1) * 100).toFixed(1);
        const fy25 = (budget.fy2025.budgetAuthority / 1e9).toFixed(1);
        const fy26 = (budget.fy2026.budgetAuthority / 1e9).toFixed(1);
        budgetTrends.push(
          `${agencyName}: FY2025 $${fy25}B → FY2026 $${fy26}B (${budget.change.percent >= 1 ? '+' : ''}${pctChange}%, trend: ${budget.change.trend})`
        );
      }
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

${budgetTrends.length > 0 ? `FY2026 BUDGET TRENDS (use these real numbers to add authority and timeliness):
${budgetTrends.map(t => `- ${t}`).join('\n')}
Source: OMB FY2026 Discretionary Budget Request. Reference these numbers naturally — e.g., "With DoD's budget growing 13% to $962B..." or "As HHS faces a 26% budget cut..."
` : ''}
CONTENT VARIETY DIRECTIONS (use these creative lenses to make each post unique):
- ${selectedLenses[0]}
- ${selectedLenses[1]}
- ${selectedLenses[2]}

${previousAngles.length > 0 ? `PREVIOUSLY GENERATED CONTENT — DO NOT REPEAT:
The user has already generated posts with these angles. You MUST create completely NEW and DIFFERENT angles:
${previousAngles.map(a => `- ${a}`).join('\n')}

Create fresh perspectives that cover DIFFERENT pain points, use DIFFERENT hooks, and take DIFFERENT approaches than the above.
` : ''}CRITICAL: Each angle MUST use a completely different hook style, different pain point, and different narrative approach. Do NOT reuse similar openings, structures, or talking points across angles. Vary between personal stories, data-driven insights, provocative questions, and actionable tips.

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
- Use a professional, conversational tone — like a real person writing on LinkedIn, not an AI
- Use line breaks for readability
- Start with a COMPELLING HOOK that captures attention (first 200 characters are critical!)
- The hook should be the FIRST LINE and must be engaging

**STRICT LENGTH REQUIREMENTS** (LinkedIn algorithm penalizes too-short AND too-long posts):
- TOTAL POST: 150-250 words / 900-1,600 characters (including hashtags)
- First line (hook): Under 20 words, compelling enough to stop scrolling
- Every sentence must add value — cut fluff ruthlessly
- If you find yourself writing "Furthermore," "Additionally," or "Moreover" — DELETE that sentence
- Numbered lists: 4-5 items MAX, each item ONE line only
- NO long preambles, NO lengthy conclusions — get in, make the point, get out

SOUND HUMAN — AVOID THESE AI PATTERNS:
- NEVER start with "In today's landscape/world/environment" or "In the ever-changing world of"
- NEVER use "Let's dive in", "Here's the thing", "Picture this", "Imagine this"
- NEVER use "It's worth noting", "Needless to say", "At the end of the day"
- NEVER use filler closers like "Let that sink in", "Read that again", "Full stop", "Period"
- AVOID overused buzzwords: seamless, leverage, utilize, robust, holistic, synergy, paradigm shift, game-changing, cutting-edge, groundbreaking, transformative
- LIMIT dashes (-- or —) to at most ONE per post. Use commas, colons, or periods instead
- Write like a human who has REAL experience, not like an AI summarizing a topic
- Vary your sentence length — mix short punchy lines with longer explanations
- Use contractions naturally (don't, won't, it's, they're)

TEXT FORMATTING (use markdown):
- Use **bold** for section headers, key terms, and important phrases (e.g. **Zero Trust Architecture**)
- Use *italic* for tips, warnings, asides, and emphasis (e.g. *This is often overlooked.*)
- Every post should have at least 2-3 bold phrases and 1-2 italic phrases for visual variety
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

      // Use lower max_tokens to encourage concise output (target ~250 words = ~350 tokens)
      const postContent = await callGrokAPI(step3Prompt, null, 600, 0.7);

      // Extract hashtags (handles both comma and space separated)
      const hashtagMatch = postContent.match(/#[\w]+/g);
      const hashtags = hashtagMatch || [];
      // Remove hashtags and clean up whitespace (preserve markdown bold/italic for .docx export)
      const rawText = postContent
        .replace(/#[\w]+/g, '')
        .replace(/,\s*,/g, '')
        .replace(/^[ \t]+/gm, '')       // Left-justify: strip leading spaces from every line
        .replace(/[ \t]+/g, ' ')        // Collapse multiple spaces (not newlines)
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      // Humanize: strip AI patterns (filler openers, buzzwords, robotic phrases)
      let postText = humanizePost(rawText);

      // Trim if too long (preserve readability by cutting at sentence/paragraph boundaries)
      if (postText.length > POST_LENGTH_LIMITS.MAX_CHARS) {
        postText = trimPost(postText, POST_LENGTH_LIMITS.MAX_CHARS);
      }

      // Get metrics for the post
      const metrics = getPostMetrics(postText);

      return {
        angle: angle.angle,
        template: template.name,
        templateKey: templateKey,
        content: postText,
        hashtags: hashtags,
        painPointAddressed: angle.painPoint,
        talkingPoints: angle.talkingPoints,
        metrics: {
          chars: metrics.chars,
          words: metrics.words,
          status: metrics.status
        }
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
      metrics: { chars: number; words: number; status: string };
    }[] = [];

    for (let batchStart = 0; batchStart < postCount; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, postCount);
      const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, j) => batchStart + j);
      console.log(`[Step 3] Generating batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: posts ${batchStart + 1}-${batchEnd}`);
      const batchResults = await Promise.all(batchIndices.map(i => generatePost(i)));
      posts.push(...batchResults);
    }

    console.log(`[Content Reaper] Generated ${posts.length} posts`);

    // Auto-persist generated posts to content_library (non-blocking)
    if (userEmail && posts.length > 0) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          const rows = posts.map((post) => ({
            user_email: userEmail.toLowerCase().trim(),
            title: post.template,
            content: post.content,
            post_type: 'linkedin',
            tags: post.hashtags,
            template_key: post.templateKey,
            angle: post.angle,
            pain_point: post.painPointAddressed,
            target_agencies: targetAgencies,
            created_at: new Date().toISOString(),
          }));
          // Fire and forget — don't block the response
          supabase.from('content_library').insert(rows).then(({ error }) => {
            if (error) {
              console.warn('[Content Reaper] Full auto-save failed, trying basic columns:', error.message);
              // Retry with only basic columns (table may not have new columns yet)
              const basicRows = posts.map((post) => ({
                user_email: userEmail.toLowerCase().trim(),
                title: post.template,
                content: post.content,
                post_type: 'linkedin',
                tags: post.hashtags,
                created_at: new Date().toISOString(),
              }));
              supabase.from('content_library').insert(basicRows).then(({ error: err2 }) => {
                if (err2) console.error('[Content Reaper] Basic auto-save also failed:', err2.message);
                else console.log(`[Content Reaper] Auto-saved ${basicRows.length} posts (basic columns) for ${userEmail}`);
              });
            } else {
              console.log(`[Content Reaper] Auto-saved ${rows.length} posts for ${userEmail}`);
            }
          });
        }
      } catch (saveErr) {
        console.error('[Content Reaper] Auto-save failed (non-fatal):', saveErr);
      }
    }

    // Record successful generation for monitoring
    recordToolSuccess(ToolNames.CONTENT_REAPER).catch(() => {});

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
    console.error('[Content Reaper] Error:', error);

    // Log error to monitoring dashboard
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate content';
    await logToolError({
      tool: ToolNames.CONTENT_REAPER,
      errorType: classifyError(errorMessage),
      errorMessage,
      userEmail: undefined, // Could extract from request if available
      requestPath: '/api/content-generator/generate',
      aiProvider: AIProviders.GROQ,
      aiModel: GROK_MODEL,
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    // Check for rate limit error (429) and provide user-friendly message
    const isRateLimit = errorMessage.includes('429') ||
                        errorMessage.includes('exhausted') ||
                        errorMessage.includes('rate limit');

    if (isRateLimit) {
      return NextResponse.json({
        success: false,
        error: 'Too many agencies selected. Please select 10-20 agencies at a time for best results. The AI service has temporary limits on how many posts can be generated at once.'
      }, { status: 429, headers: corsHeaders });
    }

    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500, headers: corsHeaders });
  }
}
