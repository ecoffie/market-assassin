/**
 * generateV2Draft: the Vault/profile come from `email`; the LLM call (cost log + per-user
 * budget) is attributed to `billingEmail` when set (a coach drafting for a client workspace).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callLLM, loadBidderProfile, loadVaultContext } = vi.hoisted(() => ({
  callLLM: vi.fn(async (_a: Record<string, unknown>) => ({ text: 'The contractor will clean Building 12 daily.', provider: 'stub' })),
  loadBidderProfile: vi.fn(async (_e: string) => ({})),
  loadVaultContext: vi.fn(async (_e: string, _s: string) => ({ has_any: false })),
}));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM }));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: vi.fn(async () => []), formatChunksForPrompt: () => '' }));
vi.mock('./loaders', () => ({
  loadBidderProfile, loadVaultContext,
  formatProfileForPrompt: () => '', formatVaultForPrompt: () => '', formatEvidenceGapsForPrompt: () => '',
}));

import { generateV2Draft } from './v2';

const CLIENT_VAULT = '11111111-2222-3333-4444-555555555555@clients.getmindy.ai';
const RFP = 'The contractor shall provide janitorial services for Building 12 five days per week.';

beforeEach(() => { process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test'; callLLM.mockClear(); loadVaultContext.mockClear(); loadBidderProfile.mockClear(); });

describe('generateV2Draft billing attribution', () => {
  it('client Vault for data, coach for the LLM cost', async () => {
    await generateV2Draft({ email: CLIENT_VAULT, billingEmail: 'coach@firm.com', sectionType: 'technical', sourceText: RFP });
    expect(loadVaultContext).toHaveBeenCalledWith(CLIENT_VAULT, 'technical');
    expect(loadBidderProfile).toHaveBeenCalledWith(CLIENT_VAULT);
    expect(callLLM).toHaveBeenCalledWith(expect.objectContaining({ userEmail: 'coach@firm.com' }));
    expect(callLLM).not.toHaveBeenCalledWith(expect.objectContaining({ userEmail: CLIENT_VAULT }));
  });

  it('without billingEmail the caller is billed as before', async () => {
    await generateV2Draft({ email: 'owner@x.com', sectionType: 'technical', sourceText: RFP });
    expect(callLLM).toHaveBeenCalledWith(expect.objectContaining({ userEmail: 'owner@x.com' }));
  });
});
