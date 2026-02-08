import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-3';

type GraphicType = 'quote' | 'stat' | 'tips' | 'hottake' | 'beforeafter';

const prompts: Record<GraphicType, string> = {
  quote: `Extract or create a powerful, shareable quote from this LinkedIn post. The quote should be:
- 1-2 sentences max
- Inspirational or thought-provoking
- Suitable for a quote graphic
- Capture the essence of the post

Return ONLY valid JSON: {"quote": "the quote text"}`,

  stat: `Extract or create a compelling statistic/number from this LinkedIn post. If the post doesn't contain a specific number, create a realistic one based on the topic.

Return ONLY valid JSON: {"number": "$82B", "label": "in federal contracts awarded annually", "context": "A brief 1-sentence supporting statement"}

Rules:
- "number" should be short (e.g. "$82B", "47%", "3,500+", "10x")
- "label" should be a short phrase explaining the number (8 words max)
- "context" should be a brief sentence providing additional context`,

  tips: `Extract 3-5 actionable tips or key points from this LinkedIn post. Frame them as a numbered list.

Return ONLY valid JSON: {"title": "Short Title (5 words max)", "tips": ["First tip here", "Second tip here", "Third tip here"]}

Rules:
- Title should be catchy and concise (5 words max)
- Each tip should be 1 short sentence (under 10 words)
- 3-5 tips total`,

  hottake: `Extract the boldest, most provocative or attention-grabbing statement from this LinkedIn post. If none exists, create one that captures the post's core message in a bold way.

Return ONLY valid JSON: {"statement": "The bold statement here"}

Rules:
- Should be 1-2 sentences max
- Should be provocative, contrarian, or eye-catching
- Should make someone stop scrolling`,

  beforeafter: `Extract a transformation or contrast from this LinkedIn post. Show a "before" state and an "after" state.

Return ONLY valid JSON: {"before": "The old/wrong way", "after": "The new/right way", "label": "Short Label (3 words max)"}

Rules:
- "before" and "after" should each be 1 short sentence (under 10 words)
- "label" should be a brief category label (e.g. "Your GovCon Strategy", "Proposal Process")
- The contrast should be clear and compelling`
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
      // Fallback for quote type — return raw text as quote
      if (graphicType === 'quote') {
        parsed = { quote: rawContent.replace(/^["']|["']$/g, '') };
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
