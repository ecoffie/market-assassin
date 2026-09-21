import { recordLlmUsage } from '@/lib/llm/usage-cost';

export type BriefingTask = 'daily' | 'weekly' | 'pursuit';
export type LlmProvider = 'groq' | 'anthropic' | 'openai';

interface RouteCandidate {
  provider: LlmProvider;
  model: string;
}

/**
 * LLM Route Configuration
 *
 * Priority order for high-volume briefings:
 * 1. Groq (Llama 3.1 70B) - ~10-50x faster than Claude, free tier available
 * 2. Claude Haiku - Fast and reliable fallback
 * 3. OpenAI GPT - Additional fallback
 *
 * For premium briefings (pursuit), Claude Opus is used for highest quality.
 */
const TASK_ROUTES: Record<BriefingTask, RouteCandidate[]> = {
  daily: [
    // PRIMARY: gpt-4o-mini. Daily briefings are HIGH-VOLUME (230 templates/day)
    // and Groq's free 70B is capped at 100K tokens/day (paid tier is CLOSED), so
    // leading with Groq fails ~daily and wastes a call before fallback. Per the
    // LLM strategy, gpt-4o-mini is the cost-sensitive primary (no daily cap,
    // ~$0.15/$0.60 per 1M, near-Claude on this task). See memory llm_provider_strategy.
    {
      provider: 'openai',
      model: process.env.BRIEFING_DAILY_PRIMARY_MODEL || 'gpt-4o-mini',
    },
    // Fallback 1: Groq 70B — fast + free WHEN it has quota left that day.
    {
      provider: 'groq',
      model: process.env.BRIEFING_DAILY_GROQ_MODEL || 'llama-3.3-70b-versatile',
    },
    // Fallback 2: Claude Haiku — only if both above fail (needs funded credits).
    {
      provider: 'anthropic',
      model: process.env.BRIEFING_DAILY_FALLBACK_MODEL || 'claude-3-5-haiku-latest',
    },
  ],
  weekly: [
    // PRIMARY: gpt-4o-mini (same reasoning as daily — Groq's daily cap makes it
    // an unreliable primary; lead with the uncapped, cheap model).
    {
      provider: 'openai',
      model: process.env.BRIEFING_WEEKLY_PRIMARY_MODEL || 'gpt-4o-mini',
    },
    // Fallback 1: Groq 70B when it has quota.
    {
      provider: 'groq',
      model: process.env.BRIEFING_WEEKLY_GROQ_MODEL || 'llama-3.3-70b-versatile',
    },
    // Fallback 2: Claude Sonnet (higher quality, needs funded credits).
    {
      provider: 'anthropic',
      model: process.env.BRIEFING_WEEKLY_FALLBACK_MODEL || 'claude-sonnet-4-20250514',
    },
  ],
  pursuit: [
    // Pursuit briefs are low-volume/high-value, so Claude quality is justified —
    // BUT only when credits are funded. Lead with the always-available providers
    // so a dead-credit Anthropic doesn't fail every call; Claude Opus is the
    // quality fallback. (Pursuit briefs are currently disabled — memory pursuit_briefs_cut.)
    {
      provider: 'openai',
      model: process.env.BRIEFING_PURSUIT_FALLBACK_MODEL || 'gpt-4o-mini',
    },
    {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
    },
    {
      provider: 'anthropic',
      model: process.env.BRIEFING_PURSUIT_PRIMARY_MODEL || 'claude-opus-4-20250514',
    },
  ],
};

function getAnthropicApiKey() {
  return process.env.BRIEFING_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
}

function getGroqApiKey() {
  return process.env.GROQ_API_KEY;
}

function hasProviderKey(provider: LlmProvider) {
  if (provider === 'groq') return !!getGroqApiKey();
  if (provider === 'anthropic') return !!getAnthropicApiKey();
  return !!process.env.OPENAI_API_KEY;
}

