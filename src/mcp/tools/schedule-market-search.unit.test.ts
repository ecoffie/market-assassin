import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMcpTool, creditsFor, listMcpTools } from '@/lib/mcp/tool-registry';
import {
  scheduleMarketSearch,
  deleteMarketSchedule,
} from './schedule-market-search';

vi.mock('@/lib/saved-searches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/saved-searches')>();
  return {
    ...actual,
    createSavedSearch: vi.fn(),
    listSavedSearches: vi.fn(),
    updateSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
    getSavedSearchDeliveryReadiness: vi.fn(),
  };
});

import { createSavedSearch, deleteSavedSearch, getSavedSearchDeliveryReadiness } from '@/lib/saved-searches';

const mockCreate = vi.mocked(createSavedSearch);
const mockDelete = vi.mocked(deleteSavedSearch);
const mockDelivery = vi.mocked(getSavedSearchDeliveryReadiness);

const deliveryReady = {
  storage_ready: true,
  cron_registered: true,
  cron_enabled: true,
  cron_schedule_daily: true,
  cron_job_name: 'saved-search-alerts',
  cron_route: '/api/cron/saved-search-alerts?limit=50',
  cron_expr: '0 11 * * *',
  last_run_at: '2026-08-30T11:01:00Z',
  last_run_status: 'success',
  last_success_at: '2026-08-30T11:01:00Z',
  execution_health: 'recent_success' as const,
  delivery_state: 'delivery_ready' as const,
  delivery_ready: true,
};

