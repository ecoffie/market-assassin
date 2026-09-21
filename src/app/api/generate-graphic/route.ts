import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/llm/call-llm';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// At least one LLM provider key (Groq/Claude/OpenAI/Grok) must be present.
const hasLLMProvider = () =>
  !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GROK_API_KEY);

type GraphicType = 'quote' | 'highlight';

const prompts: Record<GraphicType, string> = {
  quote: `Extract or create a powerful, shareable quote from this LinkedIn post for a visual graphic card.

RANDOMLY pick ONE of these formats (vary it each time — do NOT always use the same style):
- A bold phrase or fragment (3-8 words): "Zero Trust Isn't Optional Anymore"
- A punchy question: "What if your biggest competitor is already inside the agency?"
- A stat-driven hook: "73% of contracts are won before the RFP drops."
- A contrarian take: "Stop chasing SAM.gov. Start chasing relationships."
- A full sentence insight (1 sentence max): "The contractors who win aren't the cheapest — they're the most trusted."

Rules:
- Keep it under 15 words
- Make it visually striking on a quote card
- Capture the core insight of the post
- Do NOT default to full sentences every time — mix it up

Return ONLY valid JSON: {"quote": "the quote text"}`,

  highlight: `Extract a powerful quote from this LinkedIn post AND identify 2-3 key words or short phrases to visually highlight.

RANDOMLY pick ONE of these quote formats (vary it — do NOT always use full sentences):
- A bold phrase or fragment (3-8 words)
- A punchy question
- A stat-driven hook with a number
- A contrarian take
- A full sentence insight (1 sentence max)

Return ONLY valid JSON: {"quote": "the full quote text", "highlights": ["key word", "another phrase"]}

Rules:
- Quote should be under 15 words and capture the essence of the post
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

    if (!hasLLMProvider()) {
      return NextResponse.json({
        success: false,
        error: 'API not configured'
      }, { status: 500, headers: corsHeaders });
    }

    const prompt = `${prompts[graphicType]}

Post content:
${postContent}`;

    // Groq → Claude → OpenAI → Grok fallback chain (no single-provider failure).
    const { text } = await callLLM({
      system: 'You craft striking quotes and highlights for visual graphic cards.',
      user: prompt,
      maxTokens: 400,
      temperature: 0.9,
      job: 'drafting',
    });
    const rawContent = text.trim();

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
