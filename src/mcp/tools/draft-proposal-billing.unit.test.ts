/**
 * Coach drafting for a client workspace: the CLIENT's Vault grounds the draft, but LLM cost
 * and the per-user budget stay on the COACH (the authenticated caller). Billing a client
 * workspace's synthetic email would hide the spend and dodge the coach's budget cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateV2Draft, generateAllSections, callLLM } = vi.hoisted(() => ({
  generateV2Draft: vi.fn(async (_a: Record<string, unknown>) => ({ label: 'x', draft: 'Draft text.', wordCount: 2, targetWords: 500, meta: {} })),
  generateAllSections: vi.fn(async (_a: Record<string, unknown>) => ({ sections: [], outline: [], errors: [] })),
  callLLM: vi.fn(async () => ({ text: 'A section draft.', provider: 'stub' })),
}));
vi.mock('@/lib/proposal/v2', () => ({ generateV2Draft }));
vi.mock('@/lib/proposal/draft-all', () => ({ generateAllSections }));
vi.mock('@/lib/sam/solicitation-documents', () => ({ getSolicitationDocuments: vi.fn() }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM }));

import { draftProposal, draftProposalSection } from './draft-proposal';

const RFP = 'The contractor shall provide janitorial services for Building 12 five days per week, including restrooms and floors.';
const CLIENT_VAULT = '11111111-2222-3333-4444-555555555555@clients.getmindy.ai';

beforeEach(() => { generateV2Draft.mockClear(); generateAllSections.mockClear(); callLLM.mockClear(); });

describe('draft tools: data from the Vault email, cost on the caller', () => {
  it('draft_proposal_section in client scope reads the client Vault and bills the coach', async () => {
    await draftProposalSection({ section_type: 'technical', rfp_text: RFP, userEmail: 'coach@firm.com', vaultEmail: CLIENT_VAULT });
    expect(generateV2Draft).toHaveBeenCalledWith(expect.objectContaining({ email: CLIENT_VAULT, billingEmail: 'coach@firm.com' }));
  });

  it('draft_proposal in client scope reads the client Vault and bills the coach', async () => {
    await draftProposal({ rfp_text: RFP, userEmail: 'coach@firm.com', vaultEmail: CLIENT_VAULT });
    expect(generateAllSections).toHaveBeenCalledWith(expect.objectContaining({ email: CLIENT_VAULT, billingEmail: 'coach@firm.com' }));
  });

  it('own scope (hosted MCP, normal chat) is unchanged: one email, no billingEmail', async () => {
    await draftProposalSection({ section_type: 'technical', rfp_text: RFP, userEmail: 'owner@x.com' });
    const args = (generateV2Draft.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(args.email).toBe('owner@x.com');
    expect(args).not.toHaveProperty('billingEmail');
  });
});
