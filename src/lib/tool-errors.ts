/**
 * Tool Error Logging & Monitoring
 *
 * Tracks errors across all AI-powered tools for the admin dashboard.
 *
 * Usage:
 *   import { logToolError, recordToolSuccess, ToolNames } from '@/lib/tool-errors';
 *
 *   // Log an error
 *   await logToolError({
 *     tool: ToolNames.CONTENT_REAPER,
 *     errorType: 'ai_timeout',
 *     errorMessage: 'Groq API timeout after 30s',
 *     userEmail: 'user@example.com',
 *     aiProvider: 'groq',
 *     aiModel: 'llama-3.3-70b-versatile'
 *   });
 *
 *   // Record success
 *   await recordToolSuccess(ToolNames.CODE_SUGGESTIONS, { latencyMs: 1200, tokensUsed: 500 });
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-loaded Supabase client
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// Tool name constants
export const ToolNames = {
  CONTENT_REAPER: 'content_reaper',
  CODE_SUGGESTIONS: 'code_suggestions',
  SAMPLE_OPPORTUNITIES: 'sample_opportunities',
  BRIEFINGS: 'briefings',
  ALERTS: 'daily_alerts', // Daily opportunity alert emails
  MARKET_SCANNER: 'market_scanner',
  OPPORTUNITY_HUNTER: 'opportunity_hunter',
  REPORTS: 'reports',
} as const;

export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];

// Error type constants
export const ErrorTypes = {
  AI_TIMEOUT: 'ai_timeout',
  AI_RATE_LIMIT: 'ai_rate_limit',
  AI_TOKEN_LIMIT: 'ai_token_limit',
  API_ERROR: 'api_error',
  VALIDATION: 'validation',
  INTERNAL: 'internal',
  EMAIL_FAILURE: 'email_failure', // Email send failures (SMTP, delivery issues)
} as const;

export type ErrorType = (typeof ErrorTypes)[keyof typeof ErrorTypes];

// AI provider constants
export const AIProviders = {
  GROQ: 'groq',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
} as const;

export type AIProvider = (typeof AIProviders)[keyof typeof AIProviders];

interface LogErrorParams {
  tool: ToolName;
  errorType: ErrorType;
  errorMessage: string;
  userEmail?: string;
  requestPath?: string;
  requestParams?: Record<string, unknown>;
  errorStack?: string;
  aiProvider?: AIProvider;
  aiModel?: string;
  tokensUsed?: number;
}

interface RecordSuccessParams {
  latencyMs?: number;
  tokensUsed?: number;
}

/**
 * Log a tool error to the database
 */
export async function logToolError(params: LogErrorParams): Promise<string | null> {
  const supabase = getSupabase();

  // Always log to console
  console.error(`[ToolError] ${params.tool}/${params.errorType}: ${params.errorMessage}`, {
    userEmail: params.userEmail,
    aiProvider: params.aiProvider,
    aiModel: params.aiModel,
  });

  if (!supabase) {
    console.warn('[ToolError] Supabase not available, skipping DB log');
    return null;
  }

  try {
    // Sanitize request params (remove any secrets)
    const sanitizedParams = params.requestParams
      ? sanitizeParams(params.requestParams)
      : null;

    const { data, error } = await supabase
      .from('tool_errors')
      .insert({
        tool_name: params.tool,
        error_type: params.errorType,
        error_message: params.errorMessage,
        user_email: params.userEmail,
        request_path: params.requestPath,
        request_params: sanitizedParams,
        error_stack: params.errorStack,
        ai_provider: params.aiProvider,
        ai_model: params.aiModel,
        tokens_used: params.tokensUsed,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ToolError] Failed to log to DB:', error);
      return null;
    }

    // Update daily metrics
    await updateDailyMetrics(params.tool, 'error', params.errorType, params.tokensUsed);

    return data?.id || null;
  } catch (err) {
    console.error('[ToolError] Exception logging error:', err);
    return null;
  }
}

/**
 * Record a successful tool request
 */
export async function recordToolSuccess(
  tool: ToolName,
  params?: RecordSuccessParams
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    await updateDailyMetrics(tool, 'success', undefined, params?.tokensUsed, params?.latencyMs);
  } catch (err) {
    console.error('[ToolSuccess] Exception recording success:', err);
  }
}

/**
 * Update daily tool health metrics
 */
async function updateDailyMetrics(
  tool: ToolName,
  type: 'success' | 'error',
  errorType?: ErrorType,
  tokensUsed?: number,
  latencyMs?: number
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const today = new Date().toISOString().split('T')[0];

  try {
    // Upsert base record
    const { error: upsertError } = await supabase
      .from('tool_health_metrics')
      .upsert(
        {
          date: today,
          tool_name: tool,
          requests_total: 1,
          requests_success: type === 'success' ? 1 : 0,
          requests_failed: type === 'error' ? 1 : 0,
          tokens_used: tokensUsed || 0,
        },
        { onConflict: 'date,tool_name' }
      );

    if (upsertError) {
      // Record exists, update it
      const updates: Record<string, unknown> = {
        requests_total: supabase.rpc('increment', { x: 1 }),
        updated_at: new Date().toISOString(),
      };

      if (type === 'success') {
        updates.requests_success = supabase.rpc('increment', { x: 1 });
      } else {
        updates.requests_failed = supabase.rpc('increment', { x: 1 });
      }

      if (tokensUsed) {
        updates.tokens_used = supabase.rpc('increment', { x: tokensUsed });
      }

      // For now, just do a simple update with raw SQL increment
      await supabase.rpc('record_tool_success', {
        p_tool_name: tool,
        p_latency_ms: latencyMs,
        p_tokens_used: tokensUsed,
      });
    }
  } catch (err) {
    console.error('[ToolMetrics] Failed to update metrics:', err);
  }
}

