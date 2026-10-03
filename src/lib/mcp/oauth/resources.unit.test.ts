/** Resource / audience resolution (RFC 8707) + the two RFC 9728 metadata documents. */
import { describe, expect, it } from 'vitest';
import {
  OAUTH_RESOURCE, OAUTH_RESOURCE_CHATGPT, CHATGPT_RESOURCE_METADATA_PATH,
  allowlistedResource, isChatgptAudience, isChatgptResource, resolveTokenAudience,
} from './resources';

process.env.MCP_OAUTH_ENABLED = 'true';

describe('resources', () => {
  it('defaults: full = mcp.getmindy.ai/mcp, ChatGPT = same origin /chatgpt/mcp', () => {
    expect(OAUTH_RESOURCE).toBe('https://mcp.getmindy.ai/mcp');
    expect(OAUTH_RESOURCE_CHATGPT).toBe('https://mcp.getmindy.ai/chatgpt/mcp');
    expect(CHATGPT_RESOURCE_METADATA_PATH).toBe('/.well-known/oauth-protected-resource/chatgpt/mcp');
  });

  it('allowlist is exact (trailing slash tolerated, no prefixes, no lookalikes)', () => {
    expect(allowlistedResource('https://mcp.getmindy.ai/chatgpt/mcp/')).toBe(OAUTH_RESOURCE_CHATGPT);
    expect(allowlistedResource('https://mcp.getmindy.ai/chatgpt/mcp/extra')).toBeNull();
    expect(allowlistedResource('https://evil.example/chatgpt/mcp')).toBeNull();
    expect(allowlistedResource(undefined)).toBeNull();
  });

  it('resolveTokenAudience: default unless a ChatGPT grant; mismatch is invalid_target', () => {
    expect(resolveTokenAudience(null, undefined)).toEqual({ ok: true, audience: OAUTH_RESOURCE });
    expect(resolveTokenAudience('https://getmindy.ai/mcp/mcp', 'whatever')).toEqual({ ok: true, audience: OAUTH_RESOURCE });
    expect(resolveTokenAudience(OAUTH_RESOURCE_CHATGPT, undefined)).toEqual({ ok: true, audience: OAUTH_RESOURCE_CHATGPT });
    expect(resolveTokenAudience(null, OAUTH_RESOURCE_CHATGPT)).toEqual({ ok: true, audience: OAUTH_RESOURCE_CHATGPT });
    expect(resolveTokenAudience(OAUTH_RESOURCE_CHATGPT, OAUTH_RESOURCE).ok).toBe(false);
    expect(resolveTokenAudience(OAUTH_RESOURCE, OAUTH_RESOURCE_CHATGPT).ok).toBe(false);
  });

  it('isChatgptAudience / isChatgptResource', () => {
    expect(isChatgptAudience(OAUTH_RESOURCE_CHATGPT)).toBe(true);
    expect(isChatgptAudience(OAUTH_RESOURCE)).toBe(false);
    expect(isChatgptResource('https://mcp.getmindy.ai/chatgpt/mcp')).toBe(true);
    expect(isChatgptResource('https://mcp.getmindy.ai/mcp')).toBe(false);
    expect(isChatgptResource('')).toBe(false);
  });
});

describe('protected-resource metadata documents', () => {
  it('ChatGPT document advertises the ChatGPT resource on the same authorization server', async () => {
    const { GET } = await import('@/app/api/oauth/metadata/protected-resource/chatgpt/route');
    const doc = await GET().json();
    expect(doc.resource).toBe('https://mcp.getmindy.ai/chatgpt/mcp');
    expect(doc.authorization_servers).toEqual(['https://getmindy.ai']);
  });

  it('default document is unchanged', async () => {
    const { GET } = await import('@/app/api/oauth/metadata/protected-resource/route');
    const doc = await GET().json();
    expect(doc.resource).toBe('https://mcp.getmindy.ai/mcp');
    expect(doc.authorization_servers).toEqual(['https://getmindy.ai']);
  });
});
