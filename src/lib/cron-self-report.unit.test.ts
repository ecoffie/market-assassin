import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cronJobUpdate,
  cronJobEq,
  runUpdate,
  runUpdateEq,
  latestMaybeSingle,
} = vi.hoisted(() => ({
  cronJobUpdate: vi.fn(),
  cronJobEq: vi.fn().mockResolvedValue({ error: null }),
  runUpdate: vi.fn(),
  runUpdateEq: vi.fn().mockResolvedValue({ error: null }),
  latestMaybeSingle: vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null }),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'cron_jobs') {
        return {
          update: (values: unknown) => {
            cronJobUpdate(values);
            return { eq: cronJobEq };
          },
        };
      }

      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: latestMaybeSingle }),
            }),
          }),
        }),
        update: (values: unknown) => {
          runUpdate(values);
          return { eq: runUpdateEq };
        },
      };
    },
  }),
}));

import { reportCronOutcome } from './cron-self-report';

describe('reportCronOutcome terminal overwrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  });

  it('overwrites dispatched with terminal success', async () => {
    await reportCronOutcome('saved-search-alerts', 'success');

    expect(cronJobUpdate).toHaveBeenCalledWith({ last_status: 'success' });
    expect(cronJobEq).toHaveBeenCalledWith('job_name', 'saved-search-alerts');
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      error: null,
      finished_at: expect.any(String),
    }));
    expect(runUpdateEq).toHaveBeenCalledWith('id', 'run-1');
  });

  it('overwrites dispatched with terminal error and sanitized class summary', async () => {
    await reportCronOutcome(
      'saved-search-alerts',
      'error',
      'email_send_failed=2,state_update_failed=1',
    );

    expect(cronJobUpdate).toHaveBeenCalledWith({ last_status: 'error' });
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error',
      error: 'email_send_failed=2,state_update_failed=1',
    }));
  });

  it('overwrites dispatched with terminal partial and backlog count', async () => {
    await reportCronOutcome('saved-search-alerts', 'partial', 'capacity_exhausted=1,backlog=5');

    expect(cronJobUpdate).toHaveBeenCalledWith({ last_status: 'partial' });
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'partial',
      error: 'capacity_exhausted=1,backlog=5',
    }));
  });
});
