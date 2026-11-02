import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Every side effect is a spy that must NOT fire for a rejected request.
const createClient = vi.fn(() => { throw new Error('DB touched on a rejected request'); });
const sendEmail = vi.fn();
const generateBriefingJson = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@/lib/send-email', () => ({ sendEmail }));
vi.mock('@/lib/briefings/delivery/llm-router', () => ({ generateBriefingJson, extractAndParseJSON: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  verifyUserSession: vi.fn(async () => ({ authenticated: false })),
  getStaffRole: vi.fn(() => 'none'),
}));
vi.mock('@/lib/two-factor-session', () => ({ verifyTwoFactorSessionToken: vi.fn(() => ({ valid: false })) }));

const ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'cron-secret-value-1234';
  process.env.ADMIN_PASSWORD = 'admin-password-value-1234';
  (process.env as Record<string, string>).NODE_ENV = 'production';
});
afterEach(() => { process.env = { ...ENV }; });

const call = async (qs: string, headers: Record<string, string> = {}) => {
  const { GET } = await import('./route');
  return GET(new NextRequest(`https://getmindy.ai/api/cron/weekly-deep-dive${qs}`, { headers }));
};

describe('weekly-deep-dive rejects without spending or sending', () => {
  const cases: Array<[string, string, Record<string, string>]> = [
    ['anonymous', '', {}],
    ['email + test (the old bypass)', '?email=someone@example.com&test=true', {}],
    ['spoofed x-vercel-cron', '', { 'x-vercel-cron': '1' }],
    ['spoofed x-vercel-cron + test', '?email=someone@example.com&test=true', { 'x-vercel-cron': '1' }],
    ['wrong bearer', '', { authorization: 'Bearer wrong' }],
    ['wrong admin password in test mode', '?email=someone@example.com&test=true&password=nope', {}],
  ];
  for (const [name, qs, headers] of cases) {
    it(`${name} → 401, no DB, no LLM, no email`, async () => {
      const res = await call(qs, headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(createClient).not.toHaveBeenCalled();
      expect(generateBriefingJson).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });
  }

  it('admin test mode gets past auth (reaches the data layer)', async () => {
    const res = await call('?email=someone@example.com&test=true', { 'x-admin-password': 'admin-password-value-1234' });
    expect(res.status).not.toBe(401);
    expect(createClient).toHaveBeenCalled(); // past the gate; our stub then throws → route's own error path
  });
});
