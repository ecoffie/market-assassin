import { describe, it, expect, vi, beforeEach } from 'vitest';
import { creditsFor } from '@/lib/mcp/tool-registry';
import { runMeteredTool } from '@/lib/mcp/metered';

vi.mock('@/lib/mcp/tool-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/tool-registry')>();
  return {
    ...actual,
    runMcpTool: vi.fn(),
  };
});

vi.mock('@/lib/mcp/credits', () => ({
  getBalance: vi.fn().mockResolvedValue(1000),
  debitCredits: vi.fn(),
  logCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/search-history', () => ({
  recordSearchAxes: vi.fn(),
}));

import { runMcpTool } from '@/lib/mcp/tool-registry';
import { debitCredits } from '@/lib/mcp/credits';

const mockRun = vi.mocked(runMcpTool);
const mockDebit = vi.mocked(debitCredits);

const CTX = { userEmail: 'user@getmindy.ai', apiKeyId: 'key-1' };

describe('schedule tool metering (0 credits — config only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const scheduleTools = [
    'schedule_market_search',
    'list_market_schedules',
    'update_market_schedule',
    'delete_market_schedule',
  ] as const;

  it.each(scheduleTools)('%s costs 0 credits', (tool) => {
    expect(creditsFor(tool)).toBe(0);
  });

  it('validation failure never debits', async () => {
    mockRun.mockResolvedValue({
      result: {
        schedule_id: '',
        _meta: { grounded: false, degraded: false, schedule_saved: false },
      },
      credits: 0,
    });

    const out = await runMeteredTool(
      'schedule_market_search',
      { name: 'Bad', filters: {} },
      CTX,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.creditsCharged).toBe(0);
    expect(mockDebit).not.toHaveBeenCalled();
  });

  it('degraded scheduler_unavailable never debits', async () => {
    mockRun.mockResolvedValue({
      result: {
        _meta: { grounded: false, degraded: true, schedule_saved: false, delivery_state: 'scheduler_unavailable' },
      },
      credits: 0,
    });

    const out = await runMeteredTool('schedule_market_search', { name: 'X', filters: { naics: '541512' } }, CTX);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.creditsCharged).toBe(0);
    expect(mockDebit).not.toHaveBeenCalled();
  });

  it('idempotent retry success never debits', async () => {
    mockRun.mockResolvedValue({
      result: {
        schedule_id: 'uuid',
        _meta: { grounded: true, degraded: false, schedule_saved: true, idempotent: true, delivery_ready: true },
      },
      credits: 0,
    });

    const out = await runMeteredTool(
      'schedule_market_search',
      { name: 'Dup', filters: { naics: '541512' } },
      CTX,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.creditsCharged).toBe(0);
    expect(mockDebit).not.toHaveBeenCalled();
  });

  it('delete not-found noop never debits', async () => {
    mockRun.mockResolvedValue({
      result: {
        deleted: false,
        _meta: { grounded: true, degraded: false, noop: true },
      },
      credits: 0,
    });

    const out = await runMeteredTool(
      'delete_market_schedule',
      { schedule_id: 'missing', confirm: true },
      CTX,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.creditsCharged).toBe(0);
    expect(mockDebit).not.toHaveBeenCalled();
  });

  it('update no-op never debits', async () => {
    mockRun.mockResolvedValue({
      result: {
        _meta: { grounded: true, degraded: false, schedule_saved: true, noop: true },
      },
      credits: 0,
    });

    const out = await runMeteredTool(
      'update_market_schedule',
      { schedule_id: 'uuid', alerts_enabled: false },
      CTX,
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.creditsCharged).toBe(0);
    expect(mockDebit).not.toHaveBeenCalled();
  });
});
