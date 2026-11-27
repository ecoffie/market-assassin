import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import McpSetupPage from './page';
import { ANY_ASSISTANT_LINE, MCP_PLAIN_GLOSS } from './setup-copy';

/**
 * A beginner on /mcp/setup met "remote MCP connector" in the first line and the page never
 * said what MCP is. The first use of the term must carry a plain-language gloss.
 */
const html = renderToStaticMarkup(<McpSetupPage />);
const text = new JSDOM(html).window.document.body.textContent ?? '';

describe('/mcp/setup explains "MCP" in plain words on first use', () => {
  it('the gloss names the protocol and says what it does in plain words', () => {
    expect(MCP_PLAIN_GLOSS).toMatch(/Model Context Protocol/);
    expect(MCP_PLAIN_GLOSS).toMatch(/connect to outside tools/);
    // No superlatives or unsourced claims.
    expect(MCP_PLAIN_GLOSS).not.toMatch(/\b(best|leading|most|only)\b/i);
  });

  it('the intro line carries the gloss and still says which assistants work', () => {
    expect(ANY_ASSISTANT_LINE).toContain(MCP_PLAIN_GLOSS);
    expect(ANY_ASSISTANT_LINE).toMatch(/any AI assistant that can add a remote MCP connector by its URL/);
  });

  it('the rendered page explains MCP before it mentions it a second time', () => {
    const firstUse = text.indexOf('MCP connector');
    const gloss = text.indexOf(MCP_PLAIN_GLOSS);
    const secondUse = text.indexOf('MCP connector', firstUse + 1);
    expect(firstUse).toBeGreaterThanOrEqual(0);
    expect(gloss).toBeGreaterThan(firstUse);
    expect(gloss).toBeLessThan(secondUse);
  });
});
