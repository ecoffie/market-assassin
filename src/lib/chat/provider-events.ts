/**
 * Record Ask Mindy model-provider failures and fallbacks so they are never silent again.
 *
 * Background: from 2026-09-26 the Claude planner failed on every turn (unfunded account) and
 * the route fell through to gpt-4o with no log line, for seven weeks. Every failure and every
 * fallback now writes a tool_errors row (visible in /api/admin/tool-health) and a
 * rate-limited ops alert. Never throws.
 */
import { logToolError, ToolNames, ErrorTypes, type ErrorType, type AIProvider } from '@/lib/tool-errors';
import { sendOpsAlert } from '@/lib/ops-alert';

export type ProviderEventKind = 'planner_failure' | 'planner_fallback' | 'planner_unavailable' | 'answer_failure' | 'answer_fallback';

const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const lastAlertAt = new Map<string, number>();

function errorTypeFor(status: number | null | undefined, detail: string): ErrorType {
  if (status === 429) return ErrorTypes.AI_RATE_LIMIT;
  if (/timeout|timed out|abort/i.test(detail)) return ErrorTypes.AI_TIMEOUT;
  return ErrorTypes.API_ERROR;
}

export async function recordProviderEvent(e: {
  kind: ProviderEventKind;
  provider: string;
  model: string;
  status?: number | null;
  detail: string;
  userEmail?: string;
  /** e.g. the provider/model that took over after a fallback */
  next?: string;
}): Promise<void> {
  const detail = e.detail.slice(0, 500);
  try {
    await logToolError({
      tool: ToolNames.ASK_MINDY,
      errorType: errorTypeFor(e.status, detail),
      errorMessage: `${e.kind}: ${e.provider}:${e.model}${e.status ? ` HTTP ${e.status}` : ''}${e.next ? ` -> ${e.next}` : ''} ${detail}`.trim(),
      userEmail: e.userEmail,
      requestPath: '/api/app/chat',
      requestParams: { kind: e.kind, provider: e.provider, model: e.model, status: e.status ?? null, next: e.next ?? null },
      aiProvider: (['openai', 'anthropic', 'groq'].includes(e.provider) ? e.provider : undefined) as AIProvider | undefined,
      aiModel: e.model,
    });
  } catch (err) {
    console.error('[chat] provider event log failed:', err);
  }

  const key = `${e.kind}:${e.provider}:${e.model}`;
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) return;
  lastAlertAt.set(key, now);
  try {
    await sendOpsAlert({
      subject: `Ask Mindy ${e.kind.replace('_', ' ')}: ${e.provider}:${e.model}`,
      html: `<p><b>${e.kind}</b> on ${e.provider}:${e.model}${e.status ? ` (HTTP ${e.status})` : ''}${e.next ? `, continued on ${e.next}` : ''}.</p><p>${detail.replace(/</g, '&lt;')}</p>`,
    });
  } catch (err) {
    console.error('[chat] provider event alert failed:', err);
  }
}

/** Test hook. */
export function __resetProviderEventCooldown() {
  lastAlertAt.clear();
}
