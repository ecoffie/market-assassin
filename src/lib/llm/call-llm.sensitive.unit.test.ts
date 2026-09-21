import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Data Trust Phase 3.1 — the security property that matters: a `dataClass:
 * 'sensitive'` call (carrying customer vault PII) may ONLY reach a vetted
 * no-training provider, and must IGNORE the LLM_CHAIN env override that could
 * otherwise route PII to an un-vetted provider (grok). We assert this by mocking
 * global fetch and inspecting which provider URL is hit.
 */

const PROVIDER_URLS: Record<string, string> = {
  openai: 'api.openai.com',
  groq: 'api.groq.com',
  claude: 'api.anthropic.com',
  grok: 'api.x.ai',
};

function whichProvider(url: string): string {
  for (const [name, host] of Object.entries(PROVIDER_URLS)) if (url.includes(host)) return name;
  return 'unknown';
}

let fetchMock: ReturnType<typeof vi.fn>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  // Fund every provider so the chain isn't trimmed by missing keys.
  process.env.GROQ_API_KEY = 'k';
  process.env.OPENAI_API_KEY = 'k';
  process.env.ANTHROPIC_API_KEY = 'k';
  process.env.GROK_API_KEY = 'k';
  delete process.env.LLM_CHAIN;
  delete process.env.SENSITIVE_LLM_PROVIDERS;

  fetchMock = vi.fn(async (url: string) => {
    const provider = whichProvider(String(url));
    // grok "succeeds" too — so if a sensitive call ever reaches it, the test
    // will SEE grok as the answering provider (and fail). That's the point.
    const body =
      provider === 'claude'
        ? { content: [{ text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }
        : { choices: [{ message: { content: 'ok' } }], usage: {} };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

async function importCallLLM() {
  return (await import('./call-llm')).callLLM;
}

function providersHit(): string[] {
  return fetchMock.mock.calls.map((c) => whichProvider(String(c[0])));
}

describe('sensitive dataClass restricts to no-training providers', () => {
  it('a sensitive drafting call NEVER hits grok, even though grok is in the drafting chain', async () => {
    const callLLM = await importCallLLM();
    const r = await callLLM({ system: 's', user: 'u', job: 'drafting', dataClass: 'sensitive' });
    // drafting chain is [claude, groq70b, openai, grok]; claude answers first,
    // but the guarantee is grok is NEVER eligible for sensitive data.
    expect(providersHit()).not.toContain('grok');
    expect(['claude', 'groq', 'openai']).toContain(r.provider === 'groq70b' ? 'groq' : r.provider);
  });

  it('an LLM_CHAIN env override cannot force PII onto grok for a sensitive call', async () => {
    process.env.LLM_CHAIN = 'grok,openai'; // hostile override putting grok first
    const callLLM = await importCallLLM();
    await callLLM({ system: 's', user: 'u', dataClass: 'sensitive' });
    // sensitive path ignores LLM_CHAIN entirely → grok never contacted
    expect(providersHit()).not.toContain('grok');
  });

  it('a STANDARD call DOES honor the chain (grok allowed) — proves the restriction is scoped to sensitive only', async () => {
    process.env.LLM_CHAIN = 'grok';
    const callLLM = await importCallLLM();
    const r = await callLLM({ system: 's', user: 'u' }); // no dataClass = standard
    expect(providersHit()).toContain('grok');
    expect(r.provider).toBe('grok');
  });

  it('SENSITIVE_LLM_PROVIDERS can tighten the allow-list to a single named vendor', async () => {
    process.env.SENSITIVE_LLM_PROVIDERS = 'openai';
    const callLLM = await importCallLLM();
    const r = await callLLM({ system: 's', user: 'u', job: 'drafting', dataClass: 'sensitive' });
    // even though claude/groq are funded and first in the drafting chain, the
    // allow-list pins sensitive traffic to openai only.
    expect(providersHit()).toEqual(['openai']);
    expect(r.provider).toBe('openai');
  });

  it('throws (does not silently fall back) if no no-training provider is available for sensitive data', async () => {
    process.env.SENSITIVE_LLM_PROVIDERS = 'openai';
    delete process.env.OPENAI_API_KEY; // the only allowed provider is unfunded
    const callLLM = await importCallLLM();
    await expect(callLLM({ system: 's', user: 'u', dataClass: 'sensitive' })).rejects.toThrow(
      /no-training/i,
    );
    // and critically: it did NOT fall back to grok/anything un-vetted
    expect(providersHit()).not.toContain('grok');
  });
});
