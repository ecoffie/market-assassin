/**
 * Team and Enterprise inherit every Pro capability. These two routes used
 * `access.tier === 'pro'` and returned 402 "Mindy Pro feature" to paying $499 Team
 * customers (found 2026-09-30). The gate must admit pro/team/enterprise and refuse free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const tierOf = vi.hoisted(() => ({ tier: 'team' as string }));

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true }) }));
vi.mock('@/lib/api-auth', () => ({ verifyMIAccess: async () => ({ tier: tierOf.tier, isStaff: false }) }));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: () => undefined }));
vi.mock('@/mcp/tools/market-report', () => ({ generateMarketReport: async () => ({ ok: true }) }));
// Anything past the analyst's tier gate fails fast; we only assert the gate.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => { throw new Error('past the gate'); } }));

import { POST as marketReport } from './market-report/route';
import { POST as bidNoBid } from '../analyst/bid-no-bid/route';

const req = (body: object) => new NextRequest('http://x/api', { method: 'POST', body: JSON.stringify(body) });
const callReport = () => marketReport(req({ email: 'a@x.com', keyword: 'janitorial' }));
const callAnalyst = async () => {
  try { return (await bidNoBid(req({ email: 'a@x.com', noticeId: 'n1' }))).status; } catch { return 'passed-gate'; }
};

beforeEach(() => { tierOf.tier = 'team'; });

describe('Pro feature gates admit Team and Enterprise', () => {
  for (const tier of ['pro', 'team', 'enterprise']) {
    it(`market-report: ${tier} is not refused`, async () => {
      tierOf.tier = tier;
      expect((await callReport()).status).not.toBe(402);
    });
    it(`bid-no-bid (Mindy Analyst): ${tier} is not refused`, async () => {
      tierOf.tier = tier;
      expect(await callAnalyst()).not.toBe(402);
    });
  }

  it('free is still refused on both', async () => {
    tierOf.tier = 'free';
    expect((await callReport()).status).toBe(402);
    expect(await callAnalyst()).toBe(402);
  });
});
