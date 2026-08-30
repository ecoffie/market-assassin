import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSavedSearch, listSavedSearches, updateSavedSearch, deleteSavedSearch } from './service';

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: () => mockSupabase,
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
}));

function listResult(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data, error }),
    }),
  };
}

function profileResult(naics: string[] | null, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: naics ? { naics_codes: naics } : null, error }),
      }),
    }),
  };
}

function insertResult(data: unknown, error: unknown = null) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  };
}

function updateResult(data: unknown, error: unknown = null) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data, error }),
          }),
        }),
      }),
    }),
  };
}

function readResult(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    }),
  };
}

function deleteResult(count: number, error: unknown = null) {
  return {
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error, count }),
      }),
    }),
  };
}

const existing = {
  id: 'uuid-1',
  user_email: 'user@example.com',
  name: 'DOD IT',
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
};

describe('saved-searches service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects anonymous / stdio identity before DB', async () => {
    const res = await createSavedSearch({
      userEmail: 'stdio@localhost',
      name: 'Test',
      filters: { naics: '541512' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_actor');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects recompete-only scope', async () => {
    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'Recompete',
      mode: 'recompete',
      filters: { naics: '541512' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_alert_scope');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects open mode with recompete horizon instead of silently delivering open only', async () => {
    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'Open plus recompetes',
      mode: 'open',
      filters: { naics: '541512', horizons: { open: true, recompete: true } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_alert_scope');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects recompete mode with forecast horizon instead of substituting forecasts', async () => {
    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'Recompetes plus forecasts',
      mode: 'recompete',
      filters: { naics: '541512', horizons: { forecast: true } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_alert_scope');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects scope=profile without profile NAICS', async () => {
    mockFrom.mockReturnValueOnce(profileResult([]));

    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'My market',
      filters: { scope: 'profile' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('profile_scope_unavailable');
  });

  it('allows scope=profile when profile NAICS exist', async () => {
    mockFrom
      .mockReturnValueOnce(profileResult(['541512']))
      .mockReturnValueOnce(listResult([]))
      .mockReturnValueOnce(insertResult(existing));

    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'My market',
      filters: { scope: 'profile' },
    });
    expect(res.ok).toBe(true);
  });

  it('returns scheduler_unavailable when table missing', async () => {
    mockFrom.mockReturnValue(listResult(null, { code: '42P01', message: 'relation saved_searches' }));

    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'DOD IT',
      filters: { naics: '541512', agency: 'DEFENSE' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('scheduler_unavailable');
      expect(res.message).toMatch(/migration/i);
    }
  });

  it('idempotent create returns existing row without insert', async () => {
    mockFrom.mockReturnValueOnce(listResult([existing]));

    const res = await createSavedSearch({
      userEmail: 'user@example.com',
      name: 'Different label',
      filters: { naics: '541512' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.idempotent).toBe(true);
      expect(res.data.search.id).toBe('uuid-1');
      expect(res.data.bbox_omitted).toBe(true);
    }
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('scopes update to owner email', async () => {
    mockFrom.mockReturnValueOnce(readResult(existing)).mockReturnValueOnce(
      updateResult({ ...existing, alerts_enabled: false, alert_frequency: 'paused' }),
    );

    const res = await updateSavedSearch({
      userEmail: 'user@example.com',
      id: 'uuid-1',
      alertsEnabled: false,
    });
    expect(res.ok).toBe(true);
  });

  it('update returns not_found for wrong owner (no row)', async () => {
    mockFrom.mockReturnValueOnce(readResult(null));

    const res = await updateSavedSearch({
      userEmail: 'other@example.com',
      id: 'uuid-1',
      alertsEnabled: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_found');
  });

  it('delete requires confirm when requireConfirm set', async () => {
    const res = await deleteSavedSearch('user@example.com', 'uuid-1', { requireConfirm: true, confirm: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('confirmation_required');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('delete missing row is uncharged noop', async () => {
    mockFrom.mockReturnValue(deleteResult(0));

    const res = await deleteSavedSearch('user@example.com', 'missing-id', { requireConfirm: true, confirm: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.deleted).toBe(false);
      expect(res.data.noop).toBe(true);
    }
  });

  it('delete cross-account cannot remove row (count 0)', async () => {
    mockFrom.mockReturnValue(deleteResult(0));

    const res = await deleteSavedSearch('attacker@example.com', 'uuid-1', { requireConfirm: true, confirm: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.noop).toBe(true);
  });

  it('list returns empty when table missing (pre-migration degrade)', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { code: '42P01' } }),
        }),
      }),
    });

    const res = await listSavedSearches('user@example.com');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.searches).toEqual([]);
  });
});
