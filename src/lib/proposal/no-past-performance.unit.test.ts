/**
 * A past-performance section with no vault past performance must never reach the model.
 * Regression: 2026-11-23 the MCP draft_proposal_section wrote "Our past work with the VA…"
 * and three described contracts for an account with 0 past-performance records.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callLLM, loadVaultContext } = vi.hoisted(() => ({
  callLLM: vi.fn(async (_a: Record<string, unknown>) => ({
    text: 'Our past work with the VA has equipped us to remove trees safely at medical centers.',
    provider: 'stub',
  })),
  loadVaultContext: vi.fn(async (_e: string, _s: string): Promise<Record<string, unknown>> => ({ has_any: false })),
}));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM }));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: vi.fn(async () => []), formatChunksForPrompt: () => '' }));
vi.mock('./loaders', () => ({
  loadBidderProfile: vi.fn(async () => ({ companyName: 'Example Co' })),
  loadVaultContext,
  formatProfileForPrompt: () => '', formatVaultForPrompt: () => '', formatEvidenceGapsForPrompt: () => '',
}));

import { generateV2Draft } from './v2';
import { pastPerformanceGap, noPastPerformanceDraft } from './no-past-performance';

const RFP = 'The contractor shall remove 12 hazardous trees at the VA Medical Center, Martinsburg WV.';

beforeEach(() => {
  process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test';
  callLLM.mockClear();
  loadVaultContext.mockReset();
  loadVaultContext.mockResolvedValue({ has_any: false });
});

describe('past performance with nothing on file', () => {
  it.each(['past_performance', 'cap_past_performance'] as const)('%s: no model call, no claim, fill-in template', async (sectionType) => {
    const r = await generateV2Draft({ email: 'new@firm.com', sectionType, sourceText: RFP });
    expect(callLLM).not.toHaveBeenCalled();
    expect(r.meta.pastPerformanceGap).toBe('none_on_file');
    expect(r.draft).not.toMatch(/our past work|we have (successfully )?(delivered|performed|completed)/i);
    expect(r.draft).toContain('[Project title]');
    expect(r.draft).toContain('FAR 15.305(a)(2)(iv)');
  });

  it('vault read failure is "unavailable", not "none on file" (unknown is never zero)', async () => {
    loadVaultContext.mockResolvedValue({ has_any: false, unavailable: ['past_performance'] });
    const r = await generateV2Draft({ email: 'x@firm.com', sectionType: 'past_performance', sourceText: RFP });
    expect(callLLM).not.toHaveBeenCalled();
    expect(r.meta.pastPerformanceGap).toBe('unavailable');
    expect(r.draft).toMatch(/could not be loaded/);
  });

  it('with real past performance on file the model drafts as before', async () => {
    loadVaultContext.mockResolvedValue({ has_any: true, past_performance: [{ contract_name: 'Grounds maintenance, City of Dayton' }] });
    const r = await generateV2Draft({ email: 'x@firm.com', sectionType: 'past_performance', sourceText: RFP });
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(r.meta.pastPerformanceGap).toBeUndefined();
  });

  it('other sections are untouched by an empty past-performance vault', async () => {
    await generateV2Draft({ email: 'x@firm.com', sectionType: 'technical', sourceText: RFP });
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('pure helpers', () => {
    expect(pastPerformanceGap('technical', { has_any: false })).toBeNull();
    expect(pastPerformanceGap('past_performance', { has_any: true, past_performance: [{}] })).toBeNull();
    expect(noPastPerformanceDraft('cap_past_performance', 'Past Performance', 'none_on_file').match(/\[Project title\]/g)).toHaveLength(2);
  });
});
