import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3';

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const { postContent, slideCount = 5 } = await request.json();

    if (!postContent) {
      return NextResponse.json({
        success: false,
        error: 'Post content is required'
      }, { status: 400, headers: corsHeaders });
    }

    if (!GROK_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'API not configured'
      }, { status: 500, headers: corsHeaders });
    }

    const prompt = `Convert this LinkedIn post into a ${slideCount}-slide carousel format. Each slide should have:
- A short, punchy title (max 8 words)
- 2-3 bullet points or a brief paragraph (max 50 words per slide)
- The content should flow logically from slide to slide

Original post:
${postContent}

Return as JSON array:
[
  { "slideNumber": 1, "title": "...", "content": "..." },
  { "slideNumber": 2, "title": "...", "content": "..." },
  ...
]

Make the first slide a hook/attention grabber and the last slide a call-to-action.`;

    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      throw new Error('Failed to generate carousel');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Parse the JSON from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const slides = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return NextResponse.json({
      success: true,
      slides: slides
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Carousel conversion error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to convert to carousel'
    }, { status: 500, headers: corsHeaders });
  }
}
