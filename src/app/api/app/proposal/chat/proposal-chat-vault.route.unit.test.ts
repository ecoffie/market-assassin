/**
 * Manual Drive reads the whole Vault set (identity, past performance, capabilities, team), not the
 * exec_summary narrowing that silently dropped capabilities and team (parity audit 2026-11-16).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const vaultOpts: unknown[] = [];
const prompts: string[] = [];

vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: (_r: unknown, email: string) => ({ ok: true, session: { email } }) }));
vi.mock('@/lib/access/require-pro', () => ({ isProEmail: async () => true, proRequiredResponse: () => new Response(null, { status: 402 }) }));
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: async () => ({ text: '' }) }));
vi.mock('@/lib/llm/usage-cost', () => ({ isUserOverBudget: async () => false, recordLlmUsage: async () => {} }));
vi.mock('@/lib/proposal/loaders', async (orig) => ({
  ALL_VAULT_SECTIONS: (await orig<typeof import('@/lib/proposal/loaders')>()).ALL_VAULT_SECTIONS,
  loadBidderProfile: async () => null,
  formatProfileForPrompt: () => '',
  loadVaultContext: async (_e: string, _s: string, opts?: unknown) => {
    vaultOpts.push(opts);
    return {
      has_any: true,
      identity: { legal_name: 'Acme Fed LLC' },
      past_performance: [{ contract_title: 'DLA Spares', agency: 'DLA' }],
      capabilities: [{ capability_name: 'Precision machining', description: 'CNC to drawing' }],
      team: [{ full_name: 'Pat Lee', title: 'Program Manager', is_key_personnel: true, security_clearance: 'Secret' }],
    };
  },
}));
vi.mock('@/lib/rag/retrieve', () => ({ retrieveRagContext: async () => [], formatChunksForPrompt: () => '' }));
vi.mock('@/lib/proposal/select-relevant', () => ({ selectRelevantRfp: () => '' }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

beforeEach(() => {
  vaultOpts.length = 0; prompts.length = 0;
  vi.stubEnv('OPENAI_API_KEY', 'ok'); vi.stubEnv('GROQ_API_KEY', 'gk');
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    prompts.push(b.messages[b.messages.length - 1].content);
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Manual Drive Vault read', () => {
  it('requests every Vault section and puts capabilities and team in the prompt', async () => {
    vi.resetModules();
    const { POST } = await import('./route');
    const res = await POST(new Request('https://getmindy.ai/api/app/proposal/chat', { method: 'POST', body: JSON.stringify({ email: 'pro@example.com', message: 'Draft the management approach' }) }) as never);
    await res.text();
    expect(vaultOpts[0]).toEqual({ sections: ['identity', 'past_performance', 'capabilities', 'team'] });
    expect(prompts[0]).toContain('Precision machining');
    expect(prompts[0]).toContain('Pat Lee, Program Manager (key personnel, Secret clearance)');
  });
});