describe('schedule_market_search MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelivery.mockResolvedValue(deliveryReady);
  });

  it('is registered with 0-credit scheduling config pricing', () => {
    expect(isMcpTool('schedule_market_search')).toBe(true);
    expect(isMcpTool('list_market_schedules')).toBe(true);
    expect(isMcpTool('update_market_schedule')).toBe(true);
    expect(isMcpTool('delete_market_schedule')).toBe(true);
    expect(creditsFor('schedule_market_search')).toBe(0);
    expect(creditsFor('update_market_schedule')).toBe(0);
    expect(creditsFor('delete_market_schedule')).toBe(0);
    expect(creditsFor('list_market_schedules')).toBe(0);
    const names = listMcpTools().map((t) => (t.function as { name: string }).name);
    expect(names).toContain('schedule_market_search');
  });

  it('scheduler unavailable → grounded=false, degraded=true, schedule_saved=false', async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      code: 'scheduler_unavailable',
      message: 'Saved searches are not available yet — run the saved_searches migration.',
    });

    const r = await scheduleMarketSearch({
      userEmail: 'agent@example.com',
      name: 'Test',
      filters: { naics: '541512' },
    });

    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.schedule_saved).toBe(false);
    expect(r._meta.delivery_state).toBe('scheduler_unavailable');
    expect(r.schedule_id).toBe('');
    expect(r.message).not.toMatch(/will be emailed/i);
  });

  it('rejects broad filters without scheduling', async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      code: 'invalid_filters',
      message: 'At least one narrowing filter is required',
    });

    const r = await scheduleMarketSearch({
      userEmail: 'user@getmindy.ai',
      name: 'Everything',
      filters: {},
    });
    expect(r._meta.schedule_saved).toBe(false);
    expect(r._meta.grounded).toBe(false);
  });

  it('success with delivery_ready does not use scheduler_available', async () => {
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        idempotent: false,
        bbox_omitted: true,
        search: {
          id: 'sched-uuid',
          user_email: 'secret@getmindy.ai',
          name: 'DOD Cloud',
          mode: 'open',
          filters: { naics: '541512', agency: 'DEFENSE' },
          bbox: null,
          alerts_enabled: true,
          alert_frequency: 'daily',
          last_alerted_at: null,
          last_seen_notice_ids: [],
          total_alerts_sent: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    });

    const r = await scheduleMarketSearch({
      userEmail: 'secret@getmindy.ai',
      name: 'DOD Cloud',
      filters: { naics: '541512', agency: 'DEFENSE' },
    });
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.schedule_saved).toBe(true);
    expect(r._meta.delivery_ready).toBe(true);
    expect(r._meta.bbox_omitted).toBe(true);
    expect(r._meta.bbox_restored).toBe(false);
    expect(r.schedule_id).toBe('sched-uuid');
    expect(r.map_url).toContain('ss=sched-uuid');
    expect(r.alert_destination).toBe('account_email');
    expect(JSON.stringify(r)).not.toContain('secret@getmindy.ai');
    expect(JSON.stringify(r)).not.toContain('scheduler_available');
    expect(r.message).toMatch(/viewport.*not stored/i);
  });

  it('delivery_configured never promises email without recent success evidence', async () => {
    mockDelivery.mockResolvedValue({
      ...deliveryReady,
      last_run_status: 'dispatched',
      last_success_at: null,
      execution_health: 'not_observed',
      delivery_state: 'delivery_configured',
      delivery_ready: false,
    });
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        idempotent: true,
        bbox_omitted: true,
        search: {
          id: 'sched-uuid',
          user_email: 'user@getmindy.ai',
          name: 'DOD',
          mode: 'open',
          filters: { naics: '541512' },
          bbox: null,
          alerts_enabled: true,
          alert_frequency: 'daily',
          last_alerted_at: null,
          last_seen_notice_ids: [],
          total_alerts_sent: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    });

    const r = await scheduleMarketSearch({
      userEmail: 'user@getmindy.ai',
      name: 'DOD',
      filters: { naics: '541512' },
    });
    expect(r._meta.delivery_state).toBe('delivery_configured');
    expect(r._meta.delivery_ready).toBe(false);
    expect(r._meta.degraded).toBe(false);
    expect(r.message).not.toMatch(/will email|will be emailed/i);
  });

  it('delivery_degraded does not promise email when alerts on', async () => {
    mockDelivery.mockResolvedValue({
      ...deliveryReady,
      delivery_ready: false,
      delivery_state: 'delivery_degraded',
      cron_enabled: false,
      execution_health: 'latest_failed',
    });
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        idempotent: false,
        bbox_omitted: false,
        search: {
          id: 'sched-uuid',
          user_email: 'user@getmindy.ai',
          name: 'DOD',
          mode: 'open',
          filters: { naics: '541512' },
          bbox: { w: 1, s: 2, e: 3, n: 4 },
          alerts_enabled: true,
          alert_frequency: 'daily',
          last_alerted_at: null,
          last_seen_notice_ids: [],
          total_alerts_sent: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      },
    });

    const r = await scheduleMarketSearch({
      userEmail: 'user@getmindy.ai',
      name: 'DOD',
      filters: { naics: '541512' },
      bbox: { w: 1, s: 2, e: 3, n: 4 },
    });
    expect(r._meta.schedule_saved).toBe(true);
    expect(r._meta.delivery_ready).toBe(false);
    expect(r._meta.degraded).toBe(true);
    expect(r.message).not.toMatch(/will be emailed/i);
    expect(r.message).toMatch(/not currently guaranteed/i);
  });

  it('delete without confirm is rejected', async () => {
    mockDelete.mockResolvedValue({
      ok: false,
      code: 'confirmation_required',
      message: 'confirm required',
    });

    const r = await deleteMarketSchedule({ userEmail: 'user@getmindy.ai', schedule_id: 'x' });
    expect(r.deleted).toBe(false);
    expect(r._meta.grounded).toBe(false);
  });

  it('does not import sendEmail or live spend clients (no email send, no spend probe)', () => {
    const src = readFileSync(join(process.cwd(), 'src/mcp/tools/schedule-market-search.ts'), 'utf8');
    expect(src).not.toMatch(/sendEmail/);
    expect(src).not.toMatch(/from '@\/lib\/usaspending/);
    expect(src).not.toMatch(/runMcpTool/);
  });

  it('schedule_market_search identity comes from ctx.userEmail in registry dispatch', () => {
    const reg = readFileSync(join(process.cwd(), 'src/lib/mcp/tool-registry.ts'), 'utf8');
    const block = reg.match(/if \(name === 'schedule_market_search'\) \{[\s\S]*?return \{ result, credits \};\s*\}/);
    expect(block?.[0]).toContain('userEmail: ctx.userEmail');
    expect(block?.[0]).not.toMatch(/recipient/);
  });

  it('registers all four lifecycle tools on the stdio transport too', () => {
    const server = readFileSync(join(process.cwd(), 'src/mcp/server.ts'), 'utf8');
    for (const name of [
      'schedule_market_search',
      'list_market_schedules',
      'update_market_schedule',
      'delete_market_schedule',
    ]) {
      expect(server).toContain(`server.registerTool(\n  '${name}'`);
    }
    const deleteBlock = server.slice(server.indexOf("'delete_market_schedule'"));
    expect(deleteBlock.slice(0, 700)).toContain('destructiveHint: true');
    expect(deleteBlock.slice(0, 700)).toContain('z.literal(true)');
  });
});
