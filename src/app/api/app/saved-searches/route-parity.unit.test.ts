import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH, DELETE } from './route';

vi.mock('@/lib/two-factor-session', () => ({
  requireMIAuthSession: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/saved-searches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/saved-searches')>();
  return {
    ...actual,
    createSavedSearch: vi.fn(),
    listSavedSearches: vi.fn(),
    updateSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
  };
});

vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: vi.fn(),
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
}));

import {
  createSavedSearch,
  listSavedSearches,
  updateSavedSearch,
  deleteSavedSearch,
} from '@/lib/saved-searches';
import { getAppSupabase } from '@/lib/app/workspace';

const mockCreate = vi.mocked(createSavedSearch);
const mockList = vi.mocked(listSavedSearches);
const mockUpdate = vi.mocked(updateSavedSearch);
const mockDelete = vi.mocked(deleteSavedSearch);
const mockSupabase = vi.mocked(getAppSupabase);

const sampleRow = {
  id: 'uuid-1',
  user_email: 'user@example.com',
  name: 'DOD IT',
  mode: 'open' as const,
  filters: { naics: '541512' },
  bbox: null,
  alerts_enabled: true,
  alert_frequency: 'daily' as const,
  last_alerted_at: null,
  last_seen_notice_ids: [],
  total_alerts_sent: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('saved-searches API route adapter parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST create delegates to service and returns search + idempotent', async () => {
    mockCreate.mockResolvedValue({
      ok: true,
      data: { search: sampleRow, idempotent: false, bbox_omitted: true },
    });

    const req = new NextRequest('http://localhost/api/app/saved-searches', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user@example.com',
        name: 'DOD IT',
        mode: 'open',
        filters: { naics: '541512' },
        alerts_enabled: true,
        alert_frequency: 'daily',
      }),
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.search.id).toBe('uuid-1');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'user@example.com',
        name: 'DOD IT',
        filters: { naics: '541512' },
      }),
    );
  });

  it('POST create returns 400 for unsupported_alert_scope', async () => {
    mockCreate.mockResolvedValue({
      ok: false,
      code: 'unsupported_alert_scope',
      message: 'Recompete-only',
    });

    const req = new NextRequest('http://localhost/api/app/saved-searches', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user@example.com',
        name: 'Recompete',
        mode: 'recompete',
        filters: { naics: '541512' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('GET list delegates to listSavedSearches', async () => {
    mockList.mockResolvedValue({ ok: true, data: { searches: [sampleRow] } });

    const req = new NextRequest('http://localhost/api/app/saved-searches?email=user@example.com');
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.searches).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith('user@example.com');
  });

  it('PATCH update delegates with ownership email', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { search: { ...sampleRow, alerts_enabled: false }, noop: false } });

    const req = new NextRequest('http://localhost/api/app/saved-searches', {
      method: 'PATCH',
      body: JSON.stringify({
        email: 'user@example.com',
        id: 'uuid-1',
        alerts_enabled: false,
      }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: 'user@example.com', id: 'uuid-1', alertsEnabled: false }),
    );
  });

  it('PATCH returns 404 when service reports not_found', async () => {
    mockUpdate.mockResolvedValue({ ok: false, code: 'not_found', message: 'missing' });

    const req = new NextRequest('http://localhost/api/app/saved-searches', {
      method: 'PATCH',
      body: JSON.stringify({ email: 'user@example.com', id: 'missing' }),
    });

    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });

  it('DELETE returns 404 on noop (missing row)', async () => {
    mockDelete.mockResolvedValue({ ok: true, data: { deleted: false, noop: true } });

    const req = new NextRequest('http://localhost/api/app/saved-searches?email=user@example.com&id=missing');
    const res = await DELETE(req);
    expect(res.status).toBe(404);
    expect(mockDelete).toHaveBeenCalledWith('user@example.com', 'missing');
  });

  it('DELETE succeeds when row deleted', async () => {
    mockDelete.mockResolvedValue({ ok: true, data: { deleted: true, noop: false } });

    const req = new NextRequest('http://localhost/api/app/saved-searches?email=user@example.com&id=uuid-1');
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  it('GET badge=1 still uses inline supabase path (not extracted)', async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    mockSupabase.mockReturnValue({ from: mockFrom } as never);

    const req = new NextRequest('http://localhost/api/app/saved-searches?email=user@example.com&badge=1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('saved_searches');
  });
});