/**
 * Update API provider status
 */
export async function updateProviderStatus(
  provider: string,
  status: 'healthy' | 'degraded' | 'down',
  params?: {
    latencyMs?: number;
    errorMessage?: string;
    rateLimitRemaining?: number;
    rateLimitResetAt?: Date;
  }
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const updates: Record<string, unknown> = {
      status,
      last_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (status === 'healthy') {
      updates.last_success_at = new Date().toISOString();
    } else {
      updates.last_error_at = new Date().toISOString();
      if (params?.errorMessage) {
        updates.last_error_message = params.errorMessage;
      }
    }

    if (params?.latencyMs) {
      updates.avg_latency_ms = params.latencyMs;
    }

    if (params?.rateLimitRemaining !== undefined) {
      updates.rate_limit_remaining = params.rateLimitRemaining;
    }

    if (params?.rateLimitResetAt) {
      updates.rate_limit_reset_at = params.rateLimitResetAt.toISOString();
    }

    await supabase
      .from('api_provider_status')
      .update(updates)
      .eq('provider', provider);
  } catch (err) {
    console.error('[ProviderStatus] Failed to update:', err);
  }
}

/**
 * Get recent errors for a tool
 */
export async function getRecentErrors(
  tool?: ToolName,
  limit: number = 50
): Promise<unknown[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  try {
    let query = supabase
      .from('tool_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (tool) {
      query = query.eq('tool_name', tool);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[GetErrors] Failed:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[GetErrors] Exception:', err);
    return [];
  }
}

/**
 * Get tool health summary
 */
export async function getToolHealthSummary(days: number = 7): Promise<{
  tools: Record<string, { successRate: number; errorCount: number; tokensUsed: number }>;
  providers: Record<string, { status: string; lastError?: string }>;
  recentErrors: unknown[];
}> {
  const supabase = getSupabase();
  if (!supabase) {
    return { tools: {}, providers: {}, recentErrors: [] };
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get tool metrics
    const { data: metrics } = await supabase
      .from('tool_health_metrics')
      .select('*')
      .gte('date', startDate.toISOString().split('T')[0]);

    // Get provider status
    const { data: providers } = await supabase
      .from('api_provider_status')
      .select('*');

    // Get recent unresolved errors
    const { data: errors } = await supabase
      .from('tool_errors')
      .select('*')
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(20);

    // Aggregate tool metrics
    const tools: Record<string, { successRate: number; errorCount: number; tokensUsed: number }> = {};

    if (metrics) {
      for (const m of metrics) {
        if (!tools[m.tool_name]) {
          tools[m.tool_name] = { successRate: 0, errorCount: 0, tokensUsed: 0 };
        }
        const tool = tools[m.tool_name];
        tool.errorCount += m.requests_failed || 0;
        tool.tokensUsed += m.tokens_used || 0;

        const total = (m.requests_success || 0) + (m.requests_failed || 0);
        if (total > 0) {
          tool.successRate = ((m.requests_success || 0) / total) * 100;
        }
      }
    }

    // Format provider status
    const providerStatus: Record<string, { status: string; lastError?: string }> = {};
    if (providers) {
      for (const p of providers) {
        providerStatus[p.provider] = {
          status: p.status,
          lastError: p.last_error_message,
        };
      }
    }

    return {
      tools,
      providers: providerStatus,
      recentErrors: errors || [],
    };
  } catch (err) {
    console.error('[HealthSummary] Exception:', err);
    return { tools: {}, providers: {}, recentErrors: [] };
  }
}

/**
 * Sanitize request params to remove sensitive data
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'api_key', 'apiKey', 'token', 'secret', 'authorization'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.substring(0, 500) + '...[truncated]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Classify an error into error types
 */
export function classifyError(error: Error | string): ErrorType {
  const message = typeof error === 'string' ? error : error.message;
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return ErrorTypes.AI_TIMEOUT;
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return ErrorTypes.AI_RATE_LIMIT;
  }

  if (lowerMessage.includes('token') && (lowerMessage.includes('limit') || lowerMessage.includes('exceeded'))) {
    return ErrorTypes.AI_TOKEN_LIMIT;
  }

  if (lowerMessage.includes('api') || lowerMessage.includes('fetch') || lowerMessage.includes('network')) {
    return ErrorTypes.API_ERROR;
  }

  if (lowerMessage.includes('valid') || lowerMessage.includes('required') || lowerMessage.includes('missing')) {
    return ErrorTypes.VALIDATION;
  }

  return ErrorTypes.INTERNAL;
}
