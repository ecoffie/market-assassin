/**
 * Live historical lookup — MASA without a number against prod-shaped DB.
 * Skips when service-role env is absent. Never prints emails.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookupSolicitation } from '@/lib/sam/lookup-solicitation';
import { firstTurnToolFor } from '@/lib/sam/solicitation-intent';

function loadLocalEnv() {
  const candidates = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../../../.env.local'),
    '/Users/ericcoffie/Market Assasin/market-assassin/.env.local',
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadLocalEnv();

const HAS_DB = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const NOW = new Date('2026-09-18T18:00:00.000Z');

describe.skipIf(!HAS_DB)('lookup_solicitation live corpus', () => {
  it('A. Indian Head manufacturing bid surfaces MASA as MATCHED_CANDIDATE without a number', async () => {
    const t0 = Date.now();
    const result = await lookupSolicitation({
      query: 'I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?',
      now: NOW,
    });
    const elapsed = Date.now() - t0;
    const masa = result.items.find((i) =>
      (i.title || '').includes('MASA') && !(i.title || '').includes('Masan'),
    );
    expect(masa, 'MASA should be a candidate without the solicitation number').toBeTruthy();
    expect(masa!.kind).toBe('MATCHED_CANDIDATE');
    expect(masa!.not_biddable).toBe(true);
    expect(masa!.award_status).toBe('AWARD_NOT_ESTABLISHED');
    expect(masa!.latest_amendment).toMatch(/0003/);
    expect(masa!.office_dodaac).toBe('N00174');
    expect(masa!.identifiers.some((id) => /N0017425RFPREQIHDMDept0002/i.test(id))).toBe(true);
    expect(result.items.filter((i) => i.title?.includes('(MASA)')).length).toBeLessThanOrEqual(1);
    expect(result._meta.sow_text_used).toBe(false);
    expect(result._meta.external_api).toBe(false);
    expect(result._meta.candidate_count).toBeLessThanOrEqual(50);
    expect(elapsed).toBeLessThan(8_000);
    expect(result._meta.db_ms).toBeLessThan(8_000);
    expect(JSON.stringify(result)).not.toMatch(/user_email/i);
  }, 20_000);

  it('E. open control 70RTAC26R00000007 is OPEN / biddable', async () => {
    const result = await lookupSolicitation({
      query: '70RTAC26R00000007',
      now: NOW,
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].status).toBe('open');
    expect(result.items[0].not_biddable).toBe(false);
  }, 20_000);

  it('B/C/D known-id: Endformers collapse, construction current truth, archived VA IT', async () => {
    const b = await lookupSolicitation({ query: 'N00174-26-RFPREQ-M22-0011', now: NOW });
    expect(b.items).toHaveLength(1);
    expect(b.items[0].kind).toBe('RESOLVED_SOLICITATION');
    expect(b.items[0].title).toMatch(/Endformers/i);
    expect(b.items[0].version_count).toBeGreaterThanOrEqual(2);
    expect(b.items[0].not_biddable).toBe(true);

    const c = await lookupSolicitation({ query: 'N4008526R0187', now: NOW });
    expect(c.items[0]?.kind).toBe('RESOLVED_SOLICITATION');
    expect(c.items[0]?.version_count).toBeGreaterThan(1);
    expect(c.items[0]?.award_status).toBe('AWARD_NOT_ESTABLISHED');
    expect(c.items[0]?.not_biddable).toBe(c.items[0]?.status !== 'open');

    const d = await lookupSolicitation({ query: '36C10B26Q0654', now: NOW });
    expect(d.items[0]?.kind).toBe('RESOLVED_SOLICITATION');
    expect(d.items[0]?.not_biddable).toBe(true);
    expect(d.items[0]?.status).not.toBe('open');
    expect(d.items[0]?.award_status).toBe('AWARD_NOT_ESTABLISHED');
  }, 20_000);

  it('F. MASA vs Masan stay separate on acronym query', async () => {
    const result = await lookupSolicitation({ query: 'What happened with MASA?', now: NOW });
    const masa = result.items.filter((i) => (i.title || '').includes('(MASA)'));
    const masan = result.items.filter((i) => /masan/i.test(i.title || ''));
    expect(masa.length).toBeGreaterThan(0);
    expect(masa[0].kind).toBe('MATCHED_CANDIDATE');
    if (masan.length) expect(masan[0].notice_id).not.toBe(masa[0].notice_id);
  }, 20_000);

  it('routing lock: historical prompt is not FIND', () => {
    expect(firstTurnToolFor('I submitted a Navy manufacturing bid at Indian Head recently. Can you find it?'))
      .toBe('lookup_solicitation');
    expect(firstTurnToolFor('I sell IT services and want to work with the VA.')).toBe('find_opportunities');
  });
});