function getTaskRoutes(task: BriefingTask): RouteCandidate[] {
  const configured = TASK_ROUTES[task].filter((candidate) => hasProviderKey(candidate.provider));
  if (configured.length > 0) return configured;
  return TASK_ROUTES[task];
}

async function generateWithAnthropic(
  model: string,
  prompt: string,
  maxTokens: number
) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error('BRIEFING_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY not configured');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = data.content?.find((item) => item.type === 'text')?.text;
  if (!text) {
    throw new Error('Anthropic returned no text content');
  }

  void recordLlmUsage({
    tool: 'briefing_generate',
    userEmail: null,
    provider: 'claude',
    model,
    usage: {
      prompt_tokens: data.usage?.input_tokens,
      completion_tokens: data.usage?.output_tokens,
    },
  });

  return text;
}

/**
 * Generate with Groq API (Llama 3.1 70B)
 *
 * Groq is 10-50x faster than Claude, making it ideal for bulk briefing generation.
 * Uses OpenAI-compatible API format.
 */
async function generateWithGroq(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nRespond with valid JSON only.` },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000), // 30s timeout (Groq is fast)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Groq returned no message content');
  }

  void recordLlmUsage({
    tool: 'briefing_generate',
    userEmail: null,
    provider: 'groq',
    model: data.model || model,
    usage: data.usage,
  });

  return text;
}

async function generateWithOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n\nRespond with valid JSON only.` },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned no message content');
  }

  void recordLlmUsage({
    tool: 'briefing_generate',
    userEmail: null,
    provider: 'openai',
    model: data.model || model,
    usage: data.usage,
  });

  return text;
}

export async function generateBriefingJson(
  task: BriefingTask,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
) {
  const prompt = `${systemPrompt}\n\n${userPrompt}\n\nRespond with valid JSON only.`;
  const attempts = getTaskRoutes(task);
  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      const startTime = Date.now();
      console.log(`[LLMRouter] ${task}: trying ${attempt.provider}/${attempt.model}`);

      let text: string;
      switch (attempt.provider) {
        case 'groq':
          text = await generateWithGroq(attempt.model, systemPrompt, userPrompt, maxTokens);
          break;
        case 'anthropic':
          text = await generateWithAnthropic(attempt.model, prompt, maxTokens);
          break;
        case 'openai':
          text = await generateWithOpenAI(attempt.model, systemPrompt, userPrompt, maxTokens);
          break;
        default:
          throw new Error(`Unknown provider: ${attempt.provider}`);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[LLMRouter] ${task}: ${attempt.provider}/${attempt.model} succeeded in ${elapsed}ms`);

      return {
        text,
        provider: attempt.provider,
        model: attempt.model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[LLMRouter] ${task}: ${attempt.provider}/${attempt.model} failed`, error);
      failures.push(`${attempt.provider}/${attempt.model}: ${message}`);
    }
  }

  throw new Error(`All LLM providers failed for ${task}: ${failures.join(' | ')}`);
}

export function extractAndParseJSON<T>(responseText: string): T {
  let jsonStr = responseText.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
  jsonStr = jsonStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let result = '';
  let inString = false;
  let prevChar = '';

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    }

    result += (char === '\n' && inString) ? ' ' : char;
    prevChar = (char === '\\' && prevChar === '\\') ? '' : char;
  }

  jsonStr = result;

  try {
    return JSON.parse(jsonStr) as T;
  } catch (firstError) {
    const sanitized = jsonStr.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    try {
      return JSON.parse(sanitized) as T;
    } catch (secondError) {
      console.error('[extractAndParseJSON] First parse attempt failed:', firstError);
      console.error('[extractAndParseJSON] Second parse attempt failed:', secondError);
      console.error('[extractAndParseJSON] Original response (first 500 chars):', responseText.slice(0, 500));
      throw new Error(`Failed to parse AI response as JSON: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
    }
  }
}
