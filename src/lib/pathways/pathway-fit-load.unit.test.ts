/**
 * PATHWAY FIT identity — must reuse #1548 resolveAwardCorpusByName.
 * Unique name → UEI. Ambiguous never auto-picks. none ≠ no federal awards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveName = vi.fn();
vi.mock('@/lib/contractor/name-resolution', () => ({
  resolveAwardCorpusByName: (q: string) => mockResolveName(q),
}));

const { resolvePathwayFitIdentity } = await import('./pathway-fit-load');

beforeEach(() => {
  mockResolveName.mockReset();
});

describe('resolvePathwayFitIdentity (#1548 seam)', () => {
  it('well-formed UEI is authoritative and does not call the name index', async () => {
    const r = await resolvePathwayFitIdentity({ uei: 'LVYXJGXKBQG3', company_name: 'Ignored Inc' });
    expect(r.resolution).toBe('uei');
    expect(r.uei).toBe('LVYXJGXKBQG3');
    expect(mockResolveName).not.toHaveBeenCalled();
  });

  it('malformed UEI is not guessed via name', async () => {
    const r = await resolvePathwayFitIdentity({ uei: 'too-short' });
    expect(r.resolution).toBe('malformed');
    expect(r.uei).toBeNull();
    expect(mockResolveName).not.toHaveBeenCalled();
  });

  it('unique name match returns that UEI', async () => {
    mockResolveName.mockResolvedValue({
      status: 'unique',
      uei: 'ABCDEFGHIJK1',
      name: 'Acme Cyber LLC',
      total_obligated: 10,
      award_count: 2,
      match: 'exact_stem',
    });
    const r = await resolvePathwayFitIdentity({ company_name: 'Acme Cyber' });
    expect(r.resolution).toBe('unique_name');
    expect(r.uei).toBe('ABCDEFGHIJK1');
    expect(r.name_match).toBe('exact_stem');
    expect(mockResolveName).toHaveBeenCalledWith('Acme Cyber');
  });

  it('ambiguous name is not auto-picked', async () => {
    mockResolveName.mockResolvedValue({
      status: 'ambiguous',
      match_count: 3,
      candidates: [
        { name: 'Acme A', uei: 'AAAAAAAAAAA1', total_obligated: 9, award_count: 1 },
        { name: 'Acme B', uei: 'BBBBBBBBBBB2', total_obligated: 1, award_count: 1 },
      ],
      truncated: false,
      note: '3 award-holding recipients match. This tool will not pick one.',
    });
    const r = await resolvePathwayFitIdentity({ company_name: 'Acme' });
    expect(r.resolution).toBe('ambiguous');
    expect(r.uei).toBeNull();
    expect(r.candidates).toHaveLength(2);
    expect(r.note).toMatch(/will not pick one/i);
  });

  it('name miss is none_in_award_corpus, not a claim of no federal awards', async () => {
    mockResolveName.mockResolvedValue({ status: 'none', searched: 'NoSuchCo' });
    const r = await resolvePathwayFitIdentity({ company_name: 'NoSuchCo' });
    expect(r.resolution).toBe('none_in_award_corpus');
    expect(r.uei).toBeNull();
    expect(r.note).toMatch(/not proof of no federal awards/i);
  });

  it('degraded name lookup is unavailable, not empty', async () => {
    mockResolveName.mockResolvedValue({ status: 'degraded', detail: 'bq timeout' });
    const r = await resolvePathwayFitIdentity({ company_name: 'Leidos' });
    expect(r.resolution).toBe('degraded');
    expect(r.uei).toBeNull();
    expect(r.note).toMatch(/bq timeout/i);
  });
});
