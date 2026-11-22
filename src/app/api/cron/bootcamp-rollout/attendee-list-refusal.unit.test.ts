import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Without the private attendee list the rollout REFUSES: nothing is read, written or sent.
const st = vi.hoisted(() => ({ sent: 0, dbCalls: 0 }));
vi.mock('@/lib/send-email', () => ({ sendEmail: async () => { st.sent++; return { ok: true }; } }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => { st.dbCalls++; return { from: () => { throw new Error('db must not be touched'); } }; } }));

import { GET } from './route';

const req = (mode = 'execute') => new NextRequest(`https://getmindy.ai/api/cron/bootcamp-rollout?mode=${mode}`, {
  headers: { authorization: 'Bearer test-cron-secret' },
});

beforeEach(() => { vi.unstubAllEnvs(); vi.stubEnv('CRON_SECRET', 'test-cron-secret'); st.sent = 0; st.dbCalls = 0; });
afterEach(() => vi.unstubAllEnvs());

describe('bootcamp rollout cron without the private attendee list', () => {
  for (const [label, env] of [
    ['not configured', {}],
    ['path inside the repository', { BOOTCAMP_ATTENDEE_FILE: 'data/bootcamp-attendees-to-enroll.txt' }],
    ['file missing', { BOOTCAMP_ATTENDEE_FILE: '/nonexistent-private-dir/attendees.txt' }],
  ] as const) {
    it(`${label}: refuses with an error outcome and sends nothing`, async () => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
      for (const mode of ['execute', 'preview']) {
        const res = await GET(req(mode));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body).toMatchObject({ success: false, outcome: 'refused', reason: 'attendee_list_unavailable', sent: 0 });
      }
      expect(st.sent).toBe(0);
      expect(st.dbCalls).toBe(0);
    });
  }
});
