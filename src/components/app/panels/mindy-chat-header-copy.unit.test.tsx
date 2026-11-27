// @vitest-environment jsdom
/**
 * Ask Mindy answers only from live federal data tools since the teaching corpus / podcast RAG was removed
 * (2026-08-02). The panel must not claim an "8-year knowledge base", podcast interviews or years of teaching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../authHeaders', () => ({ authedFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) })) }));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));
import MindyChatPanel from './MindyChatPanel';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {}; });
async function render(tier: string) {
  const el = document.createElement('div'); document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<MindyChatPanel email="u@example.com" tier={tier} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el.textContent || '';
}
const STALE = [/8-year knowledge base/i, /knowledge base/i, /podcast interviews/i, /years\s+of teaching/i];

describe('Ask Mindy panel copy matches what it actually uses', () => {
  it('Pro header: live federal data, no knowledge-base claim', async () => {
    const text = await render('pro');
    expect(text).toContain('Mindy cites her sources from live federal data.');
    for (const re of STALE) expect(text, String(re)).not.toMatch(re);
  });
  it('free upsell: live federal data, no podcast/teaching claim', async () => {
    const text = await render('free');
    expect(text).toContain('grounded in live federal data');
    for (const re of STALE) expect(text, String(re)).not.toMatch(re);
  });
});
