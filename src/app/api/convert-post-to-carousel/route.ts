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
    const { postContent, slideCount = 5 } = await request.json();

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

    // Groq → Claude → OpenAI → Grok fallback chain (no single-provider failure).
    const { text: content } = await callLLM({
      system: 'You convert LinkedIn posts into carousel slide formats.',
      user: prompt,
      maxTokens: 2000,
      temperature: 0.7,
      job: 'drafting',
    });

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
