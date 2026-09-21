import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCallLLM = vi.fn();
vi.mock('@/lib/llm/call-llm', () => ({
  callLLM: (args: unknown) => mockCallLLM(args),
}));

const { refereeProposal, REFEREE_BATCH } = await import('./referee');

beforeEach(() => {
  mockCallLLM.mockReset();
  mockCallLLM.mockResolvedValue({
    text: JSON.stringify({
      verdicts: [
        { id: 'REQ-001', status: 'met', evidence: 'addressed' },
      ],
    }),
  });
});

describe('proposal referee timeout trace', () => {
  it('stops starting batches when the wall-clock budget is exhausted and does not mark them missing', async () => {
    const reqs = Array.from({ length: REFEREE_BATCH * 3 }, (_, i) => ({
      requirement: `The Contractor shall do thing ${i + 1}.`,
    }));
    mockCallLLM.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return {
        text: JSON.stringify({
          verdicts: [{ id: 'REQ-001', status: 'met', evidence: 'ok' }],
        }),
      };
    });
    const r = await refereeProposal(reqs, 'A draft that mentions compliance.', { budgetMs: 5 });
    expect(r.timeout_trace.timed_out).toBe(true);
    expect(r.timeout_trace.batches_skipped).toBeGreaterThan(0);
    expect(r.timeout_trace.reason).toMatch(/unevaluated/i);
    const unevaluated = r.verdicts.filter((v) => v.status === 'unevaluated');
    expect(unevaluated.length).toBeGreaterThan(0);
    expect(r.summary.missing).toBe(0);
    expect(unevaluated.every((v) => /budget/i.test(v.evidence || ''))).toBe(true);
  });
});
