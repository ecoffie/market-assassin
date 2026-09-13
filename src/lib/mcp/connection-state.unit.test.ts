import { describe, expect, it } from 'vitest';
import { classifyConnector, connectionFlagsFromClients } from './connection-state';

describe('connector classification is honest', () => {
  it('labels Claude only when the client name says Claude/Anthropic', () => {
    expect(classifyConnector('Claude')).toBe('claude');
    expect(classifyConnector('Claude Desktop')).toBe('claude');
    expect(classifyConnector(null, 'anthropic-connector')).toBe('claude');
  });

  it('labels ChatGPT only when the client name says ChatGPT/OpenAI', () => {
    expect(classifyConnector('ChatGPT')).toBe('chatgpt');
    expect(classifyConnector('OpenAI')).toBe('chatgpt');
  });

  it('does not invent connected status for generic DCR clients', () => {
    expect(classifyConnector(null)).toBe('unknown');
    expect(classifyConnector('My Agent')).toBe('unknown');
    const flags = connectionFlagsFromClients([{ clientName: null, clientId: 'abc' }]);
    expect(flags.claude).toBe('unknown');
    expect(flags.chatgpt).toBe('unknown');
    expect(flags.hasNamedClient).toBe(false);
  });
});
