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

    if (!hasLLMProvider()) {
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

    // Groq → Claude → OpenAI → Grok fallback chain (no single-provider failure).
    const { text } = await callLLM({
      system: 'You extract powerful, shareable quotes from LinkedIn posts.',
      user: prompt,
      maxTokens: 200,
      temperature: 0.7,
      job: 'drafting',
    });
    const quote = text.trim().replace(/^["']|["']$/g, '');

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
