export type BriefingTask = 'daily' | 'weekly' | 'pursuit';
export type LlmProvider = 'anthropic' | 'openai';

interface RouteCandidate {
  provider: LlmProvider;
  model: string;
}

const TASK_ROUTES: Record<BriefingTask, RouteCandidate[]> = {
  daily: [
    {
      provider: (process.env.BRIEFING_DAILY_PRIMARY_PROVIDER as LlmProvider) || 'anthropic',
      model: process.env.BRIEFING_DAILY_PRIMARY_MODEL || 'claude-3-5-haiku-latest',
    },
    {
      provider: (process.env.BRIEFING_DAILY_FALLBACK_PROVIDER as LlmProvider) || 'openai',
      model: process.env.BRIEFING_DAILY_FALLBACK_MODEL || 'gpt-5-mini',
    },
  ],
  weekly: [
    {
      provider: (process.env.BRIEFING_WEEKLY_PRIMARY_PROVIDER as LlmProvider) || 'openai',
      model: process.env.BRIEFING_WEEKLY_PRIMARY_MODEL || 'gpt-5-mini',
    },
    {
      provider: (process.env.BRIEFING_WEEKLY_FALLBACK_PROVIDER as LlmProvider) || 'anthropic',
      model: process.env.BRIEFING_WEEKLY_FALLBACK_MODEL || 'claude-sonnet-4-20250514',
    },
  ],
  pursuit: [
    {
      provider: (process.env.BRIEFING_PURSUIT_PRIMARY_PROVIDER as LlmProvider) || 'anthropic',
      model: process.env.BRIEFING_PURSUIT_PRIMARY_MODEL || 'claude-opus-4-20250514',
    },
    {
      provider: (process.env.BRIEFING_PURSUIT_FALLBACK_PROVIDER as LlmProvider) || 'openai',
      model: process.env.BRIEFING_PURSUIT_FALLBACK_MODEL || 'gpt-5-mini',
    },
  ],
};

function getAnthropicApiKey() {
  return process.env.BRIEFING_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
}

function hasProviderKey(provider: LlmProvider) {
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
  };

  const text = data.content?.find((item) => item.type === 'text')?.text;
  if (!text) {
    throw new Error('Anthropic returned no text content');
  }

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
  };

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned no message content');
  }

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
      console.log(`[LLMRouter] ${task}: trying ${attempt.provider}/${attempt.model}`);
      const text = attempt.provider === 'anthropic'
        ? await generateWithAnthropic(attempt.model, prompt, maxTokens)
        : await generateWithOpenAI(attempt.model, systemPrompt, userPrompt, maxTokens);

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
