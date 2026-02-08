import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3';

type GraphicType = 'quote' | 'highlight';

const prompts: Record<GraphicType, string> = {
  quote: `Extract or create a powerful, shareable quote from this LinkedIn post. The quote should be:
- 1-2 sentences max
- Inspirational or thought-provoking
- Suitable for a quote graphic
- Capture the essence of the post

Return ONLY valid JSON: {"quote": "the quote text"}`,

  highlight: `Extract a powerful quote from this LinkedIn post AND identify 2-3 key words or short phrases in the quote that should be visually highlighted.

Return ONLY valid JSON: {"quote": "the full quote text", "highlights": ["key word", "another phrase"]}

Rules:
- Quote should be 1-2 sentences, capture the essence of the post
- highlights should be 2-3 individual words or 2-word phrases FROM the quote
- Choose words that are emotionally impactful or represent the core message`
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const { postContent, type } = await request.json();

    if (!postContent) {
      return NextResponse.json({
        success: false,
        error: 'Post content is required'
      }, { status: 400, headers: corsHeaders });
    }

    const graphicType = (type || 'quote') as GraphicType;
    if (!prompts[graphicType]) {
      return NextResponse.json({
        success: false,
        error: `Invalid graphic type: ${type}`
      }, { status: 400, headers: corsHeaders });
    }

    if (!GROK_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'API not configured'
      }, { status: 500, headers: corsHeaders });
    }

    const prompt = `${prompts[graphicType]}

Post content:
${postContent}`;

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
        max_tokens: 400
      })
    });

    if (!response.ok) {
      throw new Error('Failed to generate graphic content');
    }

    const data = await response.json();
    const rawContent = data.choices[0].message.content.trim();

    // Parse JSON from the AI response
    let parsed;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      // Fallback — return raw text as quote
      if (graphicType === 'quote') {
        parsed = { quote: rawContent.replace(/^["']|["']$/g, '') };
      } else if (graphicType === 'highlight') {
        const cleanQuote = rawContent.replace(/^["']|["']$/g, '');
        const words = cleanQuote.split(' ').filter((w: string) => w.length > 4);
        parsed = { quote: cleanQuote, highlights: words.slice(0, 3) };
      } else {
        console.error('Failed to parse AI response:', rawContent);
        throw new Error('Failed to parse graphic content');
      }
    }

    return NextResponse.json({
      success: true,
      type: graphicType,
      data: parsed
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Graphic generation error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to generate graphic content'
    }, { status: 500, headers: corsHeaders });
  }
}
