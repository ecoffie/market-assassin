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
    const { postContent } = await request.json();

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

    const prompt = `Extract or create a powerful, shareable quote from this LinkedIn post. The quote should be:
- 1-2 sentences max
- Inspirational or thought-provoking
- Suitable for a quote graphic
- Capture the essence of the post

Post content:
${postContent}

Return just the quote text, nothing else.`;

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
        max_tokens: 200
      })
    });

    if (!response.ok) {
      throw new Error('Failed to generate quote');
    }

    const data = await response.json();
    const quote = data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');

    return NextResponse.json({
      success: true,
      quote: quote
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Quote generation error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to generate quote'
    }, { status: 500, headers: corsHeaders });
  }
}
