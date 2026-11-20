// @vitest-environment jsdom
/**
 * Ask Mindy (/app chat): a create_document / generate_market_report turn shows the REPORT in the chat,
 * above the answer, and the download chips are the secondary action. Cold-ask root cause this pins: the
 * answer used to end in Vault download chips only, so the customer never saw the data and kept
 * re-downloading whichever file the chips pointed at.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const DOCX = '11111111-1111-4111-8111-111111111111';
const PDF = '11111111-1111-4111-8111-111111111112';
const RICH = '<!doctype html><h2>The read</h2><p>Pathways first</p><table><tr><td>Federal Highway Administration</td></tr></table>';

let sse: string[] = [];
const urls: string[] = [];
vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string) => {
    urls.push(url);
    if (url === '/api/app/chat') {
      const enc = new TextEncoder();
      return { ok: true, status: 200, body: new ReadableStream({ start(c) { for (const l of sse) c.enqueue(enc.encode(`data: ${l}\n\n`)); c.close(); } }), json: async () => ({}) };
    }
    if (url.startsWith('/api/app/vault/documents/preview')) {
      return { ok: true, status: 200, json: async () => ({ success: true, html: RICH, title: 'RBA Federal Market Profile', version: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import MindyChatPanel from './MindyChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function ask(): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MindyChatPanel email="pro@example.com" tier="pro" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const ta = el.querySelector('textarea')!;
  const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setVal.call(ta, 'Federal market profile for RBA'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  return el;
}

beforeEach(() => { urls.length = 0; sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {}; });

describe('MindyChatPanel report preview', () => {
  it('create_document turn: the report opens in the chat before the answer, from THIS turn\'s document, and the chips follow', async () => {
    sse = [
      JSON.stringify({ type: 'token', content: 'Here is the read on RBA.' }),
      JSON.stringify({ type: 'deliverables', files: [{ format: 'pdf', document_id: PDF }, { format: 'docx', document_id: DOCX }] }),
      JSON.stringify({ type: 'done' }),
    ];
    const el = await ask();

    expect(urls.some((u) => u.includes(`/api/app/vault/documents/preview?email=pro%40example.com&id=${DOCX}`))).toBe(true);
    const frame = el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('The read');

    const pane = el.querySelector('[data-testid="chat-report-preview"]')!;
    const answer = Array.from(el.querySelectorAll('div')).find((d) => d.textContent === 'Here is the read on RBA.')!;
    const chips = el.querySelector('[data-testid="generated-downloads"]')!;
    // DOM order: report, then the answer text, then the download chips.
    expect(pane.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('market_report turn: the packaged report renders inline with no Vault fetch', async () => {
    sse = [
      JSON.stringify({ type: 'token', content: 'Summary.' }),
      JSON.stringify({ type: 'market_report', report_id: 'r1', url: 'https://getmindy.ai/reports/r1', title: 'Acme market report', html: RICH }),
      JSON.stringify({ type: 'done' }),
    ];
    const el = await ask();
    expect(urls.some((u) => u.includes('/vault/documents/preview'))).toBe(false);
    expect((el.querySelector('[data-testid="chat-report-frame"]') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('The read');
    expect(el.querySelector('[data-testid="chat-report-title"]')?.textContent).toBe('Acme market report');
  });

  it('a plain answer shows no report pane', async () => {
    sse = [JSON.stringify({ type: 'token', content: 'Just text.' }), JSON.stringify({ type: 'done' })];
    const el = await ask();
    expect(el.querySelector('[data-testid="chat-report-preview"]')).toBeNull();
  });
});
