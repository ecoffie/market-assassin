import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANY_ASSISTANT_LINE, OTHER_ASSISTANTS, CLAUDE_COMPUTER_NOTE } from './setup-copy';

/**
 * Mindy Day 2026-11: attendees asked "does it work with my AI?" (Copilot, Cursor, their own
 * model); a Microsoft 365 Copilot user was blocked by her IT admin; a Claude phone-app user
 * could not find where to add the connector. The setup guide only covered Claude and ChatGPT.
 */
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('setup guide answers "does it work with my AI?"', () => {
  it('says any assistant that can add a remote MCP connector by URL works', () => {
    expect(ANY_ASSISTANT_LINE).toMatch(/any AI assistant that can add a remote MCP connector by its URL/);
  });

  it('names only clients Mindy already lists on its own pages', () => {
    // Sourced from src/app/mcp/about/page.tsx and src/app/mcp/mcp-console.tsx.
    expect(OTHER_ASSISTANTS.heading).toBe('Other assistants (Copilot, Cursor and others)');
    expect(OTHER_ASSISTANTS.heading).not.toMatch(/Gemini/);
  });

  it('gives the generic steps and the company IT admin case', () => {
    const text = OTHER_ASSISTANTS.steps.join(' ');
    expect(text).toContain('https://mcp.getmindy.ai/mcp');
    expect(text).toMatch(/sign in/i);
    expect(OTHER_ASSISTANTS.adminNote).toMatch(/Microsoft 365/);
    expect(OTHER_ASSISTANTS.adminNote).toMatch(/IT admin/);
  });

  it('tells Claude users to add the connector on a computer, not the phone app', () => {
    expect(CLAUDE_COMPUTER_NOTE).toMatch(/computer/);
    expect(CLAUDE_COMPUTER_NOTE).toMatch(/phone app/);
  });

  it('is wired into the page', () => {
    expect(PAGE).toContain('{ANY_ASSISTANT_LINE}');
    expect(PAGE).toContain('id="other"');
    expect(PAGE).toContain('{OTHER_ASSISTANTS.heading}');
    expect(PAGE).toContain('{OTHER_ASSISTANTS.adminNote}');
    expect(PAGE).toContain('{CLAUDE_COMPUTER_NOTE}');
    expect(PAGE).toContain('href="#other"');
  });
});
